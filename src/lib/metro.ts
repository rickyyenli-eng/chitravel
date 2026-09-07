import metro from "../data/metro.json" with { type: "json" };
import type { LangCode } from "../types.js";
import { WARN } from "./warn-text.js";

type Db = {
  fetchedAt: string;
  lines: Record<string, { city: string; operator: string; name: string; en: string; aliases: string[] }>;
  stations: Record<
    string,
    { city: string; lines: string[]; seq?: Record<string, number>; en: string; display: string }
  >;
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
    .filter(([, now]) => cities.some((c) => DB.stations[`${c}|${normStation(now)}`]))
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

/**
 * 站名後面要真的接著「站」之類的字，才算這段話在講那個車站。
 *
 * 「松山文創園區」裡有「松山」，但那是園區不是車站；只用 includes 比對
 * 會把它當成行程站，然後跳出一個假警告。這是線上抓到的第二種同類錯誤
 * （第一種是路線名「中和新蘆線」裡的「中和」）。
 *
 * 代價是模型寫「搭板南線到西門」這種沒帶「站」的句子會漏檢 ——
 * 漏報可以接受，誤報不行。
 */
// 中間允許空白：剃掉路線名之後「駁二大義輕軌站」會變成「駁二大義 站」
const STATION_MARK = /^\s*(?:捷運站|車站|站|駅|[)\uff09]|(?:station|sta\b|gare)\b)/i;

function mentionsStation(body: string, display: string): boolean {
  // 官方名稱本身就以「站」結尾（台北車站、高鐵桃園站）不用再要求後綴
  if (/站$/.test(display)) return body.includes(display);
  for (let i = body.indexOf(display); i !== -1; i = body.indexOf(display, i + 1)) {
    if (STATION_MARK.test(body.slice(i + display.length))) return true;
  }
  return false;
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

  // 剃掉三種會被誤認成「行程站」的東西：
  //   1. 「往象山方向」— 那是終點站，不是這趟會停的站
  //   2. 路線名 — 「中和新蘆線」裡有「中和」，而中和真的是個站
  //   3. 已改名的舊名 — 上面已經單獨處理過，別再進站名比對
  const noDirection = text
    .replace(/往[^，,。；;]{1,8}?方向/g, " ")
    .replace(/(?:direction|vers|方面)\s*[^，,。；;]{1,20}/gi, " ");

  // 路線名要用「還沒剃掉路線名」的文字來找，不然等於自己把線索抹掉
  const mentioned: string[] = [];
  let body = noDirection;
  for (const [key, l] of Object.entries(DB.lines)) {
    if (!cities.includes(l.city) || !l.name) continue;
    const names = [l.name, ...(l.aliases || [])].filter(Boolean);
    if (names.some((n) => noDirection.includes(n))) mentioned.push(key);
    for (const n of names) body = body.split(n).join(" ");
  }

  // 這一段是用走的：沒搭車就沒有「該在同一條線上」的問題
  const onFoot = /步行|走路|徒歩|marche|à pied|on foot|walk/i.test(text);

  // 「A 或 B」這種二選一的敘述，句子裡的站分屬不同走法，
  // 「所有站都該在同一條線上」的前提就不成立：
  //   「從鹽埕埔站步行 12 分鐘，或搭輕軌至駁二大義站」
  // 鹽埕埔在橘線、駁二大義在環狀輕軌，兩個都對，但湊在一起看就像錯的。
  const hasAlternative = /或|或是|\bor\b|\bou\b|または|もしくは/i.test(text);

  // 舊站名：模型的訓練資料裡多半是舊的，但月台上寫的是新的。
  // 只在「明講是車站」或「往舊名方向」時才報 —— 「西子灣風景區」是景點不是站，
  // 那個西子灣沒有改名，警告會變成誤導。
  for (const [old, now] of Object.entries(DB.renamed)) {
    const cur = cities.map((c) => DB.stations[`${c}|${normStation(now)}`]).find(Boolean);
    if (!cur) continue;
    const asStation =
      text.includes(`${old}站`) || text.includes(`${old}捷運站`) || text.includes(`往${old}`);
    if (asStation && !text.includes(now)) {
      issues.push({ text: W.renamed(old, now) });
    }
  }

  // 找出這段話提到了哪些「本地有的」捷運站
  const found: Array<{ display: string; lines: string[] }> = [];
  for (const [, s] of Object.entries(DB.stations)) {
    if (!cities.includes(s.city)) continue;
    if (s.display.length < 2) continue;
    if (mentionsStation(body, s.display)) found.push({ display: s.display, lines: s.lines });
  }
  // 站數不足就無從判斷路線，但前面抓到的改名警告要留著
  if (found.length < 2) return issues;

  // 長站名會包含短站名（例如「台北車站」含「台北」），只留最長的那些
  const uniq = found
    .filter((a) => !found.some((b) => b !== a && b.display.includes(a.display)))
    .slice(0, 6);
  if (uniq.length < 2) return issues;

  if (mentioned.length === 1 && !hasAlternative) {
    // 只提到一條線、又沒有「或」的替代走法 = 一條線走到底，
    // 那所有提到的站都該在那條線上
    const lineKey = mentioned[0]!;
    const off = uniq.filter((s) => !s.lines.includes(lineKey));
    if (off.length && off.length < uniq.length) {
      const lineName = DB.lines[lineKey]?.name ?? lineKey;
      for (const s of off) {
        const real = s.lines.map((k) => DB.lines[k]?.name ?? k).join("、");
        issues.push({ text: W.notOnLine(s.display, lineName, real) });
      }
    }
  } else if (mentioned.length >= 2) {
    // 提到兩條以上 = 在講轉乘。哪一段搭哪條線無從逐句對應，
    // 只檢查「每個站至少在其中一條線上」—— 這樣仍抓得到硬湊的站，
    // 又不會把正確的轉乘敘述誤判成錯誤。
    for (const s of uniq) {
      if (!s.lines.some((l) => mentioned.includes(l))) {
        const real = s.lines.map((k) => DB.lines[k]?.name ?? k).join("、");
        const names = mentioned.map((k) => DB.lines[k]?.name ?? k).join("、");
        issues.push({ text: W.notOnLine(s.display, names, real) });
      }
    }
  } else if (!onFoot) {
    // 沒說路線，那至少檢查頭尾兩站有沒有共線；沒有的話就是漏了轉乘。
    // 但走路過去的段落不算 —— 「市政府站步行至松山文創園區」不需要共線。
    const a = uniq[0], b = uniq[uniq.length - 1];
    if (a && b && !a.lines.some((l) => b.lines.includes(l))) {
      issues.push({ text: W.needTransfer(a.display, b.display) });
    }
  }
  return issues.slice(0, 3);
}

