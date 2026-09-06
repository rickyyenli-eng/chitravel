import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { assertConfig, config } from "./config.js";
import { metroFetchedAt } from "./lib/metro.js";
import { railFetchedAt } from "./lib/rail.js";
import { placesRoute } from "./routes/places.js";
import { planRoute } from "./routes/plan.js";
import { replanRoute } from "./routes/replan.js";

assertConfig();

const startedAt = new Date().toISOString();
const app = new Hono();

// 部署後要能從外面確認「線上跑的是哪一版」。
// RENDER_GIT_COMMIT 是 Render 自動注入的，本機沒有就顯示 dev。
app.get("/healthz", (c) =>
  c.json({
    ok: true,
    model: config.plannerModel,
    commit: (process.env.RENDER_GIT_COMMIT || "dev").slice(0, 7),
    metro: metroFetchedAt,
    rail: railFetchedAt,
    startedAt,
  }),
);
app.route("/api", planRoute);
app.route("/api", placesRoute);
app.route("/api", replanRoute);

// 前端就是一份靜態檔，之後要換成 Vite / Next 再說
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`\n順路走 http://localhost:${info.port}`);
  console.log(`編排模型 ${config.plannerModel}`);
  console.log(`地點自動完成 ${config.googleKey ? "已啟用" : "未設定（退回純文字輸入）"}`);
  console.log(`每分鐘上限 ${config.rateLimitPerMin} 次 · 快取 ${config.cacheTtlSeconds} 秒\n`);
});
