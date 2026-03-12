import type { TokenUsageStats } from "@/lib/telegram";

interface TokenUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  outputTokenDetails?: { reasoningTokens?: number };
  inputTokenDetails?: { cacheReadTokens?: number };
}

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parsePositiveFloatEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

// ---------------------------------------------------------------------------
// Token usage helpers
// ---------------------------------------------------------------------------

export function hasUsageNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function toTokenUsageStats(
  usage: TokenUsageLike | undefined,
): TokenUsageStats | undefined {
  if (!usage) return undefined;

  const reasoningTokens = usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens;
  const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens;

  const stats: TokenUsageStats = {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens,
    cachedInputTokens,
  };

  const hasAnyValue =
    hasUsageNumber(stats.inputTokens) ||
    hasUsageNumber(stats.outputTokens) ||
    hasUsageNumber(stats.totalTokens) ||
    hasUsageNumber(stats.reasoningTokens) ||
    hasUsageNumber(stats.cachedInputTokens);

  return hasAnyValue ? stats : undefined;
}

export function mergeTokenUsage(
  first: TokenUsageStats | undefined,
  second: TokenUsageStats | undefined,
): TokenUsageStats | undefined {
  const sum = (a: number | undefined, b: number | undefined): number | undefined => {
    if (!hasUsageNumber(a) && !hasUsageNumber(b)) return undefined;
    return (a ?? 0) + (b ?? 0);
  };

  const merged: TokenUsageStats = {
    inputTokens: sum(first?.inputTokens, second?.inputTokens),
    outputTokens: sum(first?.outputTokens, second?.outputTokens),
    totalTokens: sum(first?.totalTokens, second?.totalTokens),
    reasoningTokens: sum(first?.reasoningTokens, second?.reasoningTokens),
    cachedInputTokens: sum(first?.cachedInputTokens, second?.cachedInputTokens),
  };

  const hasAnyValue =
    hasUsageNumber(merged.inputTokens) ||
    hasUsageNumber(merged.outputTokens) ||
    hasUsageNumber(merged.totalTokens) ||
    hasUsageNumber(merged.reasoningTokens) ||
    hasUsageNumber(merged.cachedInputTokens);

  return hasAnyValue ? merged : undefined;
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

export function extractJsonPayload(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const candidates: string[] = [];
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidates.push(trimmed);
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.push(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Logging & debugging
// ---------------------------------------------------------------------------

export const AI_CHAT_DEBUG_LOGS = parseBooleanEnv(
  process.env.AI_CHAT_DEBUG_LOGS,
  process.env.NODE_ENV !== "production",
);
export const AI_CHAT_DEBUG_TEXT_LIMIT = parsePositiveIntEnv(process.env.AI_CHAT_DEBUG_TEXT_LIMIT, 320);
export const AI_CHAT_DEBUG_RAW_TEXT_LIMIT = parsePositiveIntEnv(
  process.env.AI_CHAT_DEBUG_RAW_TEXT_LIMIT,
  8000,
);

export function truncateForLog(text: string, maxLength = AI_CHAT_DEBUG_TEXT_LIMIT): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function truncateRawTextForLog(text: string, maxLength = AI_CHAT_DEBUG_RAW_TEXT_LIMIT): string {
  const normalized = text.trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function summarizeError(error: unknown): string {
  if (error instanceof Error) return truncateForLog(error.message, 240);
  return truncateForLog(String(error), 240);
}

export function logChatAIDebug(
  requestId: string,
  phase: string,
  payload: Record<string, unknown>,
): void {
  if (!AI_CHAT_DEBUG_LOGS) return;

  try {
    console.log(`[chat-ai][${requestId}][${phase}] ${JSON.stringify(payload)}`);
  } catch {
    console.log(`[chat-ai][${requestId}][${phase}]`, payload);
  }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

export function createRequestId(): string {
  return `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function durationMs(start: number, end = performance.now()): number {
  return Math.max(0, Math.round(end - start));
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export function classifyUpstreamError(detail: string, model: string): { reason: string; status: number } {
  const statusMatch = detail.match(/(\d{3})/);
  const upstreamStatus = statusMatch ? Number(statusMatch[1]) : 0;

  let reason: string;
  if (upstreamStatus === 401 || upstreamStatus === 403) {
    reason = "AI 服务认证失败，请检查 API Key 配置";
  } else if (upstreamStatus === 404) {
    reason = `AI 模型 "${model}" 不可用，请检查模型名称配置`;
  } else if (upstreamStatus === 429) {
    reason = "AI 服务调用额度已用尽或请求过于频繁，请稍后再试";
  } else if (detail.includes("content") && detail.includes("filter")) {
    reason = "该问题触发了内容安全策略，换个方式问问看吧";
  } else if (detail.includes("timeout") || detail.includes("ETIMEDOUT")) {
    reason = "AI 服务响应超时，可能是上游服务繁忙，请稍后重试";
  } else if (detail.includes("fetch") || detail.includes("network") || detail.includes("ECONNREFUSED")) {
    reason = "无法连接到 AI 服务，请检查 AI_BASE_URL 配置和网络连通性";
  } else {
    reason = "AI 服务暂时不可用，请稍后再试";
  }

  return {
    reason,
    status: upstreamStatus >= 400 ? upstreamStatus : 502,
  };
}
