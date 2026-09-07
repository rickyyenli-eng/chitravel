import { renderLegs, towardOf } from "../src/lib/leg.js";
import { checkStopCount } from "../src/lib/metro.js";

/**
 * 結構化交通段。這裡驗的是「句子由我們產生」之後，
 * 站數與方向不可能再錯 —— 因為它們不是模型填的。
 */
const TRAINS = { "0612": { depart: "09:00", arrive: "09:59" } };
let pass = 0, total = 0;
function eq(note: string, got: unknown, want: unknown) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${note}`);
  if (!ok) console.log(`        得到 ${JSON.stringify(got)}\n        期望 ${JSON.stringify(want)}`);
}

const zh = (legs: any[], dest = "台北") => renderLegs(legs, "zh-TW", dest, TRAINS).text;

eq(
  "站數與方向都是算的",
  zh([{ mode: "metro", line: "淡水信義線", from: "台北車站", to: "中正紀念堂", exit: "5" }]),
  "從台北車站搭淡水信義線往象山方向，2 站到中正紀念堂站，5 號出口",
);
eq(
  "高雄那個方向錯的經典案例，現在不可能錯",
  zh([{ mode: "metro", line: "紅線", from: "凱旋", to: "美麗島" }], "高雄"),
  "從凱旋站搭紅線往岡山方向，4 站到美麗島站",
);
eq(
  "路線沒填，兩站只共用一條線就自己推",
  zh([{ mode: "metro", from: "台北101/世貿", to: "台北車站" }]),
  "從台北101/世貿站搭淡水信義線往淡水方向，7 站到台北車站",
);
eq(
  "火車時刻直接帶真實班表",
  zh([{ mode: "rail", line: "高鐵", trainNo: "0612", from: "台中高鐵站", to: "台北車站" }]),
  "於台中高鐵站搭高鐵 0612 車次至台北車站（09:00 發車→09:59 抵達）",
);
eq(
  "轉乘不重複起點，走路不寫成「轉步行」",
  zh([
    { mode: "metro", line: "板南線", from: "國父紀念館", to: "忠孝復興" },
    { mode: "walk", to: "誠品", minutes: 6 },
  ]),
  "從國父紀念館站搭板南線往頂埔方向，2 站到忠孝復興站，步行 6 分鐘至誠品",
);
eq("台北車站不會變成「台北車站站」", zh([{ mode: "metro", from: "中正紀念堂", to: "台北車站" }]).includes("台北車站站"), false);
eq("環狀線不寫方向也不寫站數", zh([{ mode: "metro", line: "環狀輕軌", from: "駁二大義", to: "愛河之心" }], "高雄"), "從駁二大義站搭環狀輕軌，到愛河之心站");

// 模型把路線填錯時要報出來
const bad = renderLegs([{ mode: "metro", line: "中和新蘆線", from: "中正紀念堂", to: "東門" } as any], "zh-TW", "台北");
eq("路線填錯要有警告", bad.issues.length > 0, true);

// 產生出來的句子再丟回站數檢查，不該有任何殘留錯誤
const sentences = [
  zh([{ mode: "metro", line: "淡水信義線", from: "台北車站", to: "中正紀念堂" }]),
  zh([{ mode: "metro", line: "板南線", from: "國父紀念館", to: "忠孝復興" }]),
];
for (const t of sentences) eq(`自己產生的句子通過站數檢查：${t.slice(0, 20)}…`, checkStopCount(t, "台北").length, 0);

eq("towardOf 反向", towardOf("TRTC:R", "中正紀念堂", "台北車站"), "淡水");

console.log(`\n${pass}/${total} 通過`);
process.exit(pass === total ? 0 : 1);
