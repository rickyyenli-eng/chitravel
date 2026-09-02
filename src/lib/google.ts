import { config } from "../config.js";

export type PlaceSuggestion = {
  /** 顯示在下拉選單第一行，例如「台中高鐵站」 */
  main: string;
  /** 第二行的補充，例如「台灣台中市烏日區」 */
  secondary: string;
  /** 選定後要填進輸入框的完整字串 */
  text: string;
};

/**
 * Google Places 自動完成。金鑰只在這裡用，永遠不離開伺服器。
 * 沒設定金鑰就回空陣列 —— 前端據此退回純文字輸入，不會壞掉。
 */
export async function placesAutocomplete(
  input: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  if (!config.googleKey || input.trim().length < 2) return [];

  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.googleKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.text.text," +
        "suggestions.placePrediction.structuredFormat.mainText.text," +
        "suggestions.placePrediction.structuredFormat.secondaryText.text",
    },
    body: JSON.stringify({
      input,
      languageCode: "zh-TW",
      regionCode: "TW",
      includedRegionCodes: ["tw"], // 只回台灣的地點，出國行程不是現在的範圍
      sessionToken,
    }),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Places ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as { suggestions?: unknown };
  if (!Array.isArray(json.suggestions)) return [];

  const out: PlaceSuggestion[] = [];
  for (const raw of json.suggestions) {
    const p = (raw as Record<string, unknown>)?.placePrediction as
      | Record<string, unknown>
      | undefined;
    if (!p) continue;
    const sf = p.structuredFormat as Record<string, Record<string, string>> | undefined;
    const text = ((p.text as Record<string, string> | undefined)?.text ?? "").trim();
    const main = (sf?.mainText?.text ?? text).trim();
    if (!main) continue;
    out.push({ main, secondary: (sf?.secondaryText?.text ?? "").trim(), text: text || main });
  }
  return out;
}

/**
 * 把經緯度反查成人看得懂的地名。
 * 回傳偏好「市 + 區」這種行程用得上的粒度，而不是完整門牌。
 */
export async function reverseGeocode(
  lat: number,
  lng: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!config.googleKey) return "";

  const url =
    "https://maps.googleapis.com/maps/api/geocode/json" +
    `?latlng=${encodeURIComponent(`${lat},${lng}`)}` +
    "&language=zh-TW&region=tw" +
    `&key=${encodeURIComponent(config.googleKey)}`;

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Geocode ${res.status}`);

  const json = (await res.json()) as {
    status?: string;
    results?: Array<{
      formatted_address?: string;
      address_components?: Array<{ long_name?: string; types?: string[] }>;
    }>;
  };
  if (json.status !== "OK" || !json.results?.length) return "";

  // 台灣的層級對應：level_1 = 臺北市／南投縣，level_2 = 中正區／南投市，level_3 = 里。
  // 行程用得上的是「市 + 區」，抓到「里」就太細了 —— 所以 level_2 優先，
  // 沒有才退而求其次用 level_3。
  let city = "";
  let district = "";
  let village = "";

  for (const r of json.results) {
    for (const c of r.address_components ?? []) {
      const types = c.types ?? [];
      const name = (c.long_name ?? "").trim();
      if (!name) continue;
      if (!city && (types.includes("administrative_area_level_1") || types.includes("locality"))) {
        city = name;
      }
      if (!district && types.includes("administrative_area_level_2")) district = name;
      if (!village && types.includes("administrative_area_level_3")) village = name;
    }
    if (city && district) break;
  }

  if (!district) district = village;

  if (city && district) return district.startsWith(city) ? district : `${city}${district}`;
  return city || district || (json.results[0]?.formatted_address ?? "");
}
