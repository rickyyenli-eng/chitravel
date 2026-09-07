/**
 * 判斷一段交通是不是「已經訂好班次的火車」。
 *
 * 為什麼要分出來：捷運隨時有車，行程往前挪半小時沒差；但高鐵 0145 是
 * 16:31 發車，把它挪到 14:26 就是把使用者送到一個沒有車的月台。
 *
 * 線上實測踩過：刪掉一站按「重排時間」，回程高鐵從 16:31 變成 14:26，
 * 而 detail 還寫著「0145 車次」—— 那個時間根本沒有那班車。
 *
 * 判斷條件刻意嚴格：要同時出現「鐵路關鍵字」與「車次號碼」才算。
 * 認不出來就當成一般交通段（可以移動）—— 寧可少鎖，不要鎖錯。
 */
const RAIL = /高鐵|台鐵|臺鐵|自強|莒光|區間快|區間車|區間|普悠瑪|太魯閣|THSR|TRA|High Speed Rail|新幹線/i;
const TRAIN_NO = /(?:車次|班次|列車|train)\s*[#no.]*\s*\d{1,4}|\d{1,4}\s*(?:車次|班次|次列車)/i;

export function isRailAnchor(s: { kind?: string; name?: string; howTo?: string; detail?: string }): boolean {
  if (s.kind !== "transit") return false;
  const text = `${s.name ?? ""} ${s.howTo ?? ""} ${s.detail ?? ""}`;
  return RAIL.test(text) && TRAIN_NO.test(text);
}
