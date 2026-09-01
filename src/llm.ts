import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import type { ErrorCode } from "./types.js";

export class LlmError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.anthropicKey,
      // 綁定身分的金鑰要在每次請求帶上 workspace，沒設定就不送這個標頭
      ...(config.workspaceId
        ? { defaultHeaders: { "anthropic-workspace-id": config.workspaceId } }
        : {}),
    });
  }
  return client;
}

export type AskOptions = {
  system: string;
  prompt: string;
  model?: string;
  maxTokens?: number;
  /** 讓模型直接從 { 開始寫，少掉「以下是您的行程」這種開場白 */
  prefill?: string;
  signal?: AbortSignal;
};

export type AskResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

export async function ask(opts: AskOptions): Promise<AskResult> {
  const model = opts.model ?? config.plannerModel;

  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
    if (opts.prefill) messages.push({ role: "assistant", content: opts.prefill });

    const res = await getClient().messages.create(
      {
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system: opts.system,
        messages,
      },
      { signal: opts.signal },
    );

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    return {
      // prefill 的內容不會出現在回覆裡，要自己接回去才是完整 JSON
      text: (opts.prefill ?? "") + text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      stopReason: res.stop_reason,
    };
  } catch (err) {
    throw toLlmError(err, model);
  }
}

function toLlmError(err: unknown, model: string): LlmError {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return new LlmError("no_key", "API 金鑰無效或已失效。");
    if (err.status === 404) {
      return new LlmError("upstream_error", `找不到模型 ${model}，請確認 .env 裡的 PLANNER_MODEL。`);
    }
    if (err.status === 429) return new LlmError("rate_limited", "上游忙碌中，稍後再試。");
    if (err.status && err.status >= 500) return new LlmError("upstream_error", "上游服務暫時異常。");
    if (err.status === 400 && /workspace/i.test(err.message)) {
      return new LlmError(
        "no_workspace",
        "這把金鑰綁定身分，必須指定 workspace。到 console.anthropic.com 的 Settings → Workspaces " +
          "複製 ID（wrkspc_ 開頭），填進 .env 的 ANTHROPIC_WORKSPACE_ID。",
      );
    }
    return new LlmError("upstream_error", err.message);
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new LlmError("timeout", "請求已取消或逾時。");
  }
  return new LlmError("upstream_error", err instanceof Error ? err.message : "未知錯誤");
}

/**
 * 同一次呼叫，但邊寫邊回。
 * onText 收到的是新增的片段，累積與解析交給呼叫端。
 */
export async function askStream(
  opts: AskOptions & { onText: (delta: string) => void },
): Promise<AskResult> {
  const model = opts.model ?? config.plannerModel;

  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
    if (opts.prefill) messages.push({ role: "assistant", content: opts.prefill });

    const stream = getClient().messages.stream(
      {
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system: opts.system,
        messages,
      },
      { signal: opts.signal },
    );

    let text = "";
    stream.on("text", (delta: string) => {
      text += delta;
      opts.onText(delta);
    });

    const final = await stream.finalMessage();

    return {
      text: (opts.prefill ?? "") + text,
      inputTokens: final.usage.input_tokens,
      outputTokens: final.usage.output_tokens,
      stopReason: final.stop_reason,
    };
  } catch (err) {
    throw toLlmError(err, model);
  }
}

/** 粗估這次呼叫花多少美金，開發期用來知道自己燒得快不快 */
export function estimateCostUsd(r: AskResult, inPerMTok = 2, outPerMTok = 10): number {
  return (r.inputTokens / 1_000_000) * inPerMTok + (r.outputTokens / 1_000_000) * outPerMTok;
}