export const metroFetchedAt = DB.fetchedAt;

/* ─────────────────────────── 「搭幾站」 ─────────────────────────── */

const CN_NUM: Record<string, number> = {
  一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

function toCount(raw: string): number {
  const s = raw.trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (CN_NUM[s]) return CN_NUM[s]!;
  const m = /^十([一二三四五六七八九])$/.exec(s);
  if (m) return 10 + (CN_NUM[m[1]!] ?? 0);
  return 0;
}

/** 用等長空白蓋掉，位置才不會跑掉 —— 後面要靠先後順序判斷哪一站在前 */
function blank(text: string, re: RegExp): string {
  return text.replace(re, (m) => " ".repeat(m.length));
}

const SQUASH = /[\s　]/g;

/**
 * 檢查「搭 N 站到某站」的 N 對不對。
 *
 * 這是線上實測抓到的：台北一日行程四段捷運，三段的站數是錯的
 * （「中正紀念堂往象山四站到台北101」實際是五站）。旅客會看著月台
 * 跑馬燈數站，數到第四站下車就下錯了 —— 而畫面上完全看不出來。
 *
 * 一樣只在有把握時才報：句子裡要能明確定出「哪一條線、從哪站到哪站」，
 * 定不出來就放過。
 */
export function checkStopCount(text: string, dest: string, lang: LangCode = "zh-TW"): TransitIssue[] {
  const cities = citiesFor(dest);
  if (!cities.length || !text) return [];
  // 「A 或 B」兩種走法混在一句裡，站數對不到哪一段
  if (/或|或是|\bor\b|\bou\b|または/i.test(text)) return [];

  let masked = blank(text, /往[^，,。；;]{1,8}?方向/g);
  const mentioned: string[] = [];
  for (const [key, l] of Object.entries(DB.lines)) {
    if (!cities.includes(l.city) || !l.name) continue;
    const names = [l.name, ...(l.aliases || [])].filter(Boolean);
    if (names.some((n) => masked.includes(n))) mentioned.push(key);
    for (const n of names) masked = blank(masked, new RegExp(escape(n), "g"));
  }

  // 空白全部拿掉再比對：模型會寫「台北 101/世貿站」，資料裡是「台北101/世貿」
  const body = masked.replace(SQUASH, "");

  type Hit = { at: number; display: string; lines: string[]; seq: Record<string, number> };
  const hits: Hit[] = [];
  for (const [, st] of Object.entries(DB.stations)) {
    if (!cities.includes(st.city) || st.display.length < 2) continue;
    const d = st.display.replace(SQUASH, "");
    for (let i = body.indexOf(d); i !== -1; i = body.indexOf(d, i + 1)) {
      const rest = body.slice(i + d.length);
      if (!/站$/.test(d) && !/^(?:捷運站|車站|站)/.test(rest)) continue;
      hits.push({ at: i, display: st.display, lines: st.lines, seq: st.seq ?? {} });
    }
  }
  if (hits.length < 2) return [];
  hits.sort((a, b) => a.at - b.at);

  const W = WARN[lang];
  const issues: TransitIssue[] = [];
  // 「第一站」是序數不是站數，別算進來
  const re = /(?<!第)(\d{1,2}|十[一二三四五六七八九]|[一兩二三四五六七八九十])\s*站/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const n = toCount(m[1]!);
    if (n < 1 || n > 40) continue;
    const at = m.index;
    const a = [...hits].reverse().find((h) => h.at + h.display.length <= at);
    const b = hits.find((h) => h.at >= at + m![0].length);
    if (!a || !b || a.display === b.display) continue;

    // 要能唯一定出是哪一條線，定不出來就放過
    let shared = a.lines.filter((l) => b.lines.includes(l));
    if (mentioned.length) {
      const narrowed = shared.filter((l) => mentioned.includes(l));
      if (narrowed.length) shared = narrowed;
    }
    if (shared.length !== 1) continue;
    const key = shared[0]!;
    const sa = a.seq[key], sb = b.seq[key];
    if (typeof sa !== "number" || typeof sb !== "number") continue;

    const real = Math.abs(sa - sb);
    if (real !== n) {
      issues.push({ text: W.stopCount(a.display, b.display, DB.lines[key]?.name ?? key, n, real) });
    }
    if (issues.length >= 2) break;
  }
  return issues;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
