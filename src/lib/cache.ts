import { createHash } from "node:crypto";

/**
 * 同樣的條件在短時間內重複問，直接回上次的結果。
 * 開發期一直按同一組條件測版面時，這個省下的錢比想像多。
 */
export class TtlCache<T> {
  private store = new Map<string, { at: number; value: T }>();

  constructor(
    private ttlMs: number,
    private maxEntries = 200,
  ) {}

  get(key: string): T | undefined {
    if (this.ttlMs <= 0) return undefined;
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    if (this.ttlMs <= 0) return;
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { at: Date.now(), value });
  }
}

export function hashKey(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}
