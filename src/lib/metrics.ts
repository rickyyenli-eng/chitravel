import type { PlanRequest } from "../types.js";

/**
 * 一趟行程的驗證成績。
 *
 * 做成結構化而不是一句人看的話，是因為之後要進雲端資料庫 ——
 * 屆時只要在 record() 裡多送一個地方，其他程式一行都不用改。
 *
 * 統計的是「哪一類還常錯」，不是內容本身：不存店名、不存行程細節，
 * 只存分類與數量。這樣就算真的送進資料庫也沒有隱私問題。
 */
export type PlanMetrics = {
  at: string;
  /** 這份程式的版本，之後比較「改完有沒有變好」要靠它 */
  commit: string;
  lang: PlanRequest["lang"];
  from: string;
  to: string;
  days: number;
  cached: boolean;
  ms: number;
  tokensIn: number;
  tokensOut: number;
  usd: number;
  stops: number;
  /** 交通段有幾個、其中幾個吐了結構化 legs */
  transit: number;
  withLegs: number;
  /** 伺服器直接改對的次數 */
  fix: { stopCount: number; trainTime: number };
  /** 只能報不能改的 */
  warn: {
    notOnLine: number;
    needTransfer: number;
    renamed: number;
    hours: number;
    missTrain: number;
  };
};

export type Counters = {
  transit: number;
  withLegs: number;
  fixStopCount: number;
  fixTrainTime: number;
  notOnLine: number;
  needTransfer: number;
  renamed: number;
  hours: number;
  missTrain: number;
};

export function newCounters(): Counters {
  return {
    transit: 0,
    withLegs: 0,
    fixStopCount: 0,
    fixTrainTime: 0,
    notOnLine: 0,
    needTransfer: 0,
    renamed: 0,
    hours: 0,
    missTrain: 0,
  };
}

export function buildMetrics(
  form: PlanRequest,
  c: Counters,
  x: { stops: number; cached: boolean; ms: number; tokensIn: number; tokensOut: number; usd: number },
): PlanMetrics {
  return {
    at: new Date().toISOString(),
    commit: (process.env.RENDER_GIT_COMMIT || "dev").slice(0, 7),
    lang: form.lang,
    from: form.from.slice(0, 40),
    to: form.to.slice(0, 40),
    days: form.days,
    cached: x.cached,
    ms: x.ms,
    tokensIn: x.tokensIn,
    tokensOut: x.tokensOut,
    usd: Number(x.usd.toFixed(4)),
    stops: x.stops,
    transit: c.transit,
    withLegs: c.withLegs,
    fix: { stopCount: c.fixStopCount, trainTime: c.fixTrainTime },
    warn: {
      notOnLine: c.notOnLine,
      needTransfer: c.needTransfer,
      renamed: c.renamed,
      hours: c.hours,
      missTrain: c.missTrain,
    },
  };
}

/**
 * 送去該去的地方。
 *
 * 現在只有 stdout（Render 的 Logs 分頁看得到，免費方案保留 7 天）。
 * 之後要進資料庫，就在這裡多一個 await db.insert(m) —— 呼叫端不用動。
 * 特意印成單行 JSON：人看得懂，也能直接 grep 出來丟給任何工具算。
 */
export function record(m: PlanMetrics): void {
  console.log(`[metrics] ${JSON.stringify(m)}`);
}
