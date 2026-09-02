import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { config } from "../config.js";
import { hashKey, TtlCache } from "../lib/cache.js";
import { extractJson } from "../lib/json.js";
import { allow } from "../lib/rate-limit.js";
import { MOCK_TRIP_JSON } from "../lib/mock-trip.js";
import { TripStreamParser } from "../lib/stream-parse.js";
import { ask, askStream, estimateCostUsd, LlmError } from "../llm.js";
import { buildPlanPrompt, SYSTEM_PROMPT } from "../prompt.js";
import { verifyStop, type Candidate } from "../verify.js";
import {
  PlanRequestSchema,
  TripSchema,
  type Extra,
  type PlanErr,
  type PlanOk,
  type PlanRequest,
  type Stop,
  type Trip,
} from "../types.js";

const cache = new TtlCache<Trip>(config.cacheTtlSeconds * 1000);
// 查證結果單獨快取，這樣重複的條件不會再花一次搜尋費
const verifyCache = new TtlCache<Record<number, Candidate[]>>(config.cacheTtlSeconds * 1000);

export const planRoute = new Hono();

/* ------------------------------------------------------------------ *
 * 一次給完版：留著當備援，也方便用 curl 測
 * ------------------------------------------------------------------ */
planRoute.post("/plan", async (c) => {
  const started = Date.now();

  const gate = await guard(c);
  if ("error" in gate) return fail(c, gate.error.status, gate.error.code, gate.error.message);
  const form = gate.form;

  const key = hashKey({ form, model: config.plannerModel });
  const cached = cache.get(key);
  if (cached) {
    return c.json<PlanOk>({ ok: true, trip: cached, cached: true, ms: Date.now() - started });
  }

  try {
    const res = await ask({
      system: SYSTEM_PROMPT,
      prompt: buildPlanPrompt(form),
      maxTokens: 6000 + (form.days - 1) * 4500,
      prefill: "{",
    });

    if (res.stopReason === "max_tokens") {
      return fail(c, 502, "invalid_json", "行程寫到一半被截斷了，把條件縮小一點再試。");
    }

    const raw = extractJson(res.text);
    if (raw === null) {
      return fail(c, 502, "invalid_json", "這次回來的格式跑掉了，再按一次通常就好。");
    }

    const trip = TripSchema.safeParse(raw);
    if (!trip.success || trip.data.stops.length === 0) {
      return fail(c, 502, "empty_plan", "這次沒排出任何一站，把條件寫得更具體一點會比較穩。");
    }

    cache.set(key, trip.data);
    logPlan(form, trip.data, res, started);

    return c.json<PlanOk>({ ok: true, trip: trip.data, cached: false, ms: Date.now() - started });
  } catch (err) {
    return failFromError(c, err);
  }
});

/* ------------------------------------------------------------------ *
 * 串流版：同一次模型呼叫，但一站寫完就先送一站。
 * 使用者大概 5 秒看到第一張卡片，而不是等 40 秒才一次全出來。
 * 成本完全一樣 —— 只是把等待攤開來看。
 * ------------------------------------------------------------------ */
