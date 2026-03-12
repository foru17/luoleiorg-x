const MAX_MESSAGE_LENGTH = 4000;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function hashIp(ip: string): string {
  let hash = 0;
  for (const char of ip) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(6, "0").slice(0, 6);
}

function formatTime(date: Date): string {
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch {
    // Monitoring should never break the main service
  }
}

export interface ChatNotification {
  userIp: string;
  userMessage: string;
  aiResponse: string;
  articleTitles: string[];
  messageCount: number;
  modelConfig?: ChatModelConfig;
  finishReason?: string;
  rawFinishReason?: string;
  tokenUsage?: {
    total?: TokenUsageStats;
    chatCompletion?: TokenUsageStats;
    keywordExtraction?: TokenUsageStats;
    evidenceAnalysis?: TokenUsageStats;
  };
  timings?: RequestTimingStats;
}

export interface TokenUsageStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface RequestTimingStats {
  totalMs?: number;
  keywordExtractionMs?: number;
  evidenceAnalysisMs?: number;
  searchMs?: number;
  promptBuildMs?: number;
  reusedSearchContext?: boolean;
}

export interface ChatModelConfig {
  apiBaseUrl?: string;
  chatModel?: string;
  keywordModel?: string;
  evidenceModel?: string;
}

function hasTokenValue(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function hasUsageData(usage: TokenUsageStats | undefined): boolean {
  if (!usage) return false;
  return (
    hasTokenValue(usage.inputTokens) ||
    hasTokenValue(usage.outputTokens) ||
    hasTokenValue(usage.totalTokens) ||
    hasTokenValue(usage.reasoningTokens) ||
    hasTokenValue(usage.cachedInputTokens)
  );
}

function formatTokenValue(value: number | undefined): string {
  return hasTokenValue(value) ? value.toLocaleString("zh-CN") : "-";
}

function formatUsageLine(
  label: string,
  usage: TokenUsageStats | undefined,
): string | null {
  if (!hasUsageData(usage)) return null;

  const parts: string[] = [];
  if (hasTokenValue(usage?.totalTokens)) {
    parts.push(`总 ${formatTokenValue(usage?.totalTokens)}`);
  }
  if (hasTokenValue(usage?.inputTokens)) {
    parts.push(`入 ${formatTokenValue(usage?.inputTokens)}`);
  }
  if (hasTokenValue(usage?.outputTokens)) {
    parts.push(`出 ${formatTokenValue(usage?.outputTokens)}`);
  }
  if (hasTokenValue(usage?.cachedInputTokens)) {
    parts.push(`缓存 ${formatTokenValue(usage?.cachedInputTokens)}`);
  }
  if (hasTokenValue(usage?.reasoningTokens)) {
    parts.push(`推理 ${formatTokenValue(usage?.reasoningTokens)}`);
  }

  return `  · ${label}: ${parts.join(" / ")}`;
}

function formatTimingValue(value: number | undefined): string {
  return hasTokenValue(value) ? `${Math.max(0, Math.round(value))}ms` : "-";
}

function extractApiHost(apiBaseUrl: string | undefined): string | undefined {
  if (!apiBaseUrl) return undefined;

  try {
    return new URL(apiBaseUrl).host;
  } catch {
    const sanitized = apiBaseUrl.replace(/^https?:\/\//i, "").trim();
    const host = sanitized.split("/")[0]?.trim();
    return host || undefined;
  }
}

export async function sendChatNotification(
  params: ChatNotification,
): Promise<void> {
  const {
    userIp,
    userMessage,
    aiResponse,
    articleTitles,
    messageCount,
    modelConfig,
    finishReason,
    rawFinishReason,
    tokenUsage,
    timings,
  } =
    params;

  const userHash = hashIp(userIp);
  const time = formatTime(new Date());
  const turn = Math.ceil(messageCount / 2);

  const truncatedResponse =
    aiResponse.length > 1500
      ? aiResponse.slice(0, 1500) + "…(truncated)"
      : aiResponse;

  const lines: string[] = [
    `🗣 <b>博客 AI 对话</b>`,
    ``,
    `👤 <code>${userHash}</code>  ·  🕐 ${time}  ·  第 ${turn} 轮`,
    ``,
    `<b>❓ 读者:</b>`,
    escapeHtml(userMessage),
    ``,
    `<b>💬 AI:</b>`,
    escapeHtml(truncatedResponse),
  ];

  if (articleTitles.length > 0) {
    lines.push(
      ``,
      `<b>📎 引用文章:</b>`,
      ...articleTitles.slice(0, 5).map((t) => `  · ${escapeHtml(t)}`),
    );
  }

  const apiHost = extractApiHost(modelConfig?.apiBaseUrl);
  const chatModel = modelConfig?.chatModel?.trim();
  const keywordModel = modelConfig?.keywordModel?.trim();
  if (apiHost || chatModel || keywordModel) {
    lines.push(``, `<b>⚙️ 模型配置:</b>`);
    if (apiHost) {
      lines.push(`  · API Host: ${escapeHtml(apiHost)}`);
    }
    if (chatModel) {
      lines.push(`  · 主对话模型: ${escapeHtml(chatModel)}`);
    }
    if (keywordModel) {
      const label =
        chatModel && keywordModel === chatModel ? "同主对话模型" : escapeHtml(keywordModel);
      lines.push(`  · 关键词模型: ${label}`);
    }
    const evidenceModel = modelConfig?.evidenceModel?.trim();
    if (evidenceModel) {
      const label =
        chatModel && evidenceModel === chatModel
          ? "同主对话模型"
          : keywordModel && evidenceModel === keywordModel
            ? "同关键词模型"
            : escapeHtml(evidenceModel);
      lines.push(`  · 证据分析模型: ${label}`);
    }
  }

  const totalUsageLine = formatUsageLine("本次请求合计", tokenUsage?.total);
  const chatUsageLine = formatUsageLine("主对话", tokenUsage?.chatCompletion);
  const keywordUsageLine = formatUsageLine("关键词提取", tokenUsage?.keywordExtraction);
  const evidenceUsageLine = formatUsageLine("证据分析", tokenUsage?.evidenceAnalysis);

  const usageLines: string[] = [];
  if (totalUsageLine) usageLines.push(totalUsageLine);
  if (chatUsageLine) {
    usageLines.push(chatUsageLine);
  } else if (tokenUsage && (totalUsageLine || keywordUsageLine)) {
    usageLines.push("  · 主对话: 未返回（流式上游可能未提供 usage）");
  }
  if (keywordUsageLine) usageLines.push(keywordUsageLine);
  if (evidenceUsageLine) usageLines.push(evidenceUsageLine);

  if (usageLines.length > 0) {
    lines.push(``, `<b>🧮 Token 用量:</b>`, ...usageLines);
  }

  if (finishReason || rawFinishReason) {
    lines.push(
      ``,
      `<b>🏁 结束原因:</b>`,
      `  · 标准: ${escapeHtml(finishReason ?? "-")}`,
      `  · 原始: ${escapeHtml(rawFinishReason ?? "-")}`,
    );
  }

  const timingLines: string[] = [];
  if (hasTokenValue(timings?.totalMs)) {
    timingLines.push(`  · 总耗时: ${formatTimingValue(timings?.totalMs)}`);
  }
  if (hasTokenValue(timings?.keywordExtractionMs)) {
    timingLines.push(`  · 关键词提取: ${formatTimingValue(timings?.keywordExtractionMs)}`);
  }
  if (hasTokenValue(timings?.evidenceAnalysisMs)) {
    timingLines.push(`  · 证据分析: ${formatTimingValue(timings?.evidenceAnalysisMs)}`);
  }
  if (hasTokenValue(timings?.searchMs)) {
    const searchLabel = timings?.reusedSearchContext ? "检索复用命中" : "检索执行";
    timingLines.push(`  · ${searchLabel}: ${formatTimingValue(timings?.searchMs)}`);
  }
  if (hasTokenValue(timings?.promptBuildMs)) {
    timingLines.push(`  · Prompt 构建: ${formatTimingValue(timings?.promptBuildMs)}`);
  }
  if (timingLines.length > 0) {
    lines.push(``, `<b>⏱️ 阶段耗时:</b>`, ...timingLines);
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━`);

  let text = lines.join("\n");
  if (text.length > MAX_MESSAGE_LENGTH) {
    text = text.slice(0, MAX_MESSAGE_LENGTH) + "\n…";
  }

  await sendTelegramMessage(text);
}
