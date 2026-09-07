/**
 * 把台灣各捷運／輕軌的路網抓下來，存成 src/data/metro.json。
 *
 * 為什麼要內建而不是即時查：路網一年變不了一次，但模型每天都會記錯。
 * 內建的話零延遲、零額外相依，PTX 哪天退役也不影響已經跑起來的服務。
 *
 * 用法：npm run fetch:metro
 */
import { writeFileSync } from "node:fs";

const BASE = "https://ptx.transportdata.tw/MOTC/v2/Rail/Metro";

const OPERATORS: Array<{ id: string; city: string; label: string }> = [
  { id: "TRTC", city: "台北", label: "台北捷運" },
  { id: "NTMC", city: "台北", label: "新北捷運" },
  { id: "KRTC", city: "高雄", label: "高雄捷運" },
  { id: "KLRT", city: "高雄", label: "高雄輕軌" },
  { id: "TYMC", city: "桃園", label: "桃園捷運" },
  { id: "TMRT", city: "台中", label: "台中捷運" },
  { id: "NTALRT", city: "新北", label: "淡海輕軌" },
];

/**
 * 顏色別名。PTX 只給正式名稱，但一般人（跟模型）講「藍線」的機率
 * 跟講「板南線」差不多，兩個都要對得上。
 */
const ALIASES: Record<string, string[]> = {
  "TRTC:BL": ["藍線"],
  "TRTC:BR": ["棕線"],
  "TRTC:G": ["綠線"],
  "TRTC:O": ["橘線"],
  "TRTC:R": ["紅線"],
  "TYMC:A": ["機場捷運", "機捷"], "KLRT:C": ["輕軌"],
  "TMRT:G": ["綠線"],
  "NTMC:Y": ["環狀線", "黃線"],
};

/**
 * 已改名的車站：舊名 → 現名。
 *
 * 手動維護，因為 API 只給現名，看不出改過。但模型的訓練資料裡多半是舊名 ——
 * 旅客照著找「市議會站」，月台上寫的是「前金」，這比搭錯線還難自己發現。
 * 以下三筆是用 StationID + 英文名比對確認過的（O1/O4/O9）。
 */
const RENAMED: Record<string, string> = {
  "西子灣": "哈瑪星",
  "市議會": "前金",
  "技擊館": "苓雅運動園區",
};

type RawLine = {
  LineID?: string;
  LineName?: { Zh_tw?: string; En?: string };
  Stations?: Array<{ StationID?: string; StationName?: { Zh_tw?: string; En?: string }; Sequence?: number }>;
};

/** 站名比對用：去掉「站」「捷運」與空白，這樣「龍山寺站」「龍山寺」都對得上 */
export function normStation(name: string): string {
  return String(name || "")
    .replace(/[\s·・]/g, "")
    .replace(/捷運/g, "")
    .replace(/車站$|站$/g, "")
    .trim();
}

async function main() {
  const lines: Record<string, { city: string; operator: string; name: string; en: string; aliases: string[] }> = {};
  // key 用「城市|站名」：台北和台中都有市政府站，合併會讓驗證器把兩地的路線混在一起
  const stations: Record<
    string,
    { city: string; lines: string[]; seq: Record<string, number>; en: string; display: string }
  > = {};

  for (const op of OPERATORS) {
    const res = await fetch(`${BASE}/StationOfLine/${op.id}?%24format=JSON`);
    if (!res.ok) {
      console.error(`  ${op.id} 失敗 HTTP ${res.status}`);
      continue;
    }
    const raw = (await res.json()) as RawLine[];

    // StationOfLine 沒有 LineName（實測是 undefined），正式名稱要另外抓
    const nameRes = await fetch(`${BASE}/Line/${op.id}?%24format=JSON`);
    const nameMap: Record<string, { zh: string; en: string }> = {};
    if (nameRes.ok) {
      for (const l of (await nameRes.json()) as RawLine[]) {
        if (l.LineID) nameMap[l.LineID] = { zh: l.LineName?.Zh_tw ?? "", en: l.LineName?.En ?? "" };
      }
    }
    let n = 0;

    for (const line of raw) {
      const lineKey = `${op.id}:${line.LineID ?? "?"}`;
      const proper = nameMap[line.LineID ?? ""] ?? { zh: "", en: "" };
      lines[lineKey] = {
        city: op.city,
        operator: op.label,
        name: proper.zh || line.LineID || "",
        en: proper.en,
        aliases: ALIASES[lineKey] ?? [],
      };
      for (const st of line.Stations ?? []) {
        const zh = st.StationName?.Zh_tw ?? "";
        if (!zh) continue;
        const key = `${op.city}|${normStation(zh)}`;
        if (!stations[key]) {
          stations[key] = { city: op.city, lines: [], seq: {}, en: st.StationName?.En ?? "", display: zh };
        }
        if (!stations[key].lines.includes(lineKey)) stations[key].lines.push(lineKey);
        // 站序：用來驗「搭幾站」。同一站在不同線上有不同序號，所以按線存。
        if (typeof st.Sequence === "number") stations[key].seq[lineKey] = st.Sequence;
        n++;
      }
    }
    console.log(`  ${op.id.padEnd(7)} ${op.label.padEnd(6)} ${raw.length} 條線 / ${n} 站`);
  }

  const out = { fetchedAt: new Date().toISOString().slice(0, 10), lines, stations, renamed: RENAMED };
  writeFileSync("src/data/metro.json", JSON.stringify(out, null, 1));
  console.log(`\n寫入 src/data/metro.json：${Object.keys(lines).length} 條路線、${Object.keys(stations).length} 個站名`);
}

main().catch((e) => { console.error(e); process.exit(1); });
