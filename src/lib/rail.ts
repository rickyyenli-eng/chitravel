import rail from "../data/rail.json" with { type: "json" };
import { TtlCache } from "./cache.js";
import { seatStatus, tdxEnabled, type Seats } from "./tdx.js";

/**
 * 台鐵與高鐵的真實時刻表。資料來自 PTX（TDX 的前身，不需要憑證）。
 *
 * 為什麼要做：模型記得住「台北到台中有高鐵」，但記不住車次與發車時間。
 * 它寫出來的 0832 車次多半不存在，而旅客是拿著那個車次去買票的。
 * 所以車次一律不讓模型自己編 —— 由這裡查真的給它。
 *
 * 查得到什麼、查不到什麼（2026-09 實測）：
 *   高鐵 時刻表  隔天起、約 28 天內
 *   台鐵 時刻表  當天起、約 60 天內
 *   票價        兩邊都有
 *   剩餘座位     ✗ PTX 沒有這個端點（TDX 有，但要憑證）
 */

const BASE = "https://ptx.transportdata.tw/MOTC";

type Station = { id: string; zh: string; en: string; city: string };
type RailDb = { fetchedAt: string; thsr: Record<string, Station>; tra: Record<string, Station> };
const DB = rail as RailDb;

export type RailMode = "thsr" | "tra";

export type Train = {
  no: string;
  /** 高鐵才有，且要設定 TDX 憑證：O 有位 / L 剩少量 / X 售完 */
  seats?: Seats;
  /** 台鐵才有：自強、莒光、區間 */
  type?: string;
  depart: string;
  arrive: string;
  /** 分鐘 */
  minutes: number;
  note?: string;
};

export type TrainLookup =
  | { ok: true; mode: RailMode; from: Station; to: Station; date: string; trains: Train[]; fare?: Fare }
  | { ok: false; reason: "no-station" | "out-of-range" | "no-train" | "error"; detail?: string };

export type Fare = {
  /** 高鐵 */
  standard?: number;
  business?: number;
  nonReserved?: number;
  /** 台鐵 */
  express?: number;
  local?: number;
};

/** 「臺」與「台」兩種寫法都有人用，站名一律正規化成「台」 */
export function normRail(name: string): string {
  return String(name || "")
    .replace(/[\s·・（）()]/g, "")
    .replace(/臺/g, "台")
    .replace(/車站$|站$/g, "")
    .trim();
}

/**
 * 高鐵沒有「高雄站」，那站叫左營。旅客與模型都會寫「高鐵高雄站」，
 * 照字面查會查不到，然後整段時刻表就靜靜消失 —— 這種洞最難發現。
 */
const THSR_ALIAS: Record<string, string> = { 高雄: "左營", 新左營: "左營" };

export function resolveStation(mode: RailMode, text: string): Station | undefined {
  const table = mode === "thsr" ? DB.thsr : DB.tra;
  let q = normRail(text)
    .replace(/高鐵|台鐵|火車|捷運/g, "")
    .trim();
  if (!q) return undefined;
  if (mode === "thsr" && THSR_ALIAS[q]) q = THSR_ALIAS[q]!;

  if (table[q]) return table[q];
  // 「台中高鐵」剃完是「台中」，但「板橋轉運站」這種要靠包含比對；
  // 取最長的那個，免得「台北」把「新台北」之類的搶走
  const hits = Object.keys(table).filter((k) => k.length >= 2 && q.includes(k));
  if (!hits.length) return undefined;
  hits.sort((a, b) => b.length - a.length);
  return table[hits[0]!];
}

