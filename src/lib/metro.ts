import metro from "../data/metro.json" with { type: "json" };
import type { LangCode } from "../types.js";
import { WARN } from "./warn-text.js";

type Db = {
  fetchedAt: string;
  lines: Record<string, { city: string; operator: string; name: string; en: string; aliases: string[] }>;
  stations: Record<string, { city: string; lines: string[]; en: string; display: string }>;
  /** 每條線的實際營運路線（含支線），順序即相鄰關係 */
  routes: Record<string, string[][]>;
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
 * 比對前把全形標點換成半形。
 *
 * 線上實測：模型寫「台北 101／世貿站」（全形斜線），資料裡是「台北101/世貿」，
 * 兩個字串永遠對不起來 —— 那一站的所有站數檢查都靜靜失效，
 * 同一趟裡兩處錯誤（2 站寫成 3 站、5 站寫成 7 站）就這樣漏掉。
 */
function halfWidth(x: string): string {
  return String(x ?? "")
    .replace(/／/g, "/")
    .replace(/－|—|–/g, "-")
    .replace(/．/g, ".")
    .replace(/：/g, ":")
    .replace(/＆/g, "&");
}

function normKey(x: string): string {
  return halfWidth(x).replace(SQUASH, "");
}

/** 一處站數宣稱，座標是「原文」的，才splice 得回去 */
export type CountHit = {
  start: number;
  end: number;
  said: number;
  real: number;
  from: string;
  to: string;
  lineKey: string;
  arabic: boolean;
};

/** 把空白拿掉，同時記住每個字在原文的位置 */
function squashWithMap(masked: string): { body: string; map: number[] } {
  let body = "";
  const map: number[] = [];
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i]!;
    if (/[\s　]/.test(c)) continue;
    body += c;
    map.push(i);
  }
  return { body, map };
}

/**
 * 找出句子裡所有「搭 N 站」的宣稱，並算出真正是幾站。
 *
 * 這是線上實測抓到的：台北一日行程四段捷運，三段的站數是錯的
 * （「中正紀念堂往象山四站到台北101」實際是五站）。旅客會看著月台
 * 跑馬燈數站，數到第四站下車就下錯了 —— 而畫面上完全看不出來。
 *
 * 只在有把握時才判斷：句子裡要能明確定出「哪一條線、從哪站到哪站」，
 * 而且兩站都在該線的路網圖上，定不出來就放過。
 */
