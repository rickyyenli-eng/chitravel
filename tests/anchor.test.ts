import { isRailAnchor } from "../src/lib/anchor.js";

/**
 * 火車錨點。鎖錯（把捷運段鎖住）會讓重排失效，
 * 漏鎖會讓高鐵被挪到沒有車的時間 —— 線上真的發生過。
 */
const cases: Array<[boolean, any, string]> = [
  [true,  {kind:"transit", name:"台北車站 → 台中高鐵站", howTo:"搭乘高鐵 0145 車次（16:31 發車→17:18 抵達）"}, "高鐵有車次 → 鎖"],
  [true,  {kind:"transit", name:"台中高鐵站→台北車站：高鐵 0112 班次", howTo:"5 號月台搭乘"}, "車次在標題裡也算"],
  [true,  {kind:"transit", name:"台北 → 花蓮", howTo:"搭台鐵自強號 472 車次，08:43 發車"}, "台鐵自強有車次 → 鎖"],
  [false, {kind:"transit", name:"台北車站 → 國父紀念館站", howTo:"搭板南線（BL）往頂埔方向，搭 5 站至國父紀念館站，4 號出口"}, "捷運 → 不鎖"],
  [false, {kind:"transit", name:"步行至松山文創園區", howTo:"由 101 沿信義路五段往東步行"}, "步行 → 不鎖"],
  [false, {kind:"transit", name:"台中高鐵站 → 台北車站", howTo:"搭乘高鐵北上，約 1 小時"}, "有高鐵但沒車次 → 不鎖（可移動）"],
  [false, {kind:"food", name:"永康街牛肉麵", howTo:"東門站 5 號出口步行 3 分鐘"}, "非交通段 → 不鎖"],
  [false, {kind:"transit", name:"高鐵站接駁車", howTo:"搭接駁車至市區"}, "接駁車沒車次 → 不鎖"],
];

let pass = 0;
for (const [want, stop, note] of cases) {
  const got = isRailAnchor(stop);
  const ok = got === want;
  if (ok) pass++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${got ? "★鎖住" : "　可動"}  ${note}`);
}
console.log(`\n${pass}/${cases.length} 通過`);
process.exit(pass === cases.length ? 0 : 1);
