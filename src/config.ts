import "dotenv/config";

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num("PORT", 8787),
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? "",
  /** 綁定身分的金鑰（personal / service account）需要指定 workspace，其他金鑰留空即可 */
  workspaceId: process.env.ANTHROPIC_WORKSPACE_ID ?? "",
  /** Tavily 搜尋金鑰。沒填就跳過查證，行程照常出得來 */
  tavilyKey: process.env.TAVILY_API_KEY ?? "",
  plannerModel: process.env.PLANNER_MODEL ?? "claude-sonnet-4-5",
  extractModel: process.env.EXTRACT_MODEL ?? "claude-haiku-4-5",
  /** MOCK_PLAN=1：用假資料走完整條串流，不呼叫模型、不花錢 */
  mockPlan: process.env.MOCK_PLAN === "1",
  rateLimitPerMin: num("RATE_LIMIT_PER_MIN", 6),
  cacheTtlSeconds: num("CACHE_TTL_SECONDS", 600),
} as const;

export function assertConfig(): void {
  // 模擬模式不呼叫模型，不需要金鑰
  if (config.mockPlan) {
    console.log("[MOCK_PLAN=1] 使用內建假行程，不會呼叫模型。");
    return;
  }
  if (!config.anthropicKey) {
    console.error(
      "\n[設定錯誤] 找不到 ANTHROPIC_API_KEY。\n" +
        "  1. cp .env.example .env\n" +
        "  2. 把金鑰填進 .env\n" +
        "  3. 重新執行 npm run dev\n",
    );
    process.exit(1);
  }
}
