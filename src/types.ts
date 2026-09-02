import { z } from "zod";

/**
 * 這份檔案是前後端唯一的契約。
 * 前端渲染什麼、後端要 AI 吐什麼，都以這裡為準。
 */

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
  transport: z.array(z.string().max(20)).max(12).default([]),
  needs: z.array(z.string().max(20)).max(12).default([]),
  include: z.array(z.string().max(20)).max(12).default([]),
  notes: z.string().trim().max(500).default(""),
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

/**
 * AI 回來的資料一律走這裡。
 * 全部用 catch/default，模型少給一個欄位或型別給錯不該讓整份行程掛掉。
 */
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
