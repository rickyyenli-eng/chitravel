import {
  allCities,
  cjkOf,
  citiesForPublic,
  hopCount,
  lineOf,
  normStation,
  routesOf,
  stationOf,
} from "./metro.js";
import type { Leg } from "../types.js";
import type { LangCode } from "../types.js";
import { WARN } from "./warn-text.js";

/**
 * 把結構化的移動段變成句子，並在過程中用真實路網把每個欄位驗過。
 *
 * 這裡是整個專案的轉折點：以前是模型寫句子、我們事後解析驗證，
 * 補了四次漏報還是有洞；現在模型只填欄位，句子由我們產生 ——
 * 站數、方向、路線是否經過那兩站，全部算出來而不是讀出來。
 */

export type LegResult = { text: string; issues: string[] };

/** 這條線上從 A 往 B 走，方向牌上寫的是哪一站 */
export function towardOf(lineKey: string, from: string, to: string): string | undefined {
  // routes 存的是正規化後的站名（「台北車站」存成「台北」），比對前要對齊
  const a = normStation(from);
  const b = normStation(to);
  for (const r of routesOf(lineKey)) {
    const i = r.indexOf(a);
    const j = r.indexOf(b);
    if (i === -1 || j === -1 || i === j) continue;
    // 環狀線兩頭都通，說不準方向
    if (r.length > 2 && r[0] === r[r.length - 1]) return undefined;
    // routes 存的是正規化後的名字（台北車站存成台北），顯示要換回官方全名
    const end = j > i ? r[r.length - 1]! : r[0]!;
    return stationOf(end, allCities(), true)?.display ?? end;
  }
  return undefined;
}

function joinNonEmpty(parts: Array<string | undefined>, sep = ""): string {
  return parts.filter((x) => x && x.trim()).join(sep);
}

