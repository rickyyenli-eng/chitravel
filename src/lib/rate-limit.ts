/**
 * 單機記憶體版的每分鐘上限。
 * 部署到多台機器就要換成 Redis，但在還沒有使用者之前，這樣就夠擋掉手滑連按。
 */
const hits = new Map<string, number[]>();

export function allow(key: string, perMinute: number): boolean {
  if (perMinute <= 0) return true;
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= perMinute) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

// 偶爾清掉不再活動的 key，避免記憶體長胖
setInterval(() => {
  const windowStart = Date.now() - 60_000;
  for (const [key, times] of hits) {
    const recent = times.filter((t) => t > windowStart);
    if (recent.length === 0) hits.delete(key);
    else hits.set(key, recent);
  }
}, 60_000).unref();