export function scanStopCounts(text: string, dest: string): CountHit[] {
  const cities = citiesFor(dest);
  if (!cities.length || !text) return [];
  // 「A 或 B」兩種走法混在一句裡，站數對不到哪一段。
  //
  // 但只有「或」出現還不夠 —— 「捷運台北車站（R線或BL線月台）」講的是月台不是走法，
  // 原本一律跳過，害那一段的站數錯誤（寫 1 站實際 2 站）整個漏掉。
  // 現在要「或」後面接著移動動詞才算另一種走法。
  if (/(?:或|或是)[^，,。；;]{0,4}?(?:搭|乘|走|步行|轉|坐|騎)|\b(?:or|ou)\b[^,.;]{0,12}?(?:walk|take|ride|prendre|marche)|または[^、。]{0,6}?(?:歩|乗|行)/i.test(text)) {
    return [];
  }

  let masked = blank(text, /往[^，,。；;]{1,8}?方向/g);
  const mentioned: string[] = [];
  for (const [key, l] of Object.entries(DB.lines)) {
    if (!cities.includes(l.city) || !l.name) continue;
    const names = [l.name, ...(l.aliases || [])].filter(Boolean);
    if (names.some((n) => masked.includes(n))) mentioned.push(key);
    for (const n of names) masked = blank(masked, new RegExp(escape(n), "g"));
  }

  // 空白全部拿掉再比對：模型會寫「台北 101/世貿站」，資料裡是「台北101/世貿」
  const { body, map } = squashWithMap(halfWidth(masked));

  type Hit = { at: number; display: string; lines: string[] };
  const hits: Hit[] = [];
  for (const [, st] of Object.entries(DB.stations)) {
    if (!cities.includes(st.city) || st.display.length < 2) continue;
    const d = normKey(st.display);
    for (let i = body.indexOf(d); i !== -1; i = body.indexOf(d, i + 1)) {
      const rest = body.slice(i + d.length);
      if (!/站$/.test(d) && !/^(?:捷運站|車站|站)/.test(rest)) continue;
      hits.push({ at: i, display: st.display, lines: st.lines });
    }
  }
  if (hits.length < 2) return [];
  hits.sort((a, b) => a.at - b.at);

  const out: CountHit[] = [];
  // 「第一站」是序數不是站數，別算進來
  const re = /(?<!第)(\d{1,2}|十[一二三四五六七八九]|[一兩二三四五六七八九十])站/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const said = toCount(m[1]!);
    if (said < 1 || said > 40) continue;
    const at = m.index;
    const before = [...hits]
      .reverse()
      .filter((h) => h.at + normKey(h.display).length <= at);
    const prev = before[0];

    // 兩種寫法，配對方式相反：
    //   「搭 N 站到 B 站」        → 前一個站是起點，後一個站是終點
    //   「至 B 站（N 站）」       → 括號是註解在 B 上，起點是再前面那一站
    // 沒分清楚會把數字改到別段去 —— 實測就發生過：
    //   「至忠孝新生站（1 站），轉中和新蘆線至大橋頭站（5 站）」
    // 那個 1 講的是台北車站→忠孝新生，卻被當成忠孝新生→大橋頭而改成 5。
    // 站名與括號之間還隔著一個「站」字：「忠孝新生站（1 站）」
    const gap =
      prev === undefined
        ? ""
        : body.slice(prev.at + normKey(prev.display).length, at);
    const paren = prev !== undefined && /^(?:捷運站|車站|站)?[（(]$/.test(gap);

    const a = paren ? before[1] : prev;
    const b = paren ? prev : hits.find((h) => h.at >= at + m![0].length);
    if (!a || !b || a.display === b.display) continue;

    // 要能唯一定出是哪一條線，定不出來就放過
    let shared = a.lines.filter((l) => b.lines.includes(l));
    if (mentioned.length) {
      const narrowed = shared.filter((l) => mentioned.includes(l));
      if (narrowed.length) shared = narrowed;
    }
    if (shared.length !== 1) continue;
    const key = shared[0]!;
    const real = hopCount(key, a.display, b.display);
    if (real === undefined || real < 1) continue;

    const s0 = map[at], s1 = map[at + m[1]!.length - 1];
    if (s0 === undefined || s1 === undefined) continue;
    out.push({
      start: s0,
      end: s1 + 1,
      said,
      real,
      from: a.display,
      to: b.display,
      lineKey: key,
      arabic: /^\d+$/.test(m[1]!),
    });
    if (out.length >= 6) break;
  }
  return out;
}

export function checkStopCount(text: string, dest: string, lang: LangCode = "zh-TW"): TransitIssue[] {
  const W = WARN[lang];
  return scanStopCounts(text, dest)
    .filter((h) => h.said !== h.real)
    .slice(0, 2)
    .map((h) => ({
      text: W.stopCount(h.from, h.to, DB.lines[h.lineKey]?.name ?? h.lineKey, h.said, h.real),
    }));
}

const NUM_CN = ["", "一", "兩", "三", "四", "五", "六", "七", "八", "九", "十"];

function writeCount(n: number, arabic: boolean): string {
  if (arabic || n > 10) return String(n);
  return NUM_CN[n] ?? String(n);
}

/**
 * 站數不只是報錯，直接改對。
 *
 * 加了 prompt 規則之後錯誤率從 50% 掉到 27%，但壓不到零 —— 因為數站是
 * 「數數」不是「回想」，模型本來就不擅長。既然有把握說「你寫五站是錯的」，
 * 就有把握把它改成四站。警告只告訴使用者這裡有問題，修正直接給他答案。
 *
 * 改完會回報改了什麼，讓卡片上寫清楚，而不是偷偷動模型寫的字。
 */
