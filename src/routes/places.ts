import { Hono, type Context } from "hono";
import { config } from "../config.js";
import { placesAutocomplete, reverseGeocode } from "../lib/google.js";
import { allow } from "../lib/rate-limit.js";

export const placesRoute = new Hono();

/** 自動完成是每打一個字就問一次，額度比排行程寬鬆得多 */
function gate(c: Context): boolean {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "local";
  return allow(`places:${ip}`, config.placesRateLimitPerMin);
}

placesRoute.get("/places", async (c) => {
  if (!config.googleKey) return c.json({ ok: false, code: "no_google", suggestions: [] });
  if (!gate(c)) return c.json({ ok: false, code: "rate_limited", suggestions: [] }, 429);

  const q = (c.req.query("q") ?? "").trim();
  const session = (c.req.query("session") ?? "").slice(0, 64);
  if (q.length < 2) return c.json({ ok: true, suggestions: [] });

  try {
    const suggestions = await placesAutocomplete(q.slice(0, 100), session);
    return c.json({ ok: true, suggestions });
  } catch (err) {
    console.error("[places] 失敗", err);
    // 自動完成掛掉不該擋住使用者打字，靜靜回空的就好
    return c.json({ ok: false, code: "upstream_error", suggestions: [] });
  }
});

placesRoute.get("/whereami", async (c) => {
  if (!config.googleKey) return c.json({ ok: false, code: "no_google" });
  if (!gate(c)) return c.json({ ok: false, code: "rate_limited" }, 429);

  const lat = Number(c.req.query("lat"));
  const lng = Number(c.req.query("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return c.json({ ok: false, code: "bad_request" }, 400);
  }

  try {
    const name = await reverseGeocode(lat, lng);
    return name ? c.json({ ok: true, name }) : c.json({ ok: false, code: "not_found" });
  } catch (err) {
    console.error("[whereami] 失敗", err);
    return c.json({ ok: false, code: "upstream_error" });
  }
});
