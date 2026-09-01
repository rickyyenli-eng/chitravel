/**
 * 從模型回覆裡把 JSON 挖出來。
 * 模型偶爾會多寫一句「以下是您的行程：」或包一層 markdown 圍籬，
 * 為了這種小事讓使用者重按一次不划算，所以這裡容忍三種寫法。
 */
export function extractJson(raw: string): unknown | null {
  const text = raw.trim();
  if (!text) return null;

  // 1. 整段就是 JSON
  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  // 2. 包在 ```json ... ``` 裡
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const parsed = tryParse(fence[1].trim());
    if (parsed !== undefined) return parsed;
  }

  // 3. 從第一個 { 或 [ 到最後一個 } 或 ]
  const start = firstIndex(text, ["{", "["]);
  const end = lastIndex(text, ["}", "]"]);
  if (start >= 0 && end > start) {
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }

  return null;
}

function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function firstIndex(s: string, chars: string[]): number {
  const found = chars.map((c) => s.indexOf(c)).filter((i) => i >= 0);
  return found.length ? Math.min(...found) : -1;
}

function lastIndex(s: string, chars: string[]): number {
  return Math.max(...chars.map((c) => s.lastIndexOf(c)));
}