/** 把使用者填的日期正規化成 YYYY-MM-DD；看不懂就回 undefined，不要猜 */
export function parseDate(raw: string, today = new Date()): string | undefined {
  const s = String(raw || "").trim();
  if (!s) return undefined;
  const y0 = today.getFullYear();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/(20\d{2})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/))) {
    return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if ((m = s.match(/(\d{1,2})\s*[-/月.]\s*(\d{1,2})/))) {
    const mo = Number(m[1]), d = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
    // 只寫月日：若已經過了就當明年
    const guess = iso(y0, mo, d);
    return guess < iso(today.getFullYear(), today.getMonth() + 1, today.getDate())
      ? iso(y0 + 1, mo, d)
      : guess;
  }
  return undefined;
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 台鐵的 Note 前半段幾乎都是「每日行駛。」「逢週六、日行駛。」——
 * 按日期查本來就只會回當天有開的車，這段是雜訊。留下後面真正的限制。
 */
function cleanNote(raw?: string): string | undefined {
  const s = String(raw || "")
    .replace(/^(每日行駛|逢[^。]{1,20}行駛)[。.]?\s*/u, "")
    .trim();
  return s ? s.slice(0, 60) : undefined;
}

function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

// 時刻表一天之內不會變，快取久一點；票價更久
const ttCache = new TtlCache<unknown>(6 * 60 * 60 * 1000, 60);
const fareCache = new TtlCache<Fare>(24 * 60 * 60 * 1000, 200);

async function getJson<T>(path: string, timeoutMs = 12_000): Promise<T | undefined> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

type ThsrTrain = {
  DailyTrainInfo: { TrainNo: string };
  StopTimes: Array<{ StopSequence: number; StationID: string; ArrivalTime: string; DepartureTime: string }>;
};

async function thsrDay(date: string): Promise<ThsrTrain[] | undefined> {
  const key = `thsr:${date}`;
  const hit = ttCache.get(key) as ThsrTrain[] | undefined;
  if (hit) return hit;
  const data = await getJson<ThsrTrain[]>(
    `/v2/Rail/THSR/DailyTimetable/TrainDate/${date}?$format=JSON`,
    20_000,
  );
  if (!Array.isArray(data)) return undefined;
  ttCache.set(key, data);
  return data;
}

type TraTrain = {
  TrainInfo: {
    TrainNo: string;
    TrainTypeName?: { Zh_tw?: string };
    Note?: string;
    ServiceType?: number;
    SuspendedFlag?: number;
  };
  StopTimes: Array<{ StopSequence: number; StationID: string; ArrivalTime: string; DepartureTime: string }>;
};

async function traOd(from: string, to: string, date: string): Promise<TraTrain[] | undefined> {
  const key = `tra:${from}:${to}:${date}`;
  const hit = ttCache.get(key) as TraTrain[] | undefined;
  if (hit) return hit;
  const data = await getJson<{ TrainTimetables?: TraTrain[] }>(
    `/v3/Rail/TRA/DailyTrainTimetable/OD/${from}/to/${to}/${date}?%24format=JSON`,
    20_000,
  );
  const list = data?.TrainTimetables;
  if (!Array.isArray(list)) return undefined;
  ttCache.set(key, list);
  return list;
}

async function thsrFare(from: string, to: string): Promise<Fare | undefined> {
  const key = `f:thsr:${from}:${to}`;
  const hit = fareCache.get(key);
  if (hit) return hit;
  const data = await getJson<
    Array<{ Fares: Array<{ TicketType: number; FareClass: number; CabinClass: number; Price: number }> }>
  >(`/v2/Rail/THSR/ODFare/${from}/to/${to}?$format=JSON`);
  const fares = data?.[0]?.Fares;
  if (!fares) return undefined;
  // TicketType 1 = 全票、FareClass 1 = 一般；CabinClass 1 標準 / 2 商務 / 3 自由
  const pick = (cabin: number) =>
    fares.find((f) => f.TicketType === 1 && f.FareClass === 1 && f.CabinClass === cabin)?.Price;
  const out: Fare = { standard: pick(1), business: pick(2), nonReserved: pick(3) };
  fareCache.set(key, out);
  return out;
}

async function traFare(from: string, to: string): Promise<Fare | undefined> {
  const key = `f:tra:${from}:${to}`;
  const hit = fareCache.get(key);
  if (hit) return hit;
  const data = await getJson<Array<{ Fares: Array<{ TicketType: string; Price: number }> }>>(
    `/v2/Rail/TRA/ODFare/${from}/to/${to}?$format=JSON`,
  );
  const fares = data?.[0]?.Fares;
  if (!fares) return undefined;
  // 「成自」= 成人自強、「成復」= 成人復興／區間，其餘是孩童與優待票
  const pick = (t: string) => fares.find((f) => f.TicketType === t)?.Price;
  const out: Fare = { express: pick("成自"), local: pick("成復") };
  if (!out.express && !out.local) return undefined;
  fareCache.set(key, out);
  return out;
}

/**
 * 查真實班次。查不到就明說原因 —— 寧可讓上層寫「依現場班次」，
 * 也不要編一個看起來很像真的車次出來。
 */
export async function findTrains(opts: {
  mode: RailMode;
  from: string;
  to: string;
  date: string;
  /** HH:MM，只回這個時間之後的班次 */
  after?: string;
  limit?: number;
}): Promise<TrainLookup> {
  const from = resolveStation(opts.mode, opts.from);
  const to = resolveStation(opts.mode, opts.to);
  if (!from || !to || from.id === to.id) return { ok: false, reason: "no-station" };

  const afterMin = opts.after ? toMin(opts.after) : -1;
  const limit = opts.limit ?? 4;
  const trains: Train[] = [];

  if (opts.mode === "thsr") {
    const day = await thsrDay(opts.date);
    if (!day) return { ok: false, reason: "out-of-range", detail: "高鐵時刻表僅提供隔天起約 28 天內" };
    for (const t of day) {
      const a = t.StopTimes.find((s) => s.StationID === from.id);
      const b = t.StopTimes.find((s) => s.StationID === to.id);
      if (!a || !b || a.StopSequence >= b.StopSequence) continue;
      const dep = toMin(a.DepartureTime), arr = toMin(b.ArrivalTime);
      if (dep < 0 || arr < 0 || dep < afterMin) continue;
      trains.push({
        no: t.DailyTrainInfo.TrainNo,
        depart: a.DepartureTime,
        arrive: b.ArrivalTime,
        minutes: arr >= dep ? arr - dep : arr + 1440 - dep,
      });
    }
  } else {
    const list = await traOd(from.id, to.id, opts.date);
    if (!list) return { ok: false, reason: "out-of-range", detail: "台鐵時刻表僅提供當天起約 60 天內" };
    for (const t of list) {
      // ServiceType 4 = 環島之星這類包套列車，不單售車票。
      // 照著它的時刻去買票會買不到，列出來只會害人。
      if (t.TrainInfo.ServiceType === 4 || t.TrainInfo.SuspendedFlag === 1) continue;
      if (/不單售車票/.test(t.TrainInfo.Note ?? "")) continue;
      const a = t.StopTimes.find((s) => s.StationID === from.id);
      const b = t.StopTimes.find((s) => s.StationID === to.id);
      if (!a || !b || a.StopSequence >= b.StopSequence) continue;
      const dep = toMin(a.DepartureTime), arr = toMin(b.ArrivalTime);
      if (dep < 0 || arr < 0 || dep < afterMin) continue;
      const note = cleanNote(t.TrainInfo.Note);
      trains.push({
        no: t.TrainInfo.TrainNo,
        type: t.TrainInfo.TrainTypeName?.Zh_tw?.replace(/\(.*?\)/g, "").trim() || undefined,
        depart: a.DepartureTime,
        arrive: b.ArrivalTime,
        minutes: arr >= dep ? arr - dep : arr + 1440 - dep,
        ...(note ? { note } : {}),
      });
    }
  }

  if (!trains.length) return { ok: false, reason: "no-train" };
  trains.sort((x, y) => toMin(x.depart) - toMin(y.depart));

  const fare = opts.mode === "thsr" ? await thsrFare(from.id, to.id) : await traFare(from.id, to.id);
  const picked = trains.slice(0, limit);

  // 剩餘座位只有高鐵有，而且要 TDX 憑證。沒有就整段跳過，不影響班次與票價。
  if (opts.mode === "thsr" && tdxEnabled()) {
    const seats = await seatStatus(from.id, to.id, opts.date);
    for (const t of picked) {
      const s = seats[t.no];
      if (s) t.seats = s;
    }
  }

  return { ok: true, mode: opts.mode, from, to, date: opts.date, trains: picked, ...(fare ? { fare } : {}) };
}

export const railFetchedAt = DB.fetchedAt;

/** 使用者勾的交通方式裡有沒有點名台鐵／高鐵 */
function modesFor(transport: string[]): RailMode[] {
  const t = transport.join(" ");
  const out: RailMode[] = [];
  if (/高鐵|THSR|high[-\s]?speed|grande vitesse|新幹線/i.test(t)) out.push("thsr");
  if (/台鐵|臺鐵|TRA|火車|railway|\bTER\b|在来線/i.test(t)) out.push("tra");
  return out;
}

/**
 * 純算日期，不碰時區。用 `new Date("2026-09-20T00:00:00+08:00")` 再 toISOString
 * 會被 UTC 拉回前一天，兩天一夜的回程日期就會算成同一天。
 */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + n));
  return t.toISOString().slice(0, 10);
}

