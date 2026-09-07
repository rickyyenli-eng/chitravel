import { findTrains } from "../src/lib/rail.js";

async function show(label: string, o: any) {
  const t0 = Date.now();
  const r = await findTrains(o);
  const ms = Date.now() - t0;
  console.log(`\n=== ${label}  (${ms}ms)`);
  if (!r.ok) { console.log(`   查不到：${r.reason} ${r.detail ?? ""}`); return; }
  console.log(`   ${r.from.zh} → ${r.to.zh}  ${r.date}${r.fare ? `  票價 標準${r.fare.standard} / 自由${r.fare.nonReserved} / 商務${r.fare.business}` : ""}`);
  for (const t of r.trains) {
    console.log(`   ${t.type ? t.type.padEnd(6) : "      "} ${t.no.padStart(4)}  ${t.depart} → ${t.arrive}  ${t.minutes} 分${t.note ? `  ※${t.note.slice(0,40)}` : ""}`);
  }
}

async function main() {
  await show("高鐵 台北→台中 明天 09:00 之後", { mode: "thsr", from: "台北", to: "台中", date: "2026-09-07", after: "09:00" });
  await show("高鐵 台中→高雄（左營）明天", { mode: "thsr", from: "台中高鐵站", to: "高鐵高雄站", date: "2026-09-07", after: "14:00" });
  await show("高鐵 快取命中（同一天）", { mode: "thsr", from: "南港", to: "台南", date: "2026-09-07", after: "07:00" });
  await show("台鐵 台北→花蓮 今天 08:00 之後", { mode: "tra", from: "台北車站", to: "花蓮", date: "2026-09-06", after: "08:00" });
  await show("台鐵 台南→高雄 明天", { mode: "tra", from: "台南", to: "高雄", date: "2026-09-07", after: "10:00" });
  await show("高鐵 超出可查範圍（+60 天）", { mode: "thsr", from: "台北", to: "台中", date: "2026-11-05", after: "09:00" });
  await show("高鐵 沒有這個站（墾丁）", { mode: "thsr", from: "台北", to: "墾丁", date: "2026-09-07" });
}
main();
