import type { PlanRequest } from "./types.js";

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

export function buildPlanPrompt(f: PlanRequest): string {
  return [
    "請依下列條件排一趟行程。",
    "",
    `出發地：${f.from}`,
    `目的地：${f.to}`,
    `想吃：${f.food || "在地美食"}`,
    `日期：${f.date || "近期"}`,
    `出發時間：${f.start}`,
    `人數：${f.people} 人`,
    `每人預算：NT$${f.budget}`,
    `偏好交通方式：${f.transport.join("、") || "不限"}`,
    `特殊要求：${f.needs.join("、") || "無"}`,
    `要包含：${f.include.join("、") || "餐廳與景點"}`,
    `補充：${f.notes || "無"}`,
    "",
    "只輸出這個 JSON 物件：",
    SHAPE,
    "",
    "規則：",
    "1. cost 是新台幣整數，免費填 0。costUnit 只能是「每人」「每組」或「每晚」。",
    '2. stops 依時間排序。交通段用 kind:"transit"，必須寫清楚搭哪條路線、在哪一站轉乘、走幾號出口、步行幾分鐘。',
    '3. 若「要包含」有住宿，加一個 kind:"stay" 的 stop，在 detail 寫早鳥價與是否供應早餐。',
    "4. 每個非交通的 stop 都要有 rainPlan。",
    "5. notes 要反映特殊要求（不吃辣、可開發票、無障礙、親子友善等）。",
    "6. extras 給 3 到 5 個可以加進行程的私房或備選點。",
    "7. 全部用繁體中文，地名與路線用台灣慣用說法。",
    `8. 總花費盡量貼近每人預算 NT$${f.budget}。`,
    "9. 店名要誠實，用 verified 標示可信度：",
    "   - 捷運站、公園、園區、美術館、博物館這類長期存在的公共地標，直接寫名字，verified 填 landmark。",
    "   - 個別餐廳、咖啡廳、小店：除非你非常有把握它現在還在營業且資訊正確，",
    "     否則不要寫出具體店名。改用「區域＋類型」當名稱，例如「鹽埕埔站周邊素食自助餐」，",
    "     detail 寫怎麼挑（看哪個招牌、避開什麼、大概多少錢），verified 填 generic。",
    "   - 真的要指名但沒有十足把握，照樣寫出來，但 verified 填 unverified。",
    "10. 交通段（kind:transit）的 verified 一律填 landmark。",
    "11. 非交通的 stop 都要填 area，寫最小可辨識的地理範圍（行政區、商圈或老街名），",
    "    不要只寫城市名。這欄會用來把跑錯區的搜尋結果濾掉。",
  ].join("\n");
}