/** 省略「從 X 站」之後開頭會留下逗號或空白，清掉 */
function tidy(x: string): string {
  return x
    .replace(/^[\s,，、;；]+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 「台北車站」已經有站字了，不要變成「台北車站站」 */
function zhStation(name: string): string {
  return /站$/.test(name) ? name : `${name}站`;
}
function jaStation(name: string): string {
  return /站$|駅$/.test(name) ? name : `${name}駅`;
}

/**
 * 一段捷運。line / from / to 是模型填的，往哪個方向與幾站是我們算的。
 * 算不出來就照實少寫，不要編。
 */
function metroText(leg: Leg, lang: LangCode, dest: string, issues: string[], sameAsPrev = false): string {
  const W = WARN[lang];
  const cities = citiesForPublic(dest);
  let from = stationOf(leg.from, cities);
  let to = stationOf(leg.to, cities);

  // 機場捷運跨桃園與台北，目的地寫「台北」時桃園那頭查不到。
  // 全國找一次，但要求兩站共用一條線 —— 不然台北與台中都有市政府，會配錯。
  if (!from || !to) {
    const wide = allCities();
    const f2 = stationOf(leg.from, wide, true) ?? from;
    const t2 = stationOf(leg.to, wide, true) ?? to;
    if (f2 && t2 && f2.lines.some((l) => t2.lines.includes(l))) {
      from = f2;
      to = t2;
    }
  }
  let lineKey = lineOf(leg.line, cities);
  // 路線沒填（或填了認不出來），但兩站剛好只共用一條線 —— 那就是它，不用猜
  if (!lineKey && from && to) {
    const shared = from.lines.filter((l) => to.lines.includes(l));
    if (shared.length === 1) lineKey = shared[0];
  }
  const lineName = leg.line || (lineKey ? (lineOf(lineKey, cities, true) ?? "") : "");

  // 路線認得、兩站也認得，才有辦法驗與算
  if (lineKey && from && to) {
    for (const st of [from, to]) {
      if (!st.lines.includes(lineKey)) {
        const real = st.lines.map((k) => lineOf(k, cities, true) ?? k).join("、");
        issues.push(W.notOnLine(st.display, leg.line, real));
      }
    }
  }

  const n = lineKey && from && to ? hopCount(lineKey, from.display, to.display) : undefined;
  const toward = lineKey && from && to ? towardOf(lineKey, from.display, to.display) : undefined;
  // 上一段的終點就是這一段的起點時不要重複寫，不然變成
  // 「…到忠孝復興站，轉從忠孝復興站搭…」
  const fromName = sameAsPrev ? "" : from?.display || leg.from;
  const toName = to?.display || leg.to;
  const exit = leg.exit ? String(leg.exit).replace(/[^0-9A-Za-z]/g, "") : "";

  if (lang === "en") {
    return joinNonEmpty([
      fromName ? `From ${fromName}` : "",
      lineName ? ` take the ${lineName}` : " take the metro",
      toward ? ` toward ${toward}` : "",
      n ? `, ${n} stop${n > 1 ? "s" : ""}` : "",
      toName ? ` to ${toName}` : "",
      exit ? `, exit ${exit}` : "",
    ]);
  }
  if (lang === "fr") {
    return joinNonEmpty([
      fromName ? `Depuis ${fromName}` : "",
      lineName ? `, prendre la ${lineName}` : ", prendre le métro",
      toward ? ` direction ${toward}` : "",
      n ? `, ${n} station${n > 1 ? "s" : ""}` : "",
      toName ? ` jusqu'à ${toName}` : "",
      exit ? `, sortie ${exit}` : "",
    ]);
  }
  if (lang === "ja") {
    return joinNonEmpty([
      fromName ? `${jaStation(fromName)}から` : "",
      lineName || "地下鉄",
      toward ? `（${toward}方面）` : "",
      "に乗り",
      n ? `、${n} 駅先の` : "、",
      toName ? `${jaStation(toName)}で下車` : "",
      exit ? `、${exit} 番出口` : "",
    ]);
  }
  return joinNonEmpty([
    fromName ? `從${zhStation(fromName)}` : "",
    lineName ? `搭${lineName}` : "搭捷運",
    toward ? `往${toward}方向` : "",
    n ? `，${n} 站` : "",
    toName ? `${n ? "" : "，"}到${zhStation(toName)}` : "",
    exit ? `，${exit} 號出口` : "",
  ]);
}

function railText(leg: Leg, lang: LangCode, trains?: Record<string, { depart: string; arrive: string }>): string {
  const no = leg.trainNo ? String(leg.trainNo).replace(/[^0-9A-Za-z]/g, "") : "";
  const line = leg.line || "";
  // 時刻直接從真實班表填，不讓模型寫 —— 它會抄對車次卻算錯抵達
  const t = no ? trains?.[no] ?? trains?.[no.padStart(4, "0")] : undefined;
  const when =
    t &&
    (lang === "en"
      ? ` (departs ${t.depart}, arrives ${t.arrive})`
      : lang === "fr"
        ? ` (départ ${t.depart}, arrivée ${t.arrive})`
        : lang === "ja"
          ? `（${t.depart} 発 → ${t.arrive} 着）`
          : `（${t.depart} 發車→${t.arrive} 抵達）`);
  if (lang === "en") {
    return joinNonEmpty([
      leg.from ? `From ${leg.from}` : "",
      line ? ` take the ${line}` : " take the train",
      no ? ` train ${no}` : "",
      leg.to ? ` to ${leg.to}` : "",
      when || "",
    ]);
  }
  if (lang === "fr") {
    return joinNonEmpty([
      leg.from ? `Depuis ${leg.from}` : "",
      line ? `, prendre le ${line}` : ", prendre le train",
      no ? ` n° ${no}` : "",
      leg.to ? ` jusqu'à ${leg.to}` : "",
      when || "",
    ]);
  }
  if (lang === "ja") {
    return joinNonEmpty([
      leg.from ? `${leg.from}から` : "",
      line || "列車",
      no ? ` ${no} 号` : "",
      leg.to ? `に乗り${leg.to}へ` : "に乗車",
      when || "",
    ]);
  }
  return joinNonEmpty([
    leg.from ? `於${leg.from}` : "",
    `搭${line || "火車"}`,
    no ? ` ${no} 車次` : "",
    leg.to ? `至${leg.to}` : "",
    when || "",
  ]);
}

function plainText(leg: Leg, lang: LangCode): string {
  const m = leg.minutes;
  const to = leg.to;
  const verb: Record<LangCode, Record<string, string>> = {
    "zh-TW": { walk: "步行", bus: "搭公車", taxi: "搭計程車", other: "前往" },
    en: { walk: "Walk", bus: "Take the bus", taxi: "Take a taxi", other: "Head" },
    fr: { walk: "Marcher", bus: "Prendre le bus", taxi: "Prendre un taxi", other: "Aller" },
    ja: { walk: "徒歩", bus: "バス", taxi: "タクシー", other: "移動" },
  };
  const v = verb[lang][leg.mode] ?? verb[lang].other!;
  if (lang === "en") return joinNonEmpty([v, m ? ` ${m} min` : "", to ? ` to ${to}` : ""]);
  if (lang === "fr") return joinNonEmpty([v, m ? ` ${m} min` : "", to ? ` jusqu'à ${to}` : ""]);
  if (lang === "ja") return joinNonEmpty([v, m ? ` ${m} 分` : "", to ? `で${to}へ` : ""]);
  return joinNonEmpty([v, m ? ` ${m} 分鐘` : "", to ? `至${to}` : ""]);
}

const JOIN_RIDE: Record<LangCode, string> = { "zh-TW": "，轉", en: ", then ", fr: ", puis ", ja: "、乗り換えて" };
const JOIN_PLAIN: Record<LangCode, string> = { "zh-TW": "，", en: ", then ", fr: ", puis ", ja: "、" };

/**
 * 把整段交通寫成一句話。回傳的 issues 是「模型填錯欄位」才有 ——
 * 站數與方向不會出現在 issues 裡，因為那兩個根本不是模型填的。
 */
/**
 * 模型會把機場捷運歸成 rail（線上實測），於是走了不算站數的分支。
 * 判準很清楚：有車次的才是台鐵高鐵；沒有車次而路線名在捷運資料裡查得到的，
 * 就是捷運。不靠模型分類正確，自己判一次。
 */
function realMode(leg: Leg): Leg["mode"] {
  if (leg.mode === "rail" && !leg.trainNo && leg.line) {
    if (lineOf(leg.line, allCities())) return "metro";
  }
  return leg.mode;
}

export function renderLegs(
  legs: Leg[],
  lang: LangCode,
  dest: string,
  trains?: Record<string, { depart: string; arrive: string }>,
): LegResult {
  const issues: string[] = [];
  const parts: string[] = [];
  let prevTo = "";
  for (const leg of legs) {
    const same = Boolean(leg.from) && normStation(cjkOf(leg.from)) === normStation(cjkOf(prevTo));
    const mode = realMode(leg);
    if (mode === "metro") parts.push(tidy(metroText(leg, lang, dest, issues, same)));
    else if (mode === "rail") parts.push(tidy(railText(leg, lang, trains)));
    else parts.push(tidy(plainText(leg, lang)));
    if (leg.to) prevTo = leg.to;
  }
  let text = "";
  legs.forEach((leg, i) => {
    const piece = parts[i];
    if (!piece) return;
    if (!text) { text = piece; return; }
    const ride = realMode(leg) === "metro" || realMode(leg) === "rail";
    text += (ride ? JOIN_RIDE[lang] : JOIN_PLAIN[lang]) + piece;
  });
  return { text, issues: issues.slice(0, 3) };
}
