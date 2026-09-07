import type { LangCode } from "../types.js";

/**
 * 驗證警告的文案。
 *
 * 這些是後端產生的，但要用使用者的語言顯示 ——
 * 一個法國人看到中文警告，等於沒有警告。
 * 站名本身一律保留中文原文，因為那是他要拿去對照招牌的東西。
 */
type T = {
  notOnLine: (station: string, line: string, real: string) => string;
  needTransfer: (a: string, b: string) => string;
  renamed: (old: string, now: string) => string;
  outsideHours: (time: string, hours: string) => string;
  pastClosing: (time: string, mins: string, close: string) => string;
  stopCount: (a: string, b: string, line: string, said: number, real: number) => string;
  stopFixed: (a: string, b: string, line: string, said: number, real: number) => string;
  missTrain: (no: string, depart: string, prev: string) => string;
};

export const WARN: Record<LangCode, T> = {
  "zh-TW": {
    notOnLine: (s, l, r) => `${s}站不在${l}上（實際在：${r}）`,
    needTransfer: (a, b) => `${a}與${b}不在同一條線上，需要轉乘`,
    renamed: (o, n) => `${o}站已改名為「${n}站」，現場招牌是新名字`,
    outsideHours: (t, h) => `排在 ${t}，但營業時間是 ${h}`,
    pastClosing: (t, m, c) => `${t} 進場停留 ${m} 分鐘，會超過 ${c} 的打烊時間`,
    stopCount: (a, b, l, said, real) => `${a}到${b}（${l}）是 ${real} 站，不是 ${said} 站`,
    stopFixed: (a, b, l, said, real) => `站數已修正：${a}到${b}（${l}）是 ${real} 站，原本寫 ${said} 站`,
    missTrain: (no, dep, prev) => `${no} 車次 ${dep} 發車，但上一站排在 ${prev}，趕不上`,
  },
  en: {
    notOnLine: (s, l, r) => `${s} is not on the ${l} (it's on: ${r})`,
    needTransfer: (a, b) => `${a} and ${b} are not on the same line — a transfer is needed`,
    renamed: (o, n) => `${o} has been renamed “${n}” — that's what the signage says now`,
    outsideHours: (t, h) => `Scheduled for ${t}, but it opens ${h}`,
    pastClosing: (t, m, c) => `Arriving ${t} for ${m} min runs past the ${c} closing time`,
    stopCount: (a, b, l, said, real) => `${a} to ${b} on the ${l} is ${real} stops, not ${said}`,
    stopFixed: (a, b, l, said, real) => `Corrected: ${a} to ${b} on the ${l} is ${real} stops (was ${said})`,
    missTrain: (no, dep, prev) => `Train ${no} leaves at ${dep}, but the previous stop starts at ${prev} — you won\u2019t make it`,
  },
  fr: {
    notOnLine: (s, l, r) => `${s} n'est pas sur la ${l} (elle est sur : ${r})`,
    needTransfer: (a, b) => `${a} et ${b} ne sont pas sur la même ligne — correspondance nécessaire`,
    renamed: (o, n) => `${o} a été renommée « ${n} » — c'est le nom affiché sur place`,
    outsideHours: (t, h) => `Prévu à ${t}, mais les horaires sont ${h}`,
    pastClosing: (t, m, c) => `Arrivée à ${t} pour ${m} min : dépasse la fermeture de ${c}`,
    stopCount: (a, b, l, said, real) => `${a} → ${b} sur la ${l} fait ${real} stations, pas ${said}`,
    stopFixed: (a, b, l, said, real) => `Corrigé : ${a} → ${b} sur la ${l} fait ${real} stations (indiqué ${said})`,
    missTrain: (no, dep, prev) => `Le train ${no} part à ${dep}, mais l\u2019étape précédente commence à ${prev} — impossible`,
  },
  ja: {
    notOnLine: (s, l, r) => `${s}駅は${l}にありません（実際は：${r}）`,
    needTransfer: (a, b) => `${a}と${b}は同じ路線ではありません。乗り換えが必要です`,
    renamed: (o, n) => `${o}駅は「${n}駅」に改称されました。現地の案内は新しい名前です`,
    outsideHours: (t, h) => `${t} に予定されていますが、営業時間は ${h} です`,
    pastClosing: (t, m, c) => `${t} から ${m} 分の滞在は ${c} の閉店時刻を過ぎます`,
    stopCount: (a, b, l, said, real) => `${a}から${b}（${l}）は ${real} 駅で、${said} 駅ではありません`,
    stopFixed: (a, b, l, said, real) => `修正：${a}から${b}（${l}）は ${real} 駅です（${said} 駅と記載）`,
    missTrain: (no, dep, prev) => `${no} 号は ${dep} 発ですが、前の立ち寄り先が ${prev} からのため間に合いません`,
  },
};
