import { z } from "zod";

/**
 * 這份檔案是前後端唯一的契約。
 * 前端渲染什麼、後端要 AI 吐什麼，都以這裡為準。
 */

/** 介面與行程輸出的語言 */
export const Lang = z.enum(["zh-TW", "en", "fr", "ja"]);
export type LangCode = z.infer<typeof Lang>;

export const StopKind = z.enum(["transit", "food", "sight", "stay", "other"]);
/** 每晚 = 每人每晚（住宿已按人數分攤過），這樣加總才不用猜一間房住幾個人 */
export const CostUnit = z.enum(["每人", "每組", "每晚"]);

/**
 * 這個名字有多可信。
 * landmark   長期存在的公共地標或場館（捷運站、公園、美術館、園區）
 * unverified 具體商家名稱，但沒有查證過
 * generic    沒有指名，只給區域與類型的挑選建議
 */
export const Verified = z.enum(["landmark", "unverified", "generic"]);

/** 使用者從表單送上來的條件 */
export const PlanRequestSchema = z.object({
  from: z.string().trim().min(1).max(60),
  to: z.string().trim().min(1).max(60),
  food: z.string().trim().max(60).default(""),
  date: z.string().trim().max(20).default(""),
  /** 幾天。1 = 當日來回，2 = 兩天一夜，依此類推 */
  days: z.coerce.number().int().min(1).max(3).default(1),
  start: z.string().trim().max(10).default("09:00"),
  people: z.coerce.number().int().min(1).max(20).default(2),
  budget: z.coerce.number().int().min(0).max(1_000_000).default(0),
  // 上限 40 而非 20：法文的「Train à grande vitesse」有 22 個字元，
  // 20 會把整個法文介面擋在 400
  transport: z.array(z.string().max(40)).max(12).default([]),
  needs: z.array(z.string().max(40)).max(12).default([]),
  include: z.array(z.string().max(40)).max(12).default([]),
  notes: z.string().trim().max(500).default(""),
  lang: Lang.catch("zh-TW").default("zh-TW"),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

/**
 * AI 回來的資料一律走這裡。
 * 全部用 catch/default，模型少給一個欄位或型別給錯不該讓整份行程掛掉。
 */
/**
 * 一段移動。這是「不要讓模型寫句子」的核心 ——
 * 它只填欄位，路線是否正確、要搭幾站、往哪個方向、句子怎麼寫，
 * 全部由伺服器用真實路網算出來。
 *
 * 為什麼要改成這樣：站數的漏報補了四次（句子裡、標題裡、括號寫法、上一站），
 * 每一次都是線上實測才發現。從自由文字反推「這個 N 是哪兩站之間」本質上就脆弱。
 * 改成結構化之後就不用猜。
 */
export const LegMode = z.enum(["metro", "rail", "walk", "bus", "taxi", "other"]);

export const LegSchema = z.object({
  mode: LegMode.catch("other"),
  /** 捷運路線中文名（板南線）或鐵路種類（高鐵、台鐵自強） */
  line: z.string().max(20).catch(""),
  from: z.string().max(30).catch(""),
  to: z.string().max(30).catch(""),
  /** 台鐵／高鐵車次 */
  trainNo: z.string().max(10).catch(""),
  /** 出口編號，只填數字或代號 */
  exit: z.string().max(10).catch(""),
  /** 步行或搭乘分鐘數 */
  minutes: z.coerce.number().int().min(0).max(600).catch(0),
});
export type Leg = z.infer<typeof LegSchema>;

export const StopSchema = z.object({
  kind: StopKind.catch("other"),
  name: z.string().catch("未命名"),
  /** 第幾天，從 1 開始。當日來回全部都是 1 */
  day: z.coerce.number().int().min(1).catch(1),
  time: z.string().catch(""),
  duration: z.string().catch(""),
  howTo: z.string().catch(""),
  detail: z.string().catch(""),
  hours: z.string().catch(""),
  /** 行政區或商圈，查證時用來把跑錯區的候選濾掉 */
  area: z.string().catch(""),
  cost: z.coerce.number().catch(0),
  costUnit: CostUnit.catch("每人"),
  // 模型漏填時一律當成未查證，寧可多提醒一次
  verified: Verified.catch("unverified"),
  rainPlan: z.string().catch(""),
  notes: z.array(z.string()).catch([]),
  booking: z.string().catch(""),
  /** 交通段才有。有 legs 時 howTo 由伺服器產生，模型寫的會被覆蓋 */
  legs: z.array(LegSchema).max(6).catch([]),
});
export type Stop = z.infer<typeof StopSchema>;

export const ExtraSchema = z.object({
  kind: StopKind.catch("sight"),
  name: z.string().catch("備選"),
  why: z.string().catch(""),
  area: z.string().catch(""),
  cost: z.coerce.number().catch(0),
  costUnit: CostUnit.catch("每人"),
});
export type Extra = z.infer<typeof ExtraSchema>;

export const TripSchema = z.object({
  title: z.string().catch(""),
  summary: z.string().catch(""),
  stops: z.array(StopSchema).default([]),
  extras: z.array(ExtraSchema).catch([]),
  tips: z.array(z.string()).catch([]),
});
export type Trip = z.infer<typeof TripSchema>;

/** 回給前端的統一形狀 */
export type PlanOk = { ok: true; trip: Trip; cached: boolean; ms: number };
export type PlanErr = { ok: false; code: ErrorCode; message: string };

export type ErrorCode =
  | "bad_request"
  | "no_key"
  | "no_workspace"
  | "rate_limited"
  | "upstream_error"
  | "invalid_json"
  | "empty_plan"
  | "timeout";
