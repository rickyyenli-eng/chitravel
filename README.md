# 順路走 — 後端骨架

輸入出發地、想吃什麼、交通偏好與預算，產生一份可以刪減、會即時重算花費的行程。

這一版把原本跑在 claude.ai 裡的原型，改成一個可以自己架、自己部署的網站：
**API 金鑰放在後端，前端只跟自己的伺服器講話。**

---

## 跑起來

```bash
npm install
cp .env.example .env      # 把 ANTHROPIC_API_KEY 填進去
npm run dev
```

打開 http://localhost:8787

金鑰到 [console.anthropic.com](https://console.anthropic.com) 申請。
不確定該填哪個模型 id，執行 `npm run models` 會列出你的金鑰現在能用哪些。

**如果你的金鑰是「綁定身分」的**（personal 或 service account key），還要填 `ANTHROPIC_WORKSPACE_ID`。
少了它每次請求都會被擋在 400，錯誤訊息會直接告訴你去哪拿。
ID 在 Console → Settings → Workspaces 的 ID 欄位，`wrkspc_` 開頭。

### 不用金鑰也想先看畫面

```bash
MOCK_PLAN=1 npm run dev
```

會用內建的假行程走完整條串流路徑 —— 一樣是逐站出現、一樣能刪減與重算費用，
但不呼叫模型、不花錢。假資料的店名都標了「（示範）」。

---

## 部署到 Render

repo 裡有 `render.yaml`，Render 會照它建，不用手動填一堆欄位。

1. Render → **New → Blueprint**
2. 選 `chitravel` 這個 repo
3. Render 會問三個 secret（`sync: false` 的那些），把 `.env` 裡的值貼進去：
   `ANTHROPIC_API_KEY`、`ANTHROPIC_WORKSPACE_ID`、`TAVILY_API_KEY`
4. **Apply**

其他設定藍圖裡都寫死了：新加坡機房（離台灣最近）、Node 22、
健康檢查打 `/healthz`、推 commit 就自動重新部署。

公開網址上兩個參數刻意調保守：每個 IP 每分鐘 **3 次**、快取 **15 分鐘**。
一份行程約 NT$2，這兩個值決定有人亂按時你會賠多少。

**免費方案會休眠。** 閒置 15 分鐘後停掉，下一個訪客要等 30–60 秒喚醒。
給幾個人試夠用；要給不特定的人看就得升級。

### 為什麼不是 GitHub Pages

Pages 只能放靜態檔。這個專案的 `/api/plan` 要跑 Node，而且金鑰**必須**留在
伺服器端 —— 放到前端等於把信用卡貼在原始碼上。

### 為什麼還沒上 Cloudflare Workers

Hono 本來就是為 Workers 寫的，但免費方案每個請求只有 **10 毫秒 CPU**，
而串流解析器掃一份 16KB 的回應大約要 20–80 毫秒，會被砍掉。
付費方案（$5/月）有 30 秒 CPU，綽綽有餘。
另外 `process.env`、`node:crypto`、記憶體快取與頻率限制都要改成 Workers 的寫法，
大約兩三小時的工。等確定有人要用再搬。

---

## 目錄

```
src/
  server.ts          Hono 伺服器，掛靜態檔與 /api
  config.ts          讀 .env，缺金鑰時直接擋下來並說怎麼修
  types.ts           前後端唯一的契約：表單 schema 與行程 schema
  prompt.ts          system prompt 與行程 prompt
  llm.ts             Anthropic 呼叫封裝，錯誤翻譯成自己的 code
  routes/plan.ts     POST /api/plan 與 /api/plan/stream
  lib/json.ts        從模型回覆挖出 JSON（容忍圍籬與贅字）
  lib/stream-parse.ts 邊收邊解析：一站寫完就先送一站
  lib/mock-trip.ts   MOCK_PLAN=1 用的假行程
  lib/cache.ts       相同條件的短期快取
  lib/rate-limit.ts  每 IP 每分鐘上限
public/
  index.html         前端，單檔、無建置步驟
scripts/
  list-models.ts     npm run models
```

---

## API

### `POST /api/plan`

送出：

```json
{
  "from": "台中高鐵站",
  "to": "台北",
  "food": "義式料理",
  "date": "2026-09-08",
  "start": "09:00",
  "people": 2,
  "budget": 3000,
  "transport": ["高鐵", "捷運", "步行"],
  "needs": ["不吃辣", "要開發票"],
  "include": ["打卡景點", "私房景點", "雨天備案"],
  "notes": ""
}
```

成功：

```json
{ "ok": true, "cached": false, "ms": 24310, "trip": { "title": "...", "stops": [...], "extras": [...], "tips": [...] } }
```

失敗：

```json
{ "ok": false, "code": "invalid_json", "message": "這次回來的格式跑掉了，再按一次通常就好。" }
```

`code` 可能是 `bad_request` / `no_key` / `rate_limited` / `upstream_error` / `invalid_json` / `empty_plan` / `timeout`。
前端照 code 顯示自己的文案，不直接吐後端訊息給使用者。

### `POST /api/plan/stream`

同樣的請求格式，但用 SSE 逐段回傳。**前端走的是這一支。**

模型是照順序把 JSON 寫出來的，所以一站寫完就能先送給前端，不必等整份寫完。
成本與一次給完完全一樣 —— 只有一次模型呼叫，差別只在把等待攤開來看：
第一張卡片大約 5 秒出現，而不是盯著轉圈圈等 40 秒。

事件：

| event | data | 時機 |
|---|---|---|
| `meta` | `{title, summary}` | 標題與摘要都寫完時 |
| `stop` | 一個 stop 物件 | 每寫完一站 |
| `extra` | 一個 extra 物件 | 每寫完一個備選 |
| `done` | `{tips, cached, ms, verifying, mock?, partial?}` | 行程寫完，`verifying` 是接下來要查證幾站 |
| `verify` | `{index, candidates, failed?}` | 每查完一站 |
| `end` | `{}` | 全部結束（含查證） |
| `error` | `{code, message}` | 出錯，前端照 code 顯示文案 |

`partial: true` 表示收尾解析失敗，但已經送出去的那幾站仍然有效 —— 前端不會因此把整頁清掉。

### 多天行程

`days` 是 1（當日來回）到 3。每個 stop 帶 `day` 欄位，前端據此在每天開頭插分隔線
並顯示當天小計。`days > 1` 時 prompt 會強制安排住宿，並要求住在隔天行程的起點附近 ——
不然使用者早上得先花一小時通勤。

`costUnit: "每晚"` 的金額是**每人每晚**（已按人數分攤），這樣加總不用猜一間房住幾個人。

上限訂在 3 天，是因為現在一趟只呼叫模型一次：天數愈多輸出愈長，
三天大約要三到四分鐘。要做更長的行程得改成**一天一次呼叫**，
讓第一天先出現、後面幾天邊等邊生 —— 那是下一步，不是現在。

### `GET /healthz`

回 `{ ok, model }`，前端右上角那行字就是讀這個。

---

## 幾個刻意的決定

**表單先驗證再花錢。** `PlanRequestSchema` 擋掉的請求一個 token 都不會用到。

**模型回來的東西全部走 schema，而且全部 `catch`。** 模型少給一個欄位、把 `cost` 寫成字串，不該讓整份行程掛掉 — 該欄位退回預設值，其他照常顯示。

**prefill `{`。** 讓模型直接從左大括號開始寫，省掉「以下是為您規劃的行程：」這種開場白，也降低解析失敗率。

**快取用「條件 + 模型」當 key。** 開發期反覆按同一組條件測版面時，這個省下的錢比想像多。

**模型不准編店名。** 實測發現最危險的錯誤不是搭錯捷運線，而是行程裡出現一家
「名字是真的、但地點、類型、營業時間全錯」的餐廳 —— 使用者照著走過去會白跑一趟。
所以 prompt 要求每個 stop 自評 `verified`：

| 值 | 意思 | 前端顯示 |
|---|---|---|
| `landmark` | 捷運站、公園、園區、美術館這類長期存在的公共地標 | 不標 |
| `generic` | 沒有指名，只給「區域＋類型＋怎麼挑」 | 灰色虛線「未指名 · 到場再挑」 |
| `unverified` | 指名了具體商家，但沒查證 | 橘色「店名未查證」 |

模型漏填時一律當成 `unverified`，寧可多提醒一次。
這個欄位同時是下一步「接搜尋驗證」的介面：查到了就把 `generic` 補成真名並升級，
查不到就維持模糊。**模糊但正確，比精確但錯誤有用得多。**

**查證只查該查的，而且不讓模型碰網址。** 行程送完後，只有模型自評為 `generic` 或
`unverified` 的站會去搜尋（地標與交通段不浪費搜尋費）。防止它再編一次的兩道防線：

1. 抽取用的提示只給搜尋結果與**編號**，模型回傳 `source: 2` 這種編號，網址由後端依編號對回去 —— 模型碰不到網址，也就編不出網址。
2. 回來的店名必須逐字出現在搜尋結果原文裡，否則直接丟掉。
3. 地區要對得上這一站的 `area`，否則丟掉。搜尋很常回「全市美食懶人包」，
   裡面的店散落各區 —— 實測「五福商圈」查到的三家有兩家在左營與三民，
   不濾掉會害使用者走冤枉路。比對用的是去掉「區／商圈／老街」後的核心詞
   （`鹽埕區`→`鹽埕`、`五福商圈`→`五福`），短於兩個字就放棄比對，寧可不濾也不要濾錯。

查到的候選會掛在該站底下，每一筆都附「來源」連結。**使用者點一下就能自己確認** ——
這比假裝很準然後害人白跑一趟好得多。找不到就誠實說找不到。

**錯誤碼與錯誤訊息分開。** 後端給 code，前端決定要跟使用者怎麼說。

**串流解析自己走一遍字元，不靠正則抓物件。** 店名裡可能有 `{`、`}` 或跳脫引號，
必須追蹤字串狀態才不會把物件邊界抓錯。已經用隨機切片測過（每次切在不同位置，事件不重不漏）。

**模擬模式走的是同一條路徑。** `MOCK_PLAN=1` 也經過同一個解析器與同一組 SSE 事件，
所以測到的是真的那條路，不是另外寫一份假的。

---

## 還沒做的（依建議順序）

1. ~~分段吐結果~~ — 已完成，見 `/api/plan/stream`。
2. ~~不准編店名~~ — 已完成，見上面的 `verified`。
3. ~~接搜尋~~ — 已完成，見 `src/verify.ts`（Tavily）。
4. **接 TDX** — 交通部運輸資料流通服務，免費。班次、票價、捷運轉乘、幾號出口，這些不該讓模型用猜的。
5. **接氣象署** — 免費。用當日預報決定要不要主動切到雨天備案。
6. **本機批次建資料庫** — 用 Mac 離線把常見區域的餐廳景點整理成結構化資料，讓線上那一次呼叫不用再搜尋。
7. **匯出** — Google 行事曆、地圖路線、分享連結。
8. **兩段式模型** — 萃取用 Haiku，編排用 Sonnet。
