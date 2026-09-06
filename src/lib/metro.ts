import metro from "../data/metro.json" with { type: "json" };
import type { LangCode } from "../types.js";
import { WARN } from "./warn-text.js";

type Db = {
  fetchedAt: string;
  lines: Record<string, { city: string; operator: string; name: string; en: string; aliases: string[] }>;
  stations: Record<string, { city: string; lines: string[]; en: string; display: string }>;
  renamed: Record<string, string>;
};
const DB = metro as Db;

/** 站名比對用：去掉「站」「捷運」與空白，「龍山寺站」與「龍山寺」要對得上 */
export function normStation(name: string): string {
  return String(name || "")
    .replace(/[\s·・]/g, "")
    .replace(/捷運/g, "")
    .replace(/車站$|站$/g, "")
    .trim();
}

function citiesFor(dest: string): string[] {
  const d = String(dest || "");
  const all = new Set<string>();
  for (const s of Object.values(DB.stations)) all.add(s.city);
  const hit = [...all].filter((c) => d.includes(c));
  // 新北的站跟台北是同一個生活圈，查台北就一起帶進來
  if (hit.includes("台北")) hit.push("新北");
  return hit.length ? [...new Set(hit)] : [];
}

/**
 * 給 prompt 用的精簡路網索引。
 * 只放目的地城市的，不然整份塞進去太貴也沒必要。
 */
export function promptIndex(dest: string): string {
  const cities = citiesFor(dest);
  if (!cities.length) return "";

  const lineNames: string[] = [];
  for (const [key, l] of Object.entries(DB.lines)) {
    if (cities.includes(l.city)) lineNames.push(`${key.split(":")[1]}＝${l.name}`);
  }

  const rows: string[] = [];
  for (const [, s] of Object.entries(DB.stations)) {
    if (!cities.includes(s.city)) continue;
    rows.push(`${s.display}:${s.lines.map((k) => k.split(":")[1]).join("+")}`);
  }
  if (!rows.length) return "";

  const renames = Object.entries(DB.renamed)
    .filter(([, now]) => DB.stations[normStation(now)] && cities.includes(DB.stations[normStation(now)]!.city))
    .map(([old, now]) => `${old}→${now}`);

  return [
    `【${cities.join("、")}捷運實際路網 — 這是權威資料，與你的記憶衝突時以這份為準】`,
    `路線代碼：${lineNames.join("、")}`,
    "車站所屬路線（站名:路線代碼，+ 代表這站是轉乘站）：",
    rows.join("、"),
    ...(renames.length
      ? [`已改名的車站（一律用新名，舊名月台上找不到）：${renames.join("、")}`]
      : []),
  ].join("\n");
}

export type TransitIssue = { text: string };

/**
 * 檢查一段交通敘述裡提到的站，是不是真的在它說的那條線上。
 *
 * 只在「有把握」時才報錯 —— 認不出來的站一律放過。
 * 誤報比漏報難處理：使用者看到一堆假警告就會全部忽略，真的錯也跟著被忽略。
 */
export function checkTransit(text: string, dest: string, lang: LangCode = "zh-TW"): TransitIssue[] {
  const cities = citiesFor(dest);
  if (!cities.length || !text) return [];

  const W = WARN[lang];
  const issues: TransitIssue[] = [];

  // 舊站名：模型的訓練資料裡多半是舊的，但月台上寫的是新的
  for (const [old, now] of Object.entries(DB.renamed)) {
    const cur = DB.stations[normStation(now)];
    if (!cur || !cities.includes(cur.city)) continue;
    if (text.includes(old) && !text.includes(now)) {
      issues.push({ text: W.renamed(old, now) });
    }
  }

  // 找出這段話提到了哪些「本地有的」捷運站
  const found: Array<{ display: string; lines: string[] }> = [];
  for (const [, s] of Object.entries(DB.stations)) {
    if (!cities.includes(s.city)) continue;
    if (s.display.length < 2) continue;
    if (text.includes(s.display)) found.push({ display: s.display, lines: s.lines });
  }
  // 站數不足就無從判斷路線，但前面抓到的改名警告要留著
  if (found.length < 2) return issues;

  // 找出這段話提到了哪些路線名
  const mentioned: string[] = [];
  for (const [key, l] of Object.entries(DB.lines)) {
    if (!cities.includes(l.city) || !l.name) continue;
    // 正式名稱或顏色別名，任一命中都算提到了這條線
    if ([l.name, ...(l.aliases || [])].some((n) => n && text.includes(n))) mentioned.push(key);
  }

  // 長站名會包含短站名（例如「台北車站」含「台北」），只留最長的那些
  const uniq = found
    .filter((a) => !found.some((b) => b !== a && b.display.includes(a.display)))
    .slice(0, 6);
  if (uniq.length < 2) return issues;

  if (mentioned.length) {
    // 說了搭某條線，就檢查提到的站是不是真的在那條線上
    for (const lineKey of mentioned) {
      const off = uniq.filter((s) => !s.lines.includes(lineKey));
      if (off.length && off.length < uniq.length) {
        const lineName = DB.lines[lineKey]?.name ?? lineKey;
        for (const s of off) {
          const real = s.lines.map((k) => DB.lines[k]?.name ?? k).join("、");
          issues.push({ text: W.notOnLine(s.display, lineName, real) });
        }
      }
    }
  } else {
    // 沒說路線，那至少檢查頭尾兩站有沒有共線；沒有的話就是漏了轉乘
    const a = uniq[0], b = uniq[uniq.length - 1];
    if (a && b && !a.lines.some((l) => b.lines.includes(l))) {
      issues.push({ text: W.needTransfer(a.display, b.display) });
    }
  }
  return issues.slice(0, 3);
}

export const metroFetchedAt = DB.fetchedAt;