planRoute.post("/plan/stream", async (c) => {
  const started = Date.now();

  const gate = await guard(c);
  if ("error" in gate) return fail(c, gate.error.status, gate.error.code, gate.error.message);
  const form = gate.form;

  const key = hashKey({ form, model: config.plannerModel });
  const cached = cache.get(key);

  return streamSSE(c, async (sse) => {
    // writeSSE 是非同步的，模型的 callback 卻是同步觸發的，
    // 中間放一個佇列，避免兩邊搶著寫同一條連線。
    const queue: Array<{ event: string; data: unknown }> = [];
    let finished = false;
    const push = (event: string, data: unknown) => {
      queue.push({ event, data });
    };

    const pump = (async () => {
      let lastWrite = Date.now();
      while (!finished || queue.length > 0) {
        const item = queue.shift();
        if (!item) {
          // 心跳：雲端代理常在閒置一陣子後掐斷連線，而模型在寫出
          // 第一段之前可能安靜好幾十秒。SSE 註解不會觸發前端的事件處理。
          if (Date.now() - lastWrite > 15_000) {
            await sse.write(": ping\n\n");
            lastWrite = Date.now();
          }
          await new Promise((r) => setTimeout(r, 25));
          continue;
        }
        await sse.writeSSE({ event: item.event, data: JSON.stringify(item.data) });
        lastWrite = Date.now();
      }
    })();

    try {
      if (cached) {
        push("meta", { title: cached.title, summary: cached.summary });
        for (const stop of cached.stops) push("stop", stop);
        for (const extra of cached.extras) push("extra", extra);
        push("done", { tips: cached.tips, cached: true, ms: Date.now() - started, verifying: 0 });
        const savedCandidates = verifyCache.get(key);
        if (savedCandidates) {
          for (const [index, candidates] of Object.entries(savedCandidates)) {
            push("verify", { index: Number(index), candidates });
          }
        }
        push("end", {});
        return;
      }

      const stops: Stop[] = [];
      const extras: Extra[] = [];
      const parser = new TripStreamParser({
        meta: (m) => push("meta", m),
        stop: (s) => {
          stops.push(s);
          push("stop", s);
        },
        extra: (x) => {
          extras.push(x);
          push("extra", x);
        },
      });
      parser.push("{"); // prefill 的左大括號不會出現在串流裡，要自己補

      if (config.mockPlan) {
        // 假資料也走同一條解析與推送路徑，這樣測到的才是真的那條路
        const body = MOCK_TRIP_JSON.slice(1);
        for (let i = 0; i < body.length; i += 24) {
          parser.push(body.slice(i, i + 24));
          await new Promise((r) => setTimeout(r, 40));
        }
        const mock = TripSchema.safeParse(JSON.parse(MOCK_TRIP_JSON));
        push("done", {
          tips: mock.success ? mock.data.tips : [],
          cached: false,
          mock: true,
          ms: Date.now() - started,
          verifying: 0,
        });
        push("end", {});
        return;
      }

      const res = await askStream({
        system: SYSTEM_PROMPT,
        prompt: buildPlanPrompt(form),
        // 多天行程要寫的東西多很多，額度不夠會被硬生生截斷
        maxTokens: 6000 + (form.days - 1) * 4500,
        prefill: "{",
        onText: (delta) => parser.push(delta),
      });

      // 收尾：整份再解析一次，補上 tips，順便寫進快取
      const trip = TripSchema.safeParse(extractJson(res.text));

      // 只查模型自己說「沒指名」或「沒查證」的，地標與交通段不浪費搜尋費
      const targets = stops
        .map((s, i) => ({ s, i }))
        // 住宿不查：旅館結果幾乎都是動態產生的訂房網，抓回來是空殼。
        // 前端改給帶好條件的訂房搜尋連結，這裡省下一次搜尋加一次萃取。
        .filter(({ s }) => s.kind !== "transit" && s.kind !== "stay" && s.verified !== "landmark");
      const willVerify = config.tavilyKey ? targets.length : 0;

      if (trip.success && trip.data.stops.length > 0) {
        cache.set(key, trip.data);
        push("done", {
          tips: trip.data.tips,
          cached: false,
          ms: Date.now() - started,
          verifying: willVerify,
        });
        logPlan(form, trip.data, res, started);
      } else if (stops.length > 0) {
        // 已經送出去的那幾站是有效的，別因為收尾解析失敗就把整頁清掉
        push("done", { tips: [], cached: false, ms: Date.now() - started, partial: true, verifying: willVerify });
      } else {
        push("error", {
          code: "empty_plan",
          message: "這次沒排出任何一站，把條件寫得更具體一點會比較穩。",
        });
        return;
      }

      if (willVerify > 0) {
        const found: Record<number, Candidate[]> = {};
        for (const { s, i } of targets) {
          try {
            const candidates = await verifyStop(form, s);
            found[i] = candidates;
            push("verify", { index: i, candidates });
          } catch (err) {
            console.error(`[verify] ${s.name} 失敗`, err);
            push("verify", { index: i, candidates: [], failed: true });
          }
        }
        verifyCache.set(key, found);
        console.log(`[verify] 查證 ${targets.length} 站，找到候選 ` +
          Object.values(found).filter((c) => c.length > 0).length + " 站");
      }
      push("end", {});
    } catch (err) {
      if (err instanceof LlmError) {
        push("error", { code: err.code, message: err.message });
      } else {
        console.error("[plan/stream] 未預期錯誤", err);
        push("error", { code: "upstream_error", message: "伺服器出了點問題，稍後再試。" });
      }
    } finally {
      finished = true;
      await pump;
    }
  });
});

/* ------------------------------------------------------------------ *
 * 共用
 * ------------------------------------------------------------------ */

type FailStatus = 400 | 429 | 500 | 502;
type GateResult =
  | { form: PlanRequest }
  | { error: { status: FailStatus; code: PlanErr["code"]; message: string } };

/** 兩支端點共用的守門：頻率限制 + 表單驗證。這裡擋掉的請求一個 token 都不會花。 */
async function guard(c: Context): Promise<GateResult> {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  if (!allow(ip, config.rateLimitPerMin)) {
    return { error: { status: 429, code: "rate_limited", message: "按太快了，等一分鐘再試。" } };
  }

  const body = await c.req.json().catch(() => null);
  const parsed = PlanRequestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: {
        status: 400,
        code: "bad_request",
        message: `條件有問題：${first?.path.join(".") ?? "?"} ${first?.message ?? ""}`,
      },
    };
  }
  return { form: parsed.data };
}

function fail(c: Context, status: FailStatus, code: PlanErr["code"], message: string) {
  return c.json<PlanErr>({ ok: false, code, message }, status);
}

function failFromError(c: Context, err: unknown) {
  if (err instanceof LlmError) {
    const status: FailStatus =
      err.code === "rate_limited" ? 429
      : err.code === "no_key" || err.code === "no_workspace" ? 500
      : 502;
    return fail(c, status, err.code, err.message);
  }
  console.error("[plan] 未預期錯誤", err);
  return fail(c, 500, "upstream_error", "伺服器出了點問題，稍後再試。");
}

function logPlan(
  form: PlanRequest,
  trip: Trip,
  res: { inputTokens: number; outputTokens: number; text: string; stopReason: string | null },
  started: number,
): void {
  console.log(
    `[plan] ${form.from} → ${form.to} / ${form.food} · ${trip.stops.length} 站 · ` +
      `${res.inputTokens}+${res.outputTokens} tok · ~$${estimateCostUsd(res).toFixed(4)} · ` +
      `${Date.now() - started}ms`,
  );
}
