import { generateText, type UIMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { isLikelyFollowUp } from "@/lib/ai/chat-search";
import {
  extractJsonPayload,
  parseBooleanEnv,
  summarizeError,
  toStringList,
  toTokenUsageStats,
} from "@/lib/ai/chat-utils";
import {
  buildSearchQuery,
  extractSearchTokens,
  getMessageText,
} from "@/lib/ai/search-query";
import type { TokenUsageStats } from "@/lib/telegram";

export type QueryComplexity = "simple" | "moderate" | "complex";

type ParseMode = "json" | "fallback_text" | "fallback_error";

export interface KeywordExtractionResult {
  query: string;
  primaryQuery: string;
  complexity: QueryComplexity;
  usage?: TokenUsageStats;
  rawText?: string;
  parseMode: ParseMode;
  usedFallback: boolean;
  error?: string;
}

export const KEYWORD_EXTRACTION_TIMEOUT_MS = 3500;
const KEYWORD_EXTRACTION_RECENT_MESSAGES = 4;
const KEYWORD_EXTRACTION_MAX_OUTPUT_TOKENS = 96;
const KEYWORD_EXTRACTION_MIN_TERMS = 3;
const ENABLE_FIRST_TURN_KEYWORD_EXTRACTION = parseBooleanEnv(
  process.env.ENABLE_FIRST_TURN_KEYWORD_EXTRACTION,
  true,
);
const SEMANTIC_FALLBACK_RULES: Array<{
  patterns: RegExp[];
  query: string;
  primaryQuery: string;
}> = [
  {
    patterns: [
      /去过.{0,6}(国家|城市|地方|哪里|哪些)/,
      /(国家|城市).{0,6}去过/,
      /去过哪里/,
      /都去过/,
    ],
    query: "旅行 游记 海外 出国 国家 城市 目的地",
    primaryQuery: "旅行",
  },
  {
    patterns: [
      /日本.{0,8}(几次|多少次|几回)/,
      /(几次|多少次).{0,8}日本/,
    ],
    query: "日本 旅行 游记 东京 京都 大阪",
    primaryQuery: "日本",
  },
  {
    patterns: [
      /马拉松.{0,8}(几次|几场|多少|跑过)/,
      /(几次|几场).{0,8}马拉松/,
      /跑过马拉松/,
      /跑过几场/,
    ],
    query: "马拉松 跑步 赛事 运动",
    primaryQuery: "马拉松",
  },
  {
    patterns: [
      /读过.{0,6}(几本|多少本|书)/,
      /(几本|书单).{0,6}读/,
      /读了几本/,
      /看过几本书/,
    ],
    query: "读书 书单 阅读",
    primaryQuery: "读书",
  },
];

const KEYWORD_EXTRACTION_PROMPT = `你是一个搜索关键词提取器。根据用户与博主的对话上下文，提取用于在博客文章库和 X 动态库中搜索的关键词。

输出要求（必须严格遵守）：
- 只输出 JSON，不要 Markdown，不要解释
- JSON 结构：
  {
    “primaryTerms”: [“...”],
    “relatedTerms”: [“...”],
    “query”: “term1 term2 term3”,
    “complexity”: “simple”
  }
- primaryTerms：1-3 个最核心的主题实体词
- relatedTerms：0-6 个扩展词（同义词/上下位词/地名/技术栈）
- query：合并后的搜索词串（空格分隔）
- complexity：问题复杂度
  * “simple” - 简单事实（技术栈、个人介绍、单一事件）
  * “moderate” - 需推理（最近在做什么、某项目背景）
  * “complex” - 需聚合/统计/时间线（去过几次、读过几本、都有哪些）

规则：
- primaryTerms 必须精简，只保留最核心的实体词
- 关键词优先使用主题实体词/领域词，避免功能词、语气词、问句词
- 旅行经历盘点优先输出：目的地、旅行、游记、城市、国家、海外
- 禁止输出：写过、去过、跑过、多少、几次、几篇、是不是、有没有
- 结合上下文理解指代
- 严禁输出无关字段`;

export function buildModelKeywordSearchQuery(value: string): string {
  return extractSearchTokens(value, 12, { includeJoinedCjk: false }).join(" ");
}

export function normalizeComplexity(value: unknown): QueryComplexity {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (
      normalized === "simple" ||
      normalized === "moderate" ||
      normalized === "complex"
    ) {
      return normalized;
    }
  }
  return "moderate";
}

