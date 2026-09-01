import { ExtraSchema, StopSchema, type Extra, type Stop } from "../types.js";

/**
 * 邊收邊解析。
 *
 * 模型是照順序把 JSON 寫出來的，所以一站寫完就能先送給前端，
 * 不必等整份寫完。這樣使用者第一張卡片大概 5 秒就看得到，
 * 而不是盯著轉圈圈等 40 秒 —— 成本完全一樣，只有一次呼叫。
 */
export type StreamEmit = {
  meta?: (m: { title: string; summary: string }) => void;
  stop?: (s: Stop) => void;
  extra?: (x: Extra) => void;
};

export class TripStreamParser {
  private text = "";
  private metaSent = false;
  private stopsDone = 0;
  private extrasDone = 0;

  constructor(private emit: StreamEmit) {}

  push(delta: string): void {
    this.text += delta;
    this.tryMeta();
    this.tryArray("stops");
    this.tryArray("extras");
  }

  get raw(): string {
    return this.text;
  }

  private tryMeta(): void {
    if (this.metaSent) return;
    const title = matchString(this.text, "title");
    const summary = matchString(this.text, "summary");
    // 兩個都寫完才送，避免標題先出現、摘要空白閃一下
    if (title === null || summary === null) return;
    this.metaSent = true;
    this.emit.meta?.({ title, summary });
  }

  private tryArray(key: "stops" | "extras"): void {
    const start = arrayStart(this.text, key);
    if (start < 0) return;
    const objects = completeObjects(this.text, start);
    const from = key === "stops" ? this.stopsDone : this.extrasDone;

    for (let i = from; i < objects.length; i++) {
      const source = objects[i];
      if (source === undefined) continue;
      let value: unknown;
      try {
        value = JSON.parse(source);
      } catch {
        // 寫壞的那一筆就跳過，不讓它擋住後面的
        continue;
      }
      if (key === "stops") {
        const parsed = StopSchema.safeParse(value);
        if (parsed.success) this.emit.stop?.(parsed.data);
      } else {
        const parsed = ExtraSchema.safeParse(value);
        if (parsed.success) this.emit.extra?.(parsed.data);
      }
    }
    if (key === "stops") this.stopsDone = objects.length;
    else this.extrasDone = objects.length;
  }
}

/** 只在字串「已經寫完」（有收尾引號）時才取值，寫到一半的不算 */
function matchString(text: string, key: string): string | null {
  const re = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
  const m = re.exec(text);
  if (!m || m[1] === undefined) return null;
  try {
    return JSON.parse('"' + m[1] + '"') as string;
  } catch {
    return m[1];
  }
}

function arrayStart(text: string, key: string): number {
  const m = new RegExp('"' + key + '"\\s*:\\s*\\[').exec(text);
  return m ? m.index + m[0].length : -1;
}

/**
 * 從陣列開頭往後掃，回傳所有「大括號已經配對完成」的物件字串。
 * 要自己走一遍字元是因為字串裡可能有大括號或跳脫引號。
 */
function completeObjects(text: string, from: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === undefined) break;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break; // 陣列收尾了
    }
  }
  return out;
}