export function fixStopCounts(
  text: string,
  dest: string,
  lang: LangCode = "zh-TW",
  /**
   * 只當上下文、不會被改到的前綴。
   *
   * 卡片標題常寫「東門站 → 北投站」，而「怎麼去」只寫「搭 16 站到北投站」——
   * 起點根本不在被檢查的字串裡，配不成對就整段放過。線上實測一趟台北行程
   * 有三段站數錯（16→15、27→18、1→2）全部漏掉，就是這個原因。
   */
  context = "",
): { text: string; notes: string[] } {
  const prefix = context ? `${context}\n` : "";
  const combined = prefix + text;
  const hits = scanStopCounts(combined, dest).filter(
    // 前綴只是上下文，落在前綴裡的數字不能動
    (h) => h.said !== h.real && h.start >= prefix.length,
  );
  if (!hits.length) return { text, notes: [] };

  const W = WARN[lang];
  const notes: string[] = [];
  let out = combined;
  // 由後往前改，前面的座標才不會跑掉
  for (const h of [...hits].sort((x, y) => y.start - x.start)) {
    out = out.slice(0, h.start) + writeCount(h.real, h.arabic) + out.slice(h.end);
  }
  out = out.slice(prefix.length);
  for (const h of hits) {
    notes.push(W.stopFixed(h.from, h.to, DB.lines[h.lineKey]?.name ?? h.lineKey, h.said, h.real));
  }
  return { text: out, notes: notes.slice(0, 3) };
}

/**
 * 一條線上兩站之間隔幾站，走真正的路網圖。
 *
 * 不能用序號相減：`StationOfLine` 把支線接在主線後面，新北投的序號是 28、
 * 北投是 21，相減得 7 —— 實際上它們相鄰。`StationOfRoute` 分得出支線
 * （R-3 就是北投↔新北投兩站），把每條營運路線的相鄰關係併起來再走 BFS 才對。
 */
const adjCache = new Map<string, Map<string, Set<string>>>();

function adjacency(lineKey: string): Map<string, Set<string>> | undefined {
  const hit = adjCache.get(lineKey);
  if (hit) return hit;
  const routes = DB.routes?.[lineKey];
  if (!routes?.length) return undefined;
  const g = new Map<string, Set<string>>();
  const link = (x: string, y: string) => {
    if (!g.has(x)) g.set(x, new Set());
    g.get(x)!.add(y);
  };
  for (const r of routes) {
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1]!, b = r[i]!;
      link(a, b);
      link(b, a);
    }
  }
  adjCache.set(lineKey, g);
  return g;
}

/**
 * 環狀線一律不判斷站數。
 *
 * 高雄環狀輕軌是真的一個圈（首尾相接）：駁二大義到愛河之心，順時針 13 站、
 * 逆時針 25 站，兩個都對，看你往哪邊搭。BFS 只會給比較短的那個 ——
 * 而句子寫的是「順時針方向」。報錯報錯了只是講錯一句話，
 * **改**錯了是把錯的數字寫進行程裡，使用者不會知道。寧可不碰。
 *
 * 台北環狀線目前資料上首尾沒接起來（大坪林↔新北產業園區），還算得出來。
 */
function isLoop(lineKey: string): boolean {
  const routes = DB.routes?.[lineKey];
  if (!routes?.length) return false;
  return routes.some((r) => r.length > 2 && r[0] === r[r.length - 1]);
}

export function hopCount(lineKey: string, from: string, to: string): number | undefined {
  if (isLoop(lineKey)) return undefined;
  const g = adjacency(lineKey);
  if (!g) return undefined;
  const a = normStation(from), b = normStation(to);
  if (a === b) return 0;
  if (!g.has(a) || !g.has(b)) return undefined;
  const seen = new Set([a]);
  let front = [a], d = 0;
  while (front.length && d < 60) {
    d++;
    const next: string[] = [];
    for (const cur of front) {
      for (const nb of g.get(cur) ?? []) {
        if (seen.has(nb)) continue;
        if (nb === b) return d;
        seen.add(nb);
        next.push(nb);
      }
    }
    front = next;
  }
  return undefined;
}