const SEAT_TEXT: Record<string, string> = { O: "有位", L: "剩少量", X: "已售完" };

function line(mode: RailMode, r: TrainLookup, label: string): string[] {
  if (!r.ok) return [];
  const trains = r.trains
    .map((t) => {
      const seat = t.seats?.standard ? ` ${SEAT_TEXT[t.seats.standard]}` : "";
      return `${t.type ? t.type : ""}${t.no} ${t.depart}→${t.arrive}${seat}`;
    })
    .join("、");
  const out = [`${label}（${r.from.zh}→${r.to.zh}）：${trains}`];
  const f = fareText(mode, r.fare);
  if (f) out.push(`  ${f}`);
  return out;
}

function fareText(mode: RailMode, fare?: Fare): string {
  if (!fare) return "";
  if (mode === "thsr") {
    if (!fare.standard) return "";
    return `票價：標準座 ${fare.standard}、自由座 ${fare.nonReserved}（每人單程）`;
  }
  const parts = [
    fare.express ? `自強 ${fare.express}` : "",
    fare.local ? `區間 ${fare.local}` : "",
  ].filter(Boolean);
  return parts.length ? `票價：${parts.join("、")}（每人單程）` : "";
}

/**
 * 塞進 prompt 的真實班次。跟捷運路網同一個做法：先給，模型就不用靠記憶編。
 *
 * 查不到的時候什麼都不給，並在規則裡要求它不要寫車次 ——
 * 「搭高鐵北上，約 1 小時」是對的；「搭 0813 車次」如果那班不存在就是害人。
 */
