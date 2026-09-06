import type { LangCode } from "../types.js";
import { WARN } from "./warn-text.js";

/**
 * 檢查「排定的時間」有沒有落在「營業時間」內。
 *
 * 實測抓到的真實錯誤：華西街夜市被排在 11:40。夜市中午沒開，
 * 使用者照著走過去會撲空 —— 而且這種錯在畫面上完全看不出來。
 *
 * 原則跟捷運驗證一樣：只在有把握時才報錯。看不懂的營業時間一律放過，
 * 誤報會讓使用者學會忽略所有警告。
 */

/** 24 小時、全年無休這類寫法就不用比了 */
const ALWAYS_OPEN = /24\s*小時|24H|24 ?hours|全天|全年無休|ouvert 24|終日/i;

type Range = { from: number; to: number };

function toMinutes(h: number, m: number): number {
  return h * 60 + m;
}

/** 從「11:30–14:30、17:30-21:00」這種字串抓出所有時段 */
export function parseRanges(hours: string): Range[] {
  const text = String(hours || "");
  if (!text || ALWAYS_OPEN.test(text)) return [];

  const out: Range[] = [];
  // 兩個時刻中間隔著連字號、波浪號或「至」「到」
  const re = /(\d{1,2})\s*[:：]\s*(\d{2})\s*(?:[-–—~～]|to|至|到)\s*(\d{1,2})\s*[:：]\s*(\d{2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const h1 = Number(m[1]), m1 = Number(m[2]), h2 = Number(m[3]), m2 = Number(m[4]);
    if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) continue;
    let from = toMinutes(h1, m1);
    let to = toMinutes(h2, m2);
    // 跨午夜：17:00–02:00 這種，拆成兩段比較好比
    if (to <= from) {
      out.push({ from, to: 24 * 60 });
      out.push({ from: 0, to });
    } else {
      out.push({ from, to });
    }
  }
  return out;
}

export function parseClock(time: string): number | null {
  const m = /^(\d{1,2})\s*[:：]\s*(\d{2})/.exec(String(time || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return toMinutes(h, mi);
}

function fmt(mins: number): string {
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 回傳一句警告，或 null 表示沒問題（含「無法判斷」）。
 * @param stay 停留時間的描述，例如「約 90 分鐘」；抓得到就一併檢查會不會待到打烊後
 */
export function checkHours(time: string, hours: string, stay = "", lang: LangCode = "zh-TW"): string | null {
  const W = WARN[lang];
  const start = parseClock(time);
  const ranges = parseRanges(hours);
  if (start === null || !ranges.length) return null;

  const inSome = ranges.some((r) => start >= r.from && start < r.to);
  if (!inSome) {
    const shown = ranges
      .filter((r) => !(r.from === 0 && r.to < 6 * 60))   // 跨午夜拆出來的尾巴不用秀
      .map((r) => `${fmt(r.from)}–${fmt(r.to)}`)
      .join("、");
    return W.outsideHours(time, shown);
  }

  // 待到打烊之後也是問題，只是輕一點
  const mins = /(\d+)\s*(?:分|min)/.exec(stay);
  if (mins) {
    const end = start + Number(mins[1]);
    const r = ranges.find((x) => start >= x.from && start < x.to);
    if (r && end > r.to + 5) {
      return W.pastClosing(time, String(mins[1]), fmt(r.to));
    }
  }
  return null;
}
