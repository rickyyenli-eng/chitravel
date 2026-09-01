import { config } from "./config.js";
import { extractJson } from "./lib/json.js";
import { tavilySearch } from "./lib/tavily.js";
import { ask } from "./llm.js";
import type { PlanRequest, Stop } from "./types.js";

export type Candidate = { name: string; note: string; url: string };

const VERIFY_SYSTEM = [
  "你的工作是從搜尋結果裡「抽取」實際存在的店家或場所，不是「推薦」。",
  "絕對不可以寫出搜尋結果中沒有出現的名稱。寧可回空陣列，也不要補一個看起來合理的店名。",
  "只輸出 JSON 陣列，不寫任何說明文字。",
].join("\n");

/**
 * 拿一個模型自己都說「沒指名」或「沒查證」的 stop，去搜尋找出真的存在的候選。
 *
 * 兩道防線確保不會又編出東西來：
 * 1. 模型只能引用來源編號，網址由這邊依編號對回去，模型碰不到網址。
 * 2. 回來的名稱必須真的出現在搜尋結果原文裡，否則丟掉。
 */
export async function verifyStop(
  form: PlanRequest,
  stop: Stop,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  const extra = stop.kind === "food" ? "推薦 營業時間" : "推薦";
  const results = await tavilySearch(`${form.to} ${stop.name} ${extra}`, { maxResults: 6, signal });
  if (results.length === 0) return [];

  const corpus = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 700)}`)
    .join("\n\n");

  const needs = form.needs.length ? form.needs.join("、") : "無";
  const prompt = [
    `以下是「${form.to} ${stop.name}」的搜尋結果。`,
    `使用者的條件：${needs}。`,
    "",
    corpus,
    "",
    "從上面找出最多 3 個「確實有出現在結果中」的具體店家或場所名稱，回傳 JSON 陣列：",
    '[{"name":"店家名稱","note":"一句話說明：在哪、賣什麼、大概多少錢或營業時間","source":2}]',
    "",
    "規則：",
    "1. name 必須逐字出現在上面的搜尋結果裡，不可以改寫、簡化或自己組合。",
    "2. source 是引用的結果編號（上面的方括號數字）。",
    "3. note 只能寫結果裡讀得到的資訊，讀不到就寫得保守一點。",
    "4. 找不到明確的店名就回 []。這是可以接受的答案。",
  ].join("\n");

  const res = await ask({
    system: VERIFY_SYSTEM,
    prompt,
    model: config.extractModel,
    maxTokens: 900,
    prefill: "[",
    signal,
  });

  const raw = extractJson(res.text);
  if (!Array.isArray(raw)) return [];

  const out: Candidate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    if (!name) continue;

    // 防線二：名稱沒真的出現在搜尋結果裡就丟掉
    if (!corpus.includes(name)) continue;

    const idx = Number(o.source);
    const src = Number.isInteger(idx) ? results[idx - 1] : undefined;
    out.push({
      name,
      note: String(o.note ?? "").trim(),
      url: src?.url ?? "",
    });
    if (out.length >= 3) break;
  }
  return out;
}
