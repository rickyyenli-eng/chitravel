import { config } from "./config.js";
import { extractJson } from "./lib/json.js";
import { tavilySearch } from "./lib/tavily.js";
import { ask } from "./llm.js";
import type { PlanRequest, Stop } from "./types.js";

export type Candidate = { name: string; note: string; url: string; district: string };

const VERIFY_SYSTEM = [
  "你的工作是從搜尋結果裡「抽取」實際存在的店家或場所，不是「推薦」。",
  "絕對不可以寫出搜尋結果中沒有出現的名稱。寧可回空陣列，也不要補一個看起來合理的店名。",
  "只輸出 JSON 陣列，不寫任何說明文字。",
].join("\n");

/**
 * 拿一個模型自己都說「沒指名」或「沒查證」的 stop，去搜尋找出真的存在的候選。
 *
 * 三道防線確保候選既真實、又在對的地方：
 * 1. 抽取提示只給搜尋結果與編號，模型回傳編號，網址由這邊對回去 —— 模型碰不到網址。
 * 2. 回來的名稱必須逐字出現在搜尋結果原文裡，否則丟掉。
 * 3. 地區必須對得上這一站的 area，否則丟掉 —— 搜尋常常回「全市懶人包」，
 *    裡面的店散落各區，不濾掉會害使用者走冤枉路。
 */
export async function verifyStop(
  form: PlanRequest,
  stop: Stop,
  signal?: AbortSignal,
): Promise<Candidate[]> {
  // 把地區跟類型拆開下關鍵字，比整串店名描述更容易搜到在地結果
  const area = stop.area.trim();
  const kindHint = stop.kind === "food" ? "推薦 營業時間 地址" : "推薦 地址";
  const query = [form.to, area, stop.name, kindHint].filter(Boolean).join(" ");

  const results = await tavilySearch(query, { maxResults: 6, signal });
  if (results.length === 0) return [];

  const corpus = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content.slice(0, 700)}`)
    .join("\n\n");

  const needs = form.needs.length ? form.needs.join("、") : "無";
  const prompt = [
    `以下是「${form.to} ${area} ${stop.name}」的搜尋結果。`,
    `使用者的條件：${needs}。`,
    "",
    corpus,
    "",
    "從上面找出最多 5 個「確實有出現在結果中」的具體店家或場所，回傳 JSON 陣列：",
    '[{"name":"店家名稱","district":"所在行政區或商圈","note":"一句話：地址、賣什麼、營業時間","source":2}]',
    "",
    "規則：",
    "1. name 必須逐字出現在上面的搜尋結果裡，不可以改寫、簡化或自己組合。",
    "2. district 只能填搜尋結果裡讀得到的地區；讀不到就填空字串，不要用猜的。",
    "3. source 是引用的結果編號（上面的方括號數字）。",
    "4. note 只能寫結果裡讀得到的資訊。",
    "5. 找不到明確的店名就回 []。這是可以接受的答案。",
  ].join("\n");

  const res = await ask({
    system: VERIFY_SYSTEM,
    prompt,
    model: config.extractModel,
    maxTokens: 1100,
    prefill: "[",
    signal,
  });

  const raw = extractJson(res.text);
  if (!Array.isArray(raw)) return [];

  const token = areaToken(area);
  const out: Candidate[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    if (!name) continue;

    // 防線二：名稱沒真的出現在搜尋結果裡就丟掉
    if (!corpus.includes(name)) continue;

    const district = String(o.district ?? "").trim();
    const note = String(o.note ?? "").trim();

    // 防線三：地區對不上就丟掉
    if (token && !`${district} ${note} ${name}`.includes(token)) continue;

    const idx = Number(o.source);
    const src = Number.isInteger(idx) ? results[idx - 1] : undefined;
    out.push({ name, note, district, url: src?.url ?? "" });
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * 從 area 取出最短的可比對詞。
 * 「鹽埕區」→「鹽埕」、「五福商圈」→「五福」、「旗津老街」→「旗津」。
 * 太短（少於兩個字）就放棄比對，寧可不濾也不要濾錯。
 */
function areaToken(area: string): string {
  const core = area.replace(/(市|區|鄉|鎮|商圈|老街|一帶|周邊|附近)$/g, "").trim();
  return core.length >= 2 ? core : "";
}
