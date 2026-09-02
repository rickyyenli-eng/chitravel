import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { assertConfig, config } from "./config.js";
import { planRoute } from "./routes/plan.js";

assertConfig();

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, model: config.plannerModel }));
app.route("/api", planRoute);

// 前端就是一份靜態檔，之後要換成 Vite / Next 再說
app.use("/*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(`\n順路走 http://localhost:${info.port}`);
  console.log(`編排模型 ${config.plannerModel}`);
  console.log(`每分鐘上限 ${config.rateLimitPerMin} 次 · 快取 ${config.cacheTtlSeconds} 秒\n`);
});
