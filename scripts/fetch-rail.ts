/**
 * 從 PTX 抓台鐵與高鐵的車站清單，存成 src/data/rail.json。
 *
 * 跟 metro.json 同一個理由：站名與站號一年變不了幾次，內建就零延遲、
 * 零相依。時刻表當然要即時查，但「台中高鐵站是 1040」這種事不用。
 *
 * PTX 是 TDX 的前身，不需要憑證。
 *   npm run fetch:rail
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "https://ptx.transportdata.tw/MOTC";

type Station = { id: string; zh: string; en: string; city: string };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return (await res.json()) as T;
}

/** 「臺」與「台」兩種寫法都有人用，站名一律正規化成「台」 */
export function normRail(name: string): string {
  return String(name || "")
    .replace(/[\s·・]/g, "")
    .replace(/臺/g, "台")
    .replace(/車站$|站$/g, "")
    .trim();
}

async function main() {
  const thsrRaw = await get<
    Array<{ StationID: string; StationName: { Zh_tw: string; En: string }; LocationCity?: string }>
  >("/v2/Rail/THSR/Station?$format=JSON");
  const thsr: Record<string, Station> = {};
  for (const s of thsrRaw) {
    const zh = normRail(s.StationName.Zh_tw);
    thsr[zh] = { id: s.StationID, zh, en: s.StationName.En, city: normRail(s.LocationCity ?? "") };
  }

  const traRaw = await get<{
    Stations: Array<{
      StationID: string;
      StationName: { Zh_tw: string; En: string };
      LocationCity?: string;
      StationClass?: string;
    }>;
  }>("/v3/Rail/TRA/Station?%24format=JSON");
  const tra: Record<string, Station> = {};
  for (const s of traRaw.Stations) {
    const zh = normRail(s.StationName.Zh_tw);
    tra[zh] = { id: s.StationID, zh, en: s.StationName.En, city: normRail(s.LocationCity ?? "") };
  }

  const out = { fetchedAt: new Date().toISOString().slice(0, 10), thsr, tra };
  const path = resolve(process.cwd(), "src/data/rail.json");
  writeFileSync(path, JSON.stringify(out, null, 0) + "\n", "utf-8");

  console.log(`  高鐵 ${Object.keys(thsr).length} 站`);
  console.log(`  台鐵 ${Object.keys(tra).length} 站`);
  console.log(`\n寫入 src/data/rail.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