export type TrainIndex = Record<string, { depart: string; arrive: string }>;

export type RailContext = {
  /** 塞進 prompt 的文字 */
  text: string;
  /** 車次 → 真實發車與抵達時刻，用來事後把模型算錯的時間改對 */
  index: TrainIndex;
};

export async function railPromptBlock(f: {
  from: string;
  to: string;
  date: string;
  start: string;
  days: number;
  transport: string[];
}): Promise<RailContext> {
  const date = parseDate(f.date);
  const index: TrainIndex = {};
  if (!date) return { text: "", index };
  const modes = modesFor(f.transport);
  const want: RailMode[] = modes.length ? modes : ["thsr", "tra"];

  const blocks: string[] = [];
  for (const mode of want) {
    const a = resolveStation(mode, f.from);
    const b = resolveStation(mode, f.to);
    if (!a || !b || a.id === b.id) continue;

    const backDate = f.days > 1 ? addDays(date, f.days - 1) : date;
    const [out, back] = await Promise.all([
      findTrains({ mode, from: f.from, to: f.to, date, after: f.start, limit: 5 }),
      findTrains({ mode, from: f.to, to: f.from, date: backDate, after: "16:00", limit: 5 }),
    ]);
    const name = mode === "thsr" ? "高鐵" : "台鐵";

    if (!out.ok && !back.ok) {
      // 班表還沒開放（高鐵只到 28 天後）但票價一直查得到。
      // 給票價、明講班次查不到，好過讓它自己編一個。
      const fare = mode === "thsr" ? await thsrFare(a.id, b.id) : await traFare(a.id, b.id);
      const ft = fareText(mode, fare);
      if (!ft) continue;
      blocks.push(
        `【${name} ${a.zh}→${b.zh}】${date} 的班表尚未開放查詢，不要寫車次與發車時刻。`,
        `  ${ft}`,
      );
      continue;
    }

    for (const r of [out, back]) {
      if (!r.ok) continue;
      for (const t of r.trains) index[t.no] = { depart: t.depart, arrive: t.arrive };
    }

    blocks.push(
      `【${name} ${date} 實際班次 — 這是權威資料，車次與時刻只能從這裡挑】`,
      ...line(mode, out, "去程"),
      ...line(mode, back, `回程 ${backDate}`),
    );
  }
  if (!blocks.length) return { text: "", index };
  blocks.push("上面沒列到的路段不要自己寫車次，只寫怎麼搭與大約需時。");
  return { text: blocks.join("\n"), index };
}

