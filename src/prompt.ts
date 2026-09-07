import { promptIndex } from "./lib/metro.js";
import type { LangCode, PlanRequest } from "./types.js";

const LANG_NAME: Record<LangCode, string> = {
  "zh-TW": "繁體中文",
  en: "English",
  fr: "français",
  ja: "日本語",
};

/**
 * 系統提示：講清楚角色與紀律，跟每次都會變的條件分開放，
 * 之後才能用 prompt caching 省錢。
 */
export const SYSTEM_PROMPT = [
  "你是熟悉台灣交通與在地餐飲的行程規劃員。",
  "你排出來的行程必須是「走得完」的：時間要接得上，地理位置不能亂跳，交通段的轉乘要寫得像看得懂路線圖的人寫的。",
  "你只輸出 JSON，不寫任何前言、結語或說明文字。",
  "不確定的資訊給合理估計，不要假裝精確；價格與營業時間寫成一般人看得懂的樣子。",
  "最重要的一條：寧可模糊但正確，不要精確但錯誤。編一個不存在的店名，會害使用者白跑一趟。",
].join("\n");

/** 期望的輸出形狀，直接示範一次比條列說明有效 */
const SHAPE = JSON.stringify({
  title: "行程名稱",
  summary: "兩句話說明這條路線怎麼走",
  stops: [
    {
      kind: "transit|food|sight|stay|other",
      name: "名稱",
      day: 1,
      time: "09:30",
      duration: "約 40 分鐘",
      howTo: "怎麼過去：搭哪條線、在哪站下、幾號出口、步行幾分鐘",
      detail: "這站在做什麼、為什麼推薦",
      hours: "營業時間與公休日",
      area: "行政區或商圈，例如 鹽埕區 / 旗津 / 五福商圈",
      cost: 350,
      costUnit: "每人",
      verified: "landmark|unverified|generic",
      rainPlan: "下雨的話怎麼辦",
      notes: ["可開發票", "可指定不辣"],
      booking: "建議提前訂位",
    },
  ],
  extras: [
    { name: "備選景點", kind: "sight", why: "為什麼值得繞過去", cost: 0, costUnit: "每人", area: "所在區域" },
  ],
  tips: ["提醒事項"],
});

