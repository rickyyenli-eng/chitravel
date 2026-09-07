import { findTrains, resolveStation, parseDate, normRail } from "../src/lib/rail.js";

let pass = 0, total = 0;
function eq(label: string, got: unknown, want: unknown) {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${label}  →  ${JSON.stringify(got)}${ok ? "" : ` (期望 ${JSON.stringify(want)})`}`);
}

console.log("— 站名解析 —");
eq("高鐵 台中高鐵站", resolveStation("thsr", "台中高鐵站")?.id, "1040");
eq("高鐵 高鐵台中站", resolveStation("thsr", "高鐵台中站")?.id, "1040");
eq("高鐵 高雄→左營", resolveStation("thsr", "高雄")?.id, "1070");
eq("高鐵 高鐵高雄站→左營", resolveStation("thsr", "高鐵高雄站")?.id, "1070");
eq("高鐵 臺北", resolveStation("thsr", "臺北")?.id, "1000");
eq("台鐵 台北車站", resolveStation("tra", "台北車站")?.id, "1000");
eq("台鐵 臺中", resolveStation("tra", "臺中")?.id, "3300");
eq("台鐵 花蓮", resolveStation("tra", "花蓮")?.id, "7000");
eq("台鐵 高雄", resolveStation("tra", "高雄")?.id, "4400");
eq("查不到的地方", resolveStation("thsr", "墾丁"), undefined);

console.log("\n— 日期 —");
const today = new Date("2026-09-06T12:00:00+08:00");
eq("2026-09-12", parseDate("2026-09-12", today), "2026-09-12");
eq("2026/9/12", parseDate("2026/9/12", today), "2026-09-12");
eq("9/12", parseDate("9/12", today), "2026-09-12");
eq("9月12日", parseDate("9月12日", today), "2026-09-12");
eq("3/1（已過→明年）", parseDate("3/1", today), "2027-03-01");
eq("下週六（看不懂）", parseDate("下週六", today), undefined);
eq("空字串", parseDate("", today), undefined);
eq("normRail 臺北車站", normRail("臺北車站"), "台北");

console.log(`\n${pass}/${total} 通過`);