/**
 * 從「東門站 → 北投站」這種標題取出起點。
 * 整個標題不能直接拿來當上下文：裡面的終點站會跟「怎麼去」裡的終點站
 * 配成同一站，判斷式看到頭尾一樣就整段放過了。
 */
export function originOf(name: string): string {
  const m = /^(.*?)\s*(?:→|->|➞|⇒|~|～)\s*.+$/u.exec(String(name || ""));
  return (m ? m[1] : name) ?? "";
}

/**
 * 「東門站 → 北投站」的北投站。用來當「下一站」的起點上下文。
 *
 * 線上實測第三種漏法：「步行返回捷運台北101/世貿站」之後接
 * 「捷運至台北車站 — 搭淡水信義線往淡水方向 5 站」，
 * 起點既不在這一站的標題也不在 howTo 裡，而是在**上一站**。
 * 實際 7 站、寫 5 站，整段靜靜放過。
 */
export function destOf(name: string): string {
  const m = /^.+?\s*(?:→|->|➞|⇒|~|～)\s*(.+)$/u.exec(String(name || ""));
  return (m ? m[1] : name) ?? "";
}


/* ───────── 給 leg.ts 用的查詢介面 ───────── */

/** 目的地字串 → 涵蓋哪些城市（leg.ts 要用同一套判斷） */
export function citiesForPublic(dest: string): string[] {
  return citiesFor(dest);
}

/** 這條線的所有營運路線（每條是照順序的站名陣列） */
export function routesOf(lineKey: string): string[][] {
  return DB.routes?.[lineKey] ?? [];
}

/** 站名 → 站資料。認不出來回 undefined，不要猜 */
export function stationOf(
  name: string,
  cities: string[],
): { display: string; lines: string[] } | undefined {
  const direct = lookupStation(name, cities);
  if (direct) return direct;
  // 「Taipei Main Station (台北車站)」這種寫法，把中文挖出來再查一次
  const zh = cjkOf(name);
  return zh && zh !== name ? lookupStation(zh, cities) : undefined;
}

function lookupStation(
  name: string,
  cities: string[],
): { display: string; lines: string[] } | undefined {
  const q = normKey(normStation(name));
  if (!q) return undefined;
  let best: { display: string; lines: string[] } | undefined;
  for (const [, st] of Object.entries(DB.stations)) {
    if (!cities.includes(st.city)) continue;
    if (normKey(normStation(st.display)) === q) return { display: st.display, lines: st.lines };
    // 「台北車站」與「台北」這種包含關係，取最長的那個
    if (q.includes(normKey(normStation(st.display))) && st.display.length >= 2) {
      if (!best || st.display.length > best.display.length) best = { display: st.display, lines: st.lines };
    }
  }
  return best;
}

/**
 * 路線名 → lineKey。反過來（asName=true）則是 lineKey → 中文名。
 * 別名一併認：「藍線」就是板南線。
 */
export function lineOf(name: string, cities: string[], asName = false): string | undefined {
  if (asName) return DB.lines[name]?.name;
  const q = normKey(cjkOf(name));
  if (!q) return undefined;
  for (const [key, l] of Object.entries(DB.lines)) {
    if (!cities.includes(l.city)) continue;
    const names = [l.name, ...(l.aliases || [])].filter(Boolean);
    if (names.some((n) => normKey(n) === q || q.includes(normKey(n)))) return key;
  }
  return undefined;
}

/**
 * 從「Taipei Main Station (台北車站)」裡把中文拿出來。
 *
 * 介面語言不是中文時，i18n 規則要求名稱寫成「譯名（中文原文）」，
 * 於是 legs 裡的 from/to 長這樣。照字面查一定查不到 ——
 * 線上實測的英文行程站數與方向整片消失，就是這個原因。
 */
export function cjkOf(name: string): string {
  const runs = String(name ?? "").match(/[\u3400-\u9FFF]+/g);
  if (!runs?.length) return String(name ?? "");
  return runs.sort((a, b) => b.length - a.length)[0]!;
}