export function buildPlanPrompt(f: PlanRequest, railBlock = ""): string {
  return [
    "請依下列條件排一趟行程。",
    "",
    `出發地：${f.from}`,
    `目的地：${f.to}`,
    `想吃：${f.food || "在地美食"}`,
    `日期：${f.date || "近期"}`,
    `天數：${f.days === 1 ? "當日來回" : `${f.days} 天 ${f.days - 1} 夜`}`,
    `出發時間：${f.start}`,
    `人數：${f.people} 人`,
    `每人預算：NT$${f.budget}`,
    `偏好交通方式：${f.transport.join("、") || "不限"}`,
    `特殊要求：${f.needs.join("、") || "無"}`,
    `要包含：${f.include.join("、") || "餐廳與景點"}`,
    `補充：${f.notes || "無"}`,
    "",
    ...(promptIndex(f.to) ? [promptIndex(f.to), ""] : []),
    ...(railBlock ? [railBlock, ""] : []),
    "只輸出這個 JSON 物件：",
    SHAPE,
    "",
    "規則：",
    "1. cost 是新台幣整數，免費填 0。costUnit 只能是「每人」「每組」或「每晚」。",
    '2. stops 依時間排序。交通段用 kind:"transit"，必須寫清楚搭哪條路線、在哪一站轉乘、走幾號出口、步行幾分鐘。',
    '3. 若「要包含」有住宿，加一個 kind:"stay" 的 stop，在 detail 寫早鳥價與是否供應早餐。',
    "4. 每個非交通的 stop 都要有 rainPlan。",
    "4-a. hours 必填（交通段除外），而且排定的 time 必須落在 hours 之內。",
    "     夜市、酒吧不要排在中午；早餐店不要排在傍晚；博物館別排在快閉館時還停留兩小時。",
    "     不確定營業時間就把 time 排在該類型店家一定開著的時段，別賭。",
    "5. notes 要反映特殊要求（不吃辣、可開發票、無障礙、親子友善等）。",
    "6. extras 給 3 到 5 個可以加進行程的私房或備選點。",
    ...languageRules(f.lang),
    `8. 總花費盡量貼近每人預算 NT$${f.budget}。`,
    "9. 店名要誠實，用 verified 標示可信度：",
    "   - 捷運站、公園、園區、美術館、博物館這類長期存在的公共地標，直接寫名字，verified 填 landmark。",
    "   - 個別餐廳、咖啡廳、小店：除非你非常有把握它現在還在營業且資訊正確，",
    "     否則不要寫出具體店名。改用「區域＋類型」當名稱，例如「鹽埕埔站周邊素食自助餐」，",
    "     detail 寫怎麼挑（看哪個招牌、避開什麼、大概多少錢），verified 填 generic。",
    "   - 真的要指名但沒有十足把握，照樣寫出來，但 verified 填 unverified。",
    "10. 交通段（kind:transit）的 verified 一律填 landmark。",
    "10-b. 寫「搭 N 站」時，N 要照上面的路網索引實際數過（索引是照路線順序排的）。",
    "     數不出來就不要寫站數，寫「約 10 分鐘」即可 —— 旅客會盯著月台跑馬燈數站，",
    "     數到你寫的那一站就下車了。",
    "10-c. 班表若在車次後面標了「有位／剩少量／已售完」，那是高鐵官方的即時對號座狀態，",
    "     把它照抄進那一段的 detail。標「剩少量」或「已售完」時要提醒先訂票。",
    "10-d. 發車與抵達時刻要照班表原樣抄，不要自己加減 —— 抄錯一小時，",
    "     整天的時間就全部排在錯的基準上。",
    "10-a. 台鐵／高鐵車次只能從上面提供的實際班次裡挑，連同它的發車與抵達時刻一起寫進",
    "     name 或 howTo。沒有提供班表的路段就不要寫車次，只寫「搭高鐵北上，約 1 小時」",
    "     這種程度 —— 編一個不存在的車次，旅客是拿著它去買票的。",
    "11. 非交通的 stop 都要填 area，寫最小可辨識的地理範圍（行政區、商圈或老街名），",
    "    不要只寫城市名。這欄會用來把跑錯區的搜尋結果濾掉。",
    ...(f.days > 1
      ? [
          `12. 這是 ${f.days} 天 ${f.days - 1} 夜的行程，每個 stop 都要填 day（第幾天，1 起算）。`,
          "    每一天都要照時間排好，跨日時 day 加一、時間回到早上。",
          `13. 必須安排 ${f.days - 1} 晚住宿，用 kind:"stay"，排在該天最後一個 stop。`,
          "    detail 寫早鳥價與是否供應早餐，area 寫住宿所在的行政區。",
          "    住宿要選在隔天行程的起點附近，不要讓人早上先花一小時通勤。",
          "14. 隔天的第一個 stop 通常是早餐或退房；含早餐的住宿就不要再排一頓早餐。",
          "15. 回程交通排在最後一天的最後。中間幾天不要出現回出發地的交通。",
          "16. costUnit 用「每晚」時，金額請寫每人每晚（先按人數分攤過），加總才不會錯。",
        ]
      : ["12. 這是當日來回，所有 stop 的 day 都填 1，不要安排住宿。"]),
  ].join("\n");
}

/**
 * 語言規則。
 *
 * 對外語使用者最要緊的一件事：地名一定要留中文原文。
 * 「Ximen Station」給不了計程車司機看，也對不上站內的招牌 ——
 * 台灣的指標多半中英並列，但小吃店的招牌只有中文。
 */