export function buildKeywordQueryFromModelOutput(
  text: string,
): {
  query: string;
  primaryQuery: string;
  complexity: QueryComplexity;
  parseMode: "json" | "fallback_text";
} {
  const payload = extractJsonPayload(text);
  if (payload) {
    const primaryTerms = toStringList(payload.primaryTerms);
    const relatedTerms = toStringList(payload.relatedTerms);
    const allTerms = [...primaryTerms, ...relatedTerms];
    if (typeof payload.query === "string") {
      allTerms.push(payload.query);
    }
    const query = buildModelKeywordSearchQuery(allTerms.join(" "));
    const primaryQuery = buildModelKeywordSearchQuery(primaryTerms.join(" "));
    const complexity = normalizeComplexity(payload.complexity);
    if (query) {
      return {
        query,
        primaryQuery: primaryQuery || query,
        complexity,
        parseMode: "json",
      };
    }
  }

  const fallback = buildSearchQuery(text.trim().replace(/[，,、;；。.]/g, " "));
  return {
    query: fallback,
    primaryQuery: fallback,
    complexity: "moderate",
    parseMode: "fallback_text",
  };
}

export function shouldRunKeywordExtractionModel(
  messages: Array<Omit<UIMessage, "id">>,
  localQuery: string,
  latestText: string,
): boolean {
  const userTurnCount = messages.reduce(
    (count, message) => (message.role === "user" ? count + 1 : count),
    0,
  );
  if (userTurnCount <= 1) return ENABLE_FIRST_TURN_KEYWORD_EXTRACTION;

  const localTermCount = localQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean).length;

  if (localTermCount < KEYWORD_EXTRACTION_MIN_TERMS) return true;
  return isLikelyFollowUp(latestText);
}

export async function extractSearchKeywords(
  messages: Array<Omit<UIMessage, "id">>,
  provider: ReturnType<typeof createOpenAICompatible>,
  model: string,
  abortSignal?: AbortSignal,
): Promise<KeywordExtractionResult> {
  const recentMessages = messages.slice(-KEYWORD_EXTRACTION_RECENT_MESSAGES);
  const conversation = recentMessages
    .map((message) => {
      const text = getMessageText(message);
      return text ? `${message.role === "user" ? "读者" : "博主"}：${text}` : "";
    })
    .filter(Boolean)
    .join("\n");

  try {
    const { text, totalUsage } = await generateText({
      model: provider.chatModel(model),
      system: KEYWORD_EXTRACTION_PROMPT,
      prompt: conversation,
      temperature: 0,
      maxOutputTokens: KEYWORD_EXTRACTION_MAX_OUTPUT_TOKENS,
      abortSignal,
    });
    const parsed = buildKeywordQueryFromModelOutput(text);
    return {
      ...parsed,
      usage: toTokenUsageStats(totalUsage),
      rawText: text,
      usedFallback: parsed.parseMode !== "json",
    };
  } catch (error) {
    const latest = getMessageText(recentMessages[recentMessages.length - 1]);
    const semanticFallback = SEMANTIC_FALLBACK_RULES.find((rule) =>
      rule.patterns.some((pattern) => pattern.test(latest)),
    );
    const fallbackQuery = semanticFallback?.query ?? buildSearchQuery(latest);
    const fallbackPrimaryQuery = semanticFallback?.primaryQuery ?? fallbackQuery;
    return {
      query: fallbackQuery,
      primaryQuery: fallbackPrimaryQuery,
      complexity: "moderate",
      parseMode: "fallback_error",
      usedFallback: true,
      error: summarizeError(error),
    };
  }
}