/**
 * 把敘述裡的發車／抵達時刻改成真的。
 *
 * 線上實測抓到：班表明明寫著「0612 09:00→09:59」，模型抄了車次與發車時間，
 * 抵達卻自己算成 10:59 —— 整整差一小時，而且它照著錯的時間排了一整天。
 *
 * 跟站數同一個道理：有權威資料在手上，就不要只警告，直接改對。
 * 只在「句子裡剛好提到一個認得的車次」時才動，認不出來一律放過。
 */
export function fixTrainTimes(
  text: string,
  index: TrainIndex,
): { text: string; notes: string[]; depart?: string; arrive?: string } {
  if (!text || !Object.keys(index).length) return { text, notes: [] };

  // 車次號碼要跟「車次／班次／列車」這類字連在一起，才不會把時刻或票價當成車次
  const hits = new Set<string>();
  const re = /(?:車次|班次|列車)\s*[#No.]*\s*(\d{1,4})|(\d{1,4})\s*(?:車次|班次|次列車)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = (m[1] ?? m[2] ?? "").trim();
    for (const cand of [raw, raw.padStart(4, "0")]) {
      if (index[cand]) hits.add(cand);
    }
  }
  // 一句話裡有兩個以上車次就對不出哪個時刻屬於哪班，放過
  if (hits.size !== 1) return { text, notes: [] };

  const no = [...hits][0]!;
  const real = index[no]!;
  const notes: string[] = [];
  let out = text;

  const swap = (label: "發車" | "抵達", want: string) => {
    const pat =
      label === "發車"
        ? /(\d{1,2}:\d{2})(\s*(?:發車|出發|開))/g
        : /(\d{1,2}:\d{2})(\s*(?:抵達|到達|抵|到站))/g;
    out = out.replace(pat, (whole, time: string, tail: string) => {
      if (time === want) return whole;
      notes.push(`${no} 車次${label}時間已修正：${time} → ${want}`);
      return want + tail;
    });
  };
  swap("發車", real.depart);
  swap("抵達", real.arrive);

  // 卡片上的時間就是發車時間，一起回去讓呼叫端對齊 ——
  // 不然會出現「卡片寫 17:01、內文寫 16:01 發車」這種自相矛盾
  return { text: out, notes: notes.slice(0, 2), depart: real.depart, arrive: real.arrive };
}
