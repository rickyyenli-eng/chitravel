import { config } from "../config.js";

export type TavilyResult = { title: string; url: string; content: string };

/**
 * Tavily 搜尋。沒設定金鑰時回空陣列 —— 呼叫端據此靜靜跳過查證，
 * 而不是讓整趟行程失敗。
 */
export async function tavilySearch(
  query: string,
  opts: { maxResults?: number; signal?: AbortSignal } = {},
): Promise<TavilyResult[]> {
  if (!config.tavilyKey) return [];

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.tavilyKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      topic: "general",
      max_results: opts.maxResults ?? 6,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as { results?: unknown };
  if (!Array.isArray(json.results)) return [];

  return json.results.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      title: String(o.title ?? ""),
      url: String(o.url ?? ""),
      content: String(o.content ?? ""),
    };
  });
}