function languageRules(lang: LangCode): string[] {
  if (lang === "zh-TW") {
    return ["7. 全部用繁體中文，地名與路線用台灣慣用說法。"];
  }
  const name = LANG_NAME[lang];
  return [
    `7. 所有文字都用 ${name} 撰寫（title、summary、name、detail、howTo、hours、rainPlan、notes、tips 全部）。`,
    `7-a. 但台灣的地名、車站、路線、店家名稱必須保留中文原文，寫成「${name}譯名（中文原文）」，`,
    "     例如 \"Ximending (西門町)\"、\"Blue Line / Bannan Line (板南線)\"、\"Exit 6 (6號出口)\"。",
    "     使用者要拿這些字去對照站內招牌、問路、給司機看 —— 只有譯名等於沒用。",
    "7-b. 金額一律用新臺幣整數，不要換算成其他幣別（匯率每天在動，換算只會誤導）。",
  ];
}

/* ------------------------------------------------------------------ *
 * 重排時間
 * ------------------------------------------------------------------ */

export const REPLAN_SYSTEM = [
  "你在調整一份「使用者已經自己編輯過」的行程：他刪掉了幾站，或插了幾站進去。",
  "你的工作只有一件：把時間重新排順。",
  "不准增加站、不准刪除站、不准更換地點、不准改動價格、不准改寫怎麼去的敘述 ——",
  "站的數量與順序完全照給你的來，轉乘指引與車次都是查證過的，不准動。",
  "只輸出 JSON，不寫任何說明文字。",
].join("\n");

export function buildReplanPrompt(
  f: PlanRequest,
  stops: Array<{
    kind: string;
    name: string;
    time: string;
    duration: string;
    area: string;
    day: number;
    /** 有班次的火車段：時間是固定的，其他站要繞著它排 */
    anchor?: boolean;
  }>,
): string {
  const list = stops
    .map(
      (s, i) =>
        `${i + 1}. [${s.kind}] ${s.name}${s.area ? `（${s.area}）` : ""}　原時間 ${s.time || "未定"}　停留 ${s.duration || "未定"}` +
        (s.anchor ? "　★時間固定不可更動（已訂班次）" : ""),
    )
    .join("\n");
  const anchors = stops
    .map((s, i) => (s.anchor ? `第 ${i + 1} 站 ${s.time}` : ""))
    .filter(Boolean);

  return [
    "目前的站序（使用者編輯後的結果）：",
    "",
    list,
    "",
    `出發時間：${f.start}　天數：${f.days}　人數：${f.people} 人`,
    "",
    "請重新排時間，輸出：",
    '{"stops":[{"time":"09:30","duration":"約 40 分鐘","day":1}],"note":"一句話說明你調整了什麼"}',
    "",
    "規則：",
    `1. stops 陣列長度必須剛好是 ${stops.length}，順序與上面一一對應。`,
    "2. 時間要接得上：前一站的結束時間加上移動時間，才是下一站的開始時間。",
    "3. 只輸出 time、duration、day 三個欄位。怎麼去的敘述不要動，也不要輸出 —— ",
    "   那裡面的路線、方向、站數、出口編號與車次都是查過真實資料的，改寫只會弄壞它。",
    "4. 移動時間要合理，別把步行 15 分鐘算成 5 分鐘。",
    f.days > 1
      ? `5. 這是 ${f.days} 天的行程，day 依照原本的分日不要亂改，除非時間真的排不下才順延。`
      : "5. 這是當日來回，所有 day 都填 1。",
    "6. 排不下的話在 note 裡直說（例如「最後一站會趕不上末班車」），不要硬塞。",
    ...(anchors.length
      ? [
          `7. 標了 ★ 的是已經訂好班次的火車，發車時間是固定的：${anchors.join("、")}。`,
          "   這幾站的 time 一定要照原樣輸出，其他站繞著它們排。",
          "   如果前面的行程結束得太早，寧可讓最後一站停留久一點，也不要把火車時間往前挪 ——",
          "   那個時間沒有車。",
        ]
      : []),
    ...(f.lang === "zh-TW" ? [] : [`8. duration 與 note 用 ${LANG_NAME[f.lang]} 撰寫，台灣地名保留中文原文。`]),
  ].join("\n");
}
