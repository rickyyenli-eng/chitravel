import { Hono, type Context } from "hono";
import { config } from "../config.js";
import { allow } from "../lib/rate-limit.js";
import { findTrains, type RailMode } from "../lib/rail.js";
import { tdxEnabled } from "../lib/tdx.js";

/**
 * 直接查班次的端點。
 *
 * 做這個的理由很實際：剩餘座位要憑證，而憑證只有線上有 ——
 * 行程裡沒出現「有位」時，分不清是 TDX 沒回、還是模型沒把它抄進輸出。
 * 有這個端點，一行 curl 就知道是哪一種。
 *
 * 回的全是公開資料（時刻表、票價、O/L/X 座位狀態），沒有任何金鑰。
 */
export const railRoute = new Hono();

function gate(c: Context): boolean {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  return allow(`rail:${ip}`, config.placesRateLimitPerMin);
}

railRoute.get("/rail", async (c) => {
  if (!gate(c)) return c.json({ ok: false, code: "rate_limited" }, 429);

  const mode = (c.req.query("mode") ?? "thsr") === "tra" ? "tra" : ("thsr" as RailMode);
  const from = (c.req.query("from") ?? "").slice(0, 40);
  const to = (c.req.query("to") ?? "").slice(0, 40);
  const date = (c.req.query("date") ?? "").slice(0, 10);
  const after = (c.req.query("after") ?? "").slice(0, 5);
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ ok: false, code: "bad_request", need: "mode, from, to, date=YYYY-MM-DD" }, 400);
  }

  const r = await findTrains({ mode, from, to, date, ...(after ? { after } : {}), limit: 6 });
  return c.json({ tdx: tdxEnabled(), ...r });
});
