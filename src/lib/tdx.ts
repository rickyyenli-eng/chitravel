import { config } from "../config.js";
import { TtlCache } from "./cache.js";

/**
 * 高鐵對號座剩餘座位。這是整個專案裡唯一需要憑證的資料來源。
 *
 * 為什麼非 TDX 不可：PTX（不需憑證的那個）沒有 AvailableSeatStatus 端點，
 * 實測回 404。台鐵則是**根本沒有這種資料**，官方文件寫得很清楚，
 * 所以「還有沒有票」這件事永遠只有高鐵做得到。
 *
 * 拿到的不是數字，是三個狀態碼：
 *   O 有位 / L 剩少量 / X 售完
 *
 * 更新頻率（TDX 官方文件）：
 *   當日        每 10 分鐘
 *   D+1 ~ D+27  每天 10、16、22 時
 * 所以超過 27 天就不用問了。
 *
 * 沒設定憑證時整個模組靜靜跳過，行程照樣出得來 —— 跟 Tavily 同一個原則。
 *
 * ⚠️ 這支檔案是照 TDX 的 swagger 契約寫的，但**沒有憑證可以實測**。
 *    第一次拿到金鑰跑起來時要對一次真實回應，別假設它一定對。
 */

const AUTH = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const BASE = "https://tdx.transportdata.tw/api/basic";

export type SeatCode = "O" | "L" | "X";
export type Seats = { standard?: SeatCode; business?: SeatCode };

export function tdxEnabled(): boolean {
  return Boolean(config.tdxClientId && config.tdxClientSecret);
}

// token 官方給 86400 秒，提早一小時換，免得在邊界上打到過期
let token: { value: string; until: number } | null = null;

async function getToken(): Promise<string | undefined> {
  if (!tdxEnabled()) return undefined;
  if (token && Date.now() < token.until) return token.value;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.tdxClientId,
    client_secret: config.tdxClientSecret,
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetch(AUTH, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: ac.signal,
    });
    if (!res.ok) {
      console.error(`[tdx] 取 token 失敗 HTTP ${res.status}`);
      return undefined;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return undefined;
    const ttl = Math.max(60, (json.expires_in ?? 86_400) - 3600) * 1000;
    token = { value: json.access_token, until: Date.now() + ttl };
    return token.value;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

type OdSeat = {
  TrainNo?: string;
  StandardSeatStatus?: string;
  BusinessSeatStatus?: string;
};

// 當日每 10 分鐘更新，其他日子一天三次。快取 8 分鐘對兩者都夠新。
const seatCache = new TtlCache<Record<string, Seats>>(8 * 60 * 1000, 60);

function toCode(raw?: string): SeatCode | undefined {
  const s = String(raw || "").trim().toUpperCase();
  return s === "O" || s === "L" || s === "X" ? s : undefined;
}

/**
 * 查某天某段的每一班車還有沒有位。回傳以車次為 key。
 * 查不到就回空物件 —— 沒有座位資訊，總好過寫一個猜的。
 */
export async function seatStatus(
  fromId: string,
  toId: string,
  date: string,
): Promise<Record<string, Seats>> {
  if (!tdxEnabled()) return {};
  const key = `${fromId}:${toId}:${date}`;
  const hit = seatCache.get(key);
  if (hit) return hit;

  const t = await getToken();
  if (!t) return {};

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const url =
      `${BASE}/v2/Rail/THSR/AvailableSeatStatus/Train/OD/` +
      `${fromId}/to/${toId}/TrainDate/${date}?%24format=JSON`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${t}`, accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) {
      // 401 代表 token 壞了，丟掉下次重拿
      if (res.status === 401) token = null;
      return {};
    }
    const json = (await res.json()) as { AvailableSeats?: OdSeat[] };
    const out: Record<string, Seats> = {};
    for (const s of json.AvailableSeats ?? []) {
      if (!s.TrainNo) continue;
      const standard = toCode(s.StandardSeatStatus);
      const business = toCode(s.BusinessSeatStatus);
      if (!standard && !business) continue;
      out[s.TrainNo] = { ...(standard ? { standard } : {}), ...(business ? { business } : {}) };
    }
    seatCache.set(key, out);
    return out;
  } catch {
    return {};
  } finally {
    clearTimeout(timer);
  }
}
