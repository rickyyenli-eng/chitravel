/**
 * 列出你的金鑰現在能用哪些模型，把 id 貼到 .env 的 PLANNER_MODEL。
 * 用法：npm run models
 */
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error("找不到 ANTHROPIC_API_KEY，先把 .env 填好。");
  process.exit(1);
}

const models = await new Anthropic({ apiKey: key }).models.list({ limit: 50 });
for (const m of models.data) {
  console.log(`${m.id.padEnd(34)} ${m.display_name}`);
}
