import { checkHours } from "../src/lib/hours.js";
const cases: Array<[string, string, string, boolean]> = [
  ["11:40", "17:00–24:00（夜市）", "", true],
  ["11:30", "11:30–14:30、17:30–21:00（週二公休）", "", false],
  ["15:00", "11:30–14:30、17:30–21:00（週二公休）", "", true],
  ["16:55", "09:30-17:30（週一休館）", "", false],
  ["16:55", "09:30-17:30（週一休館）", "約 120 分鐘", true],
  ["19:00", "河岸步道 24 小時開放", "", false],
  ["08:00", "多數店家 12:00 起營業", "", false],
  ["07:00", "06:00~14:00 / 17:00~20:00", "", false],
  ["22:30", "17:00–02:00", "", false],
  ["15:00", "17:00–02:00", "", true],
  ["10:00", "", "", false],
  ["", "09:00–17:00", "", false],
];
let pass = 0;
for (const [t, h, stay, shouldWarn] of cases) {
  const r = checkHours(t, h, stay);
  const ok = !!r === shouldWarn;
  if (ok) pass++;
  console.log((ok ? "  ok  " : " FAIL ") + `${(t||"(空)").padEnd(6)} × ${(h||"(空)").slice(0,32).padEnd(34)} ${r ? "⚠ " + r : "—"}`);
}
console.log(`\n${pass}/${cases.length} 通過`);
process.exit(pass === cases.length ? 0 : 1);
