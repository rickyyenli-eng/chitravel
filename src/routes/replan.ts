import { Hono, type Context } from "hono";
import { config } from "../config.js";
import { extractJson } from "../lib/json.js";
import { allow } from "../lib/rate-limit.js";
import { ask, LlmError } from "../llm.js";
import { REPLAN_SYSTEM, buildReplanPrompt } from "../prompt.js";
import { PlanRequestSchema, StopSchema, type PlanErr } from "../types.js";
import { z } from "zod";

/**
 * 重排時間。
 *
 * 使用者刪掉一站、或臨時插一站之後，後面所有站的時間就不對了 ——
 * 這支端點把「編輯過的站序」送回去，只請模型重算時間與交通銜接，
 * 不准它換景點、不准它加減站。
 *
 * 刻意跟 /api/plan 分開：重排的輸出短很多（只有時間與交通段），
 * 用便宜的模型、幾秒就回來，使用者才願意編完就按一下。
 */
const ReplanRequestSchema = z.object({
  form: PlanRequestSchema,
  stops: z.array(StopSchema).min(1).max(40),
});

export const replanRoute = new Hono();

replanRoute.post("/replan", async (c) => {
  const started = Date.now();

  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  if (!allow(`replan:${ip}`, config.rateLimitPerMin * 2)) {
    return fail(c, 429, "rate_limited", "按太快了，等一下再試。");
  }

  const parsed = ReplanRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return fail(c, 400, "bad_request", "行程資料看起來不完整。");
  const { form, stops } = parsed.data;

  try {
    const res = await ask({
      system: REPLAN_SYSTEM,
      prompt: buildReplanPrompt(form, stops),
      model: config.plannerModel,
      maxTokens: 400 + stops.length * 180,
      prefill: "{",
    });

    const raw = extractJson(res.text) as { stops?: unknown } | null;
    const rows = Array.isArray(raw?.stops) ? raw.stops : null;
    if (!rows || rows.length !== stops.length) {
      return fail(c, 502, "invalid_json", "重排的結果對不上目前的站數，再按一次試試。");
    }

    // 只接受時間類欄位。名稱、價格、備註一概沿用使用者手上那份 ——
    // 重排就該只動時間，模型順手改掉別的欄位是最惱人的事
    const patch = rows.map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        time: String(o.time ?? "").slice(0, 10),
        duration: String(o.duration ?? "").slice(0, 40),
        howTo: typeof o.howTo === "string" ? o.howTo.slice(0, 400) : "",
        day: Number(o.day) >= 1 ? Math.floor(Number(o.day)) : 1,
      };
    });

    console.log(
      `[replan] ${stops.length} 站 · ${res.inputTokens}+${res.outputTokens} tok · ${Date.now() - started}ms`,
    );
    return c.json({ ok: true, patch, note: String((raw as { note?: string })?.note ?? "") });
  } catch (err) {
    if (err instanceof LlmError) {
      const status = err.code === "rate_limited" ? 429 : 502;
      return fail(c, status as 429 | 502, err.code, err.message);
    }
    console.error("[replan] 未預期錯誤", err);
    return fail(c, 500, "upstream_error", "伺服器出了點問題。");
  }
});

function fail(c: Context, status: 400 | 429 | 500 | 502, code: PlanErr["code"], message: string) {
  return c.json<PlanErr>({ ok: false, code, message }, status);
}
