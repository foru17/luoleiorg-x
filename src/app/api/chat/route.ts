import {
  streamText,
  generateText,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type LanguageModelUsage,
  type FinishReason,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  createSearchIndex,
  searchDocuments,
  type SearchDocument,
  type SearchIndexedDocument,
} from "@luoleiorg/search-core";
import { getSearchDocuments } from "@/lib/content/posts";
import { getTweetSearchDocuments } from "@/lib/content/tweets";
import { getAISummary } from "@/lib/content/ai-data";
import {
  buildSystemPrompt,
  type ArticleContext,
  type TweetContext,
} from "@/lib/ai/chat-prompt";
import {
  buildLocalSearchQuery,
  buildSearchQuery,
  getMessageText,
  hasNewSignificantTokens,
  hasSearchQueryOverlap,
} from "@/lib/ai/search-query";
import { siteConfig } from "@/lib/site-config";
import { getClientIP, checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import {
  sendChatNotification,
  type RequestTimingStats,
  type TokenUsageStats,
} from "@/lib/telegram";
import { createChatStatusData } from "@/lib/ai/chat-status";

export const dynamic = "force-dynamic";

const MAX_HISTORY_MESSAGES = 20;
const MAX_INPUT_LENGTH = 500;
const ARTICLE_SEARCH_LIMIT = parsePositiveIntEnv(process.env.ARTICLE_SEARCH_LIMIT, 12);
const ARTICLE_SEARCH_LIMIT_BROAD = parsePositiveIntEnv(process.env.ARTICLE_SEARCH_LIMIT_BROAD, 24);
const TWEET_SEARCH_LIMIT = parsePositiveIntEnv(process.env.TWEET_SEARCH_LIMIT, 8);
const TWEET_SEARCH_LIMIT_BROAD = parsePositiveIntEnv(process.env.TWEET_SEARCH_LIMIT_BROAD, 18);
const SEARCH_TERM_BROAD_QUERY_MAX = parsePositiveIntEnv(process.env.SEARCH_TERM_BROAD_QUERY_MAX, 2);
const SEARCH_RELATIVE_SCORE_THRESHOLD = parsePositiveFloatEnv(
  process.env.SEARCH_RELATIVE_SCORE_THRESHOLD,
  0.35,
);
const SEARCH_MIN_ABSOLUTE_SCORE = parsePositiveFloatEnv(
  process.env.SEARCH_MIN_ABSOLUTE_SCORE,
  2,
);
const ENABLE_FIRST_TURN_KEYWORD_EXTRACTION = parseBooleanEnv(
  process.env.ENABLE_FIRST_TURN_KEYWORD_EXTRACTION,
  true,
);
const SEARCH_ANCHOR_TERM_MAX = parsePositiveIntEnv(process.env.SEARCH_ANCHOR_TERM_MAX, 2);
const SEARCH_MIN_ANCHOR_TERM_LENGTH = parsePositiveIntEnv(
  process.env.SEARCH_MIN_ANCHOR_TERM_LENGTH,
  2,
);
const KEYWORD_EXTRACTION_TIMEOUT_MS = 3500;
const KEYWORD_EXTRACTION_RECENT_MESSAGES = 4;
const KEYWORD_EXTRACTION_MAX_OUTPUT_TOKENS = 96;
const KEYWORD_EXTRACTION_MIN_TERMS = 3;
const REUSE_INTENT_CHECK_TIMEOUT_MS = 1500;
const REUSE_INTENT_CHECK_MAX_OUTPUT_TOKENS = 8;
const RESPONSE_REPAIR_TIMEOUT_MS = 2500;
const RESPONSE_REPAIR_MAX_OUTPUT_TOKENS = 80;
const SEARCH_CONTEXT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_SEARCH_CONTEXT_CACHE_SIZE = 400;
const MAX_FOLLOW_UP_LENGTH = 48;
const DEEP_ARTICLE_SCORE_THRESHOLD = Number(process.env.DEEP_ARTICLE_SCORE_THRESHOLD ?? 8);
const DEEP_ARTICLE_FULL_CONTENT_MAX_LENGTH = 1500;

let cachedPostDocs: SearchDocument[] | null = null;
let cachedPostIndex: SearchIndexedDocument[] | null = null;
let cachedTweetDocs: SearchDocument[] | null = null;
let cachedTweetIndex: SearchIndexedDocument[] | null = null;

interface CachedSearchContext {
  query: string;
  articles: ArticleContext[];
  tweets: TweetContext[];
  updatedAt: number;
}

const searchContextCache = new Map<string, CachedSearchContext>();

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloatEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function hasUsageNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toTokenUsageStats(
  usage: LanguageModelUsage | undefined,
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

function mergeTokenUsage(
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

function getSessionCacheKey(req: Request, ip: string): string {
  const userAgent = req.headers.get("user-agent") ?? "";
  return `${ip}|${userAgent.slice(0, 120)}`;
}

function isLikelyFollowUp(message: string): boolean {
  const normalized = message.trim();
  if (!normalized || normalized.length > MAX_FOLLOW_UP_LENGTH) return false;

  const hasTerminalPunctuation = /[?？!！。.]$/.test(normalized);
  const wordLikeCount = normalized
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean).length;

  if (normalized.length <= 16) return true;
  if (!/\s/.test(normalized) && normalized.length <= 24) return true;
  return hasTerminalPunctuation && wordLikeCount <= 6 && normalized.length <= 32;
}

function cleanupSearchContextCache(now: number): void {
  for (const [key, value] of searchContextCache) {
    if (now - value.updatedAt > SEARCH_CONTEXT_CACHE_TTL_MS) {
      searchContextCache.delete(key);
    }
  }

  if (searchContextCache.size <= MAX_SEARCH_CONTEXT_CACHE_SIZE) return;

  const overflowCount = searchContextCache.size - MAX_SEARCH_CONTEXT_CACHE_SIZE;
  const keys = searchContextCache.keys();
  for (let i = 0; i < overflowCount; i += 1) {
    const next = keys.next();
    if (next.done) break;
    searchContextCache.delete(next.value);
  }
}

function durationMs(start: number, end = performance.now()): number {
  return Math.max(0, Math.round(end - start));
}

function shouldRunKeywordExtractionModel(
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

function loadSearchData() {
  if (cachedPostDocs && cachedPostIndex && cachedTweetDocs && cachedTweetIndex) {
    return {
      postIndex: cachedPostIndex,
      tweetIndex: cachedTweetIndex,
    };
  }

  const postDocs = getSearchDocuments();
  const tweetDocs = getTweetSearchDocuments();
  const postIndex = createSearchIndex(postDocs);
  const tweetIndex = createSearchIndex(tweetDocs);

  cachedPostDocs = postDocs;
  cachedPostIndex = postIndex;
  cachedTweetDocs = tweetDocs;
  cachedTweetIndex = tweetIndex;

  return { postIndex, tweetIndex };
}

function resolveSearchLimit(query: string, narrowLimit: number, broadLimit: number): number {
  const terms = getNormalizedQueryTerms(query);
  if (terms.length <= SEARCH_TERM_BROAD_QUERY_MAX) {
    return broadLimit;
  }
  return narrowLimit;
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function dedupeTermsByContainment(terms: string[]): string[] {
  const unique = Array.from(new Set(terms));
  const kept: string[] = [];
  for (const term of unique.sort((a, b) => b.length - a.length)) {
    if (kept.some((existing) => existing.includes(term))) continue;
    kept.push(term);
  }
  return kept;
}

function getNormalizedQueryTerms(query: string): string[] {
  const rawTerms = query
    .split(/\s+/)
    .map((term) => normalizeSearchText(term))
    .filter(Boolean);
  return dedupeTermsByContainment(rawTerms);
}

function pickAnchorTerms<T>(params: {
  query: string;
  candidates: T[];
  matchesTerm: (candidate: T, term: string) => boolean;
}): string[] {
  const { query, candidates, matchesTerm } = params;
  const terms = getNormalizedQueryTerms(query).filter(
    (term) => term.length >= SEARCH_MIN_ANCHOR_TERM_LENGTH,
  );
  if (terms.length <= SEARCH_ANCHOR_TERM_MAX) {
    return terms.slice(0, SEARCH_ANCHOR_TERM_MAX);
  }
  if (candidates.length === 0) {
    return terms.slice(0, SEARCH_ANCHOR_TERM_MAX);
  }

  const scored = terms.map((term) => {
    let hitCount = 0;
    for (const candidate of candidates) {
      if (matchesTerm(candidate, term)) {
        hitCount += 1;
      }
    }

    if (hitCount <= 0) {
      return { term, hitCount, score: Number.NEGATIVE_INFINITY };
    }

    const coverage = hitCount / candidates.length;
    const specificity = 1 - coverage;
    const lengthScore = Math.min(term.length, 8) / 8;

    return {
      term,
      hitCount,
      score: specificity * 2 + lengthScore,
    };
  });

  const ranked = scored
    .filter((item) => Number.isFinite(item.score))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.hitCount - b.hitCount ||
        b.term.length - a.term.length,
    )
    .map((item) => item.term);

  if (ranked.length > 0) {
    return ranked.slice(0, SEARCH_ANCHOR_TERM_MAX);
  }
  return terms.slice(0, SEARCH_ANCHOR_TERM_MAX);
}

function mergeSearchResults<T extends { url: string }>(primary: T[], secondary: T[]): T[] {
  const seen = new Set(primary.map((item) => item.url));
  const merged = [...primary];
  for (const item of secondary) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      merged.push(item);
    }
  }
  return merged;
}

function filterLowRelevanceResults<T extends { score: number }>(results: T[]): T[] {
  if (results.length <= 3) return results;

  const topScore = results[0]?.score ?? 0;
  if (topScore <= 0) return results;

  const threshold = Math.max(
    SEARCH_MIN_ABSOLUTE_SCORE,
    topScore * SEARCH_RELATIVE_SCORE_THRESHOLD,
  );

  return results.filter((item, index) => index < 3 || item.score >= threshold);
}

function searchRelatedArticles(query: string, enableDeepContent = false): ArticleContext[] {
  if (!query.trim()) return [];
  const { postIndex } = loadSearchData();
  const limit = resolveSearchLimit(query, ARTICLE_SEARCH_LIMIT, ARTICLE_SEARCH_LIMIT_BROAD);
  const rawResults = searchDocuments(postIndex, query, Math.max(limit, 3) * 2);
  const queryTerms = getNormalizedQueryTerms(query);
  const shouldApplyAnchorFilter =
    queryTerms.length > 0 && queryTerms.length <= SEARCH_TERM_BROAD_QUERY_MAX;
  const anchorTerms = shouldApplyAnchorFilter
    ? pickAnchorTerms({
        query,
        candidates: rawResults,
        matchesTerm: (item, term) => {
          if (normalizeSearchText(item.title).includes(term)) return true;
          if (item.categories.some((category) => normalizeSearchText(category).includes(term))) {
            return true;
          }
          return (item.keyPoints ?? []).some((point) => normalizeSearchText(point).includes(term));
        },
      })
    : [];
  const strictMatches = shouldApplyAnchorFilter && anchorTerms.length > 0
    ? rawResults.filter((item) => {
        return anchorTerms.some((term) => {
          if (normalizeSearchText(item.title).includes(term)) return true;
          if (item.categories.some((category) => normalizeSearchText(category).includes(term))) {
            return true;
          }
          return (item.keyPoints ?? []).some((point) => normalizeSearchText(point).includes(term));
        });
      })
    : rawResults;
  const candidates = strictMatches.length > 0 ? strictMatches : rawResults;
  const results = filterLowRelevanceResults(candidates).slice(0, limit);

  const topScore = results[0]?.score ?? 0;
  const secondScore = results[1]?.score ?? 0;
  const isDeepHit =
    enableDeepContent &&
    topScore >= DEEP_ARTICLE_SCORE_THRESHOLD &&
    topScore > secondScore * 1.5;

  return results.map((r, index) => {
    const fullContent =
      isDeepHit && index === 0 && r.content
        ? r.content.slice(0, DEEP_ARTICLE_FULL_CONTENT_MAX_LENGTH)
        : undefined;
    return {
      title: r.title,
      url: r.url.startsWith("http")
        ? r.url
        : `${siteConfig.siteUrl}${r.url}`,
      summary: getAISummary(r.id)?.summary ?? r.excerpt,
      keyPoints: getAISummary(r.id)?.keyPoints ?? [],
      categories: r.categories,
      dateTime: r.dateTime,
      fullContent,
    };
  });
}

function formatTweetDate(dateTime: number): string {
  if (!Number.isFinite(dateTime) || dateTime <= 0) return "未知日期";
  return new Date(dateTime).toISOString().slice(0, 10);
}

function searchRelatedTweets(query: string): TweetContext[] {
  if (!query.trim()) return [];
  const { tweetIndex } = loadSearchData();
  const limit = resolveSearchLimit(query, TWEET_SEARCH_LIMIT, TWEET_SEARCH_LIMIT_BROAD);
  const rawResults = searchDocuments(tweetIndex, query, Math.max(limit, 3) * 2);
  const queryTerms = getNormalizedQueryTerms(query);
  const shouldApplyAnchorFilter =
    queryTerms.length > 0 && queryTerms.length <= SEARCH_TERM_BROAD_QUERY_MAX;
  const anchorTerms = shouldApplyAnchorFilter
    ? pickAnchorTerms({
        query,
        candidates: rawResults,
        matchesTerm: (item, term) => {
          if (normalizeSearchText(item.title).includes(term)) return true;
          return normalizeSearchText(item.excerpt || item.content).includes(term);
        },
      })
    : [];
  const strictMatches = shouldApplyAnchorFilter && anchorTerms.length > 0
    ? rawResults.filter((item) => {
        return anchorTerms.some((term) => {
          if (normalizeSearchText(item.title).includes(term)) return true;
          return normalizeSearchText(item.excerpt || item.content).includes(term);
        });
      })
    : rawResults;
  const candidates = strictMatches.length > 0 ? strictMatches : rawResults;
  const results = filterLowRelevanceResults(candidates).slice(0, limit);

  return results.map((r) => ({
    title: r.title,
    url: r.url,
    text: r.excerpt || r.content.slice(0, 220),
    date: formatTweetDate(r.dateTime),
    dateTime: r.dateTime,
  }));
}

function getPreviousUserMessageText(messages: Array<Omit<UIMessage, "id">>): string {
  let foundLatest = false;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const text = getMessageText(message).trim();
    if (!text) continue;
    if (!foundLatest) {
      foundLatest = true;
      continue;
    }
    return text;
  }
  return "";
}

function endsWithCompleteSentence(text: string): boolean {
  return /[。！？!?）】》」”"'`]\s*$/u.test(text.trim());
}

function hasDanglingTail(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/[，,、:：;；\-—]\s*$/u.test(normalized)) return true;
  return /(关于|比如|以及|还有|另外|并且|或者|尤其|包括|例如|像|和|但|不过|因为|所以|如果|对于)\s*$/u.test(
    normalized,
  );
}

function hasUnbalancedMarkdown(text: string): boolean {
  const leftSquare = (text.match(/\[/g) ?? []).length;
  const rightSquare = (text.match(/\]/g) ?? []).length;
  const leftParen = (text.match(/\(/g) ?? []).length;
  const rightParen = (text.match(/\)/g) ?? []).length;
  return leftSquare !== rightSquare || leftParen !== rightParen;
}

function shouldRepairResponseTail(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || normalized.length < 12) return false;
  if (endsWithCompleteSentence(normalized)) return false;
  if (hasDanglingTail(normalized)) return true;
  if (hasUnbalancedMarkdown(normalized)) return true;
  return false;
}

function normalizeRepairedTail(rawText: string): string {
  const trimmed = rawText
    .trim()
    .replace(/^["“”'`]+|["“”'`]+$/g, "")
    .replace(/^(补全|续写|继续|答案)[:：]\s*/u, "")
    .trim();
  if (!trimmed) return "";
  if (
    /^(无需补全|不需要补全|无需续写|原文已完整|原回答已完整|无)$/u.test(trimmed)
  ) {
    return "";
  }

  const compact = trimmed.length > 120 ? trimmed.slice(0, 120).trim() : trimmed;
  if (!compact) return "";
  if (endsWithCompleteSentence(compact)) return compact;
  return `${compact}。`;
}

const KEYWORD_EXTRACTION_PROMPT = `你是一个搜索关键词提取器。根据用户与博主的对话上下文，提取用于在博客文章库和 X 动态库中搜索的关键词。

输出要求（必须严格遵守）：
- 只输出 JSON，不要 Markdown，不要解释，不要多余文本
- JSON 结构：
  {
    “primaryTerms”: [“...”],
    “relatedTerms”: [“...”],
    “query”: “term1 term2 term3”
  }
- primaryTerms：1-3 个最核心的主题实体词（精简，用于宽泛召回）
- relatedTerms：0-6 个扩展词（同义词/上下位词/地名/技术栈，用于精确匹配）
- query：把 primaryTerms 和 relatedTerms 合并后的搜索词串（空格分隔）

规则：
- primaryTerms 必须精简（1-3 个），只保留最核心的实体词，让宽泛搜索能召回更多结果
- 总关键词数控制在 5-10 个
- 关键词应涵盖：核心话题、相关地名/人名、同义词、上下位词
- 关键词优先使用”主题实体词/领域词”，避免输出功能词、语气词、问句词和数量词
- 禁止输出这类词：写过、去过、跑过、多少、几次、几篇、是不是、有没有、推荐几篇
- 例如用户问”去过哪些国家”→ primaryTerms: [“旅行”] relatedTerms: [“游记”, “出国”, “自驾”, “签证”]
- 例如用户问”日本相关文章”→ primaryTerms: [“日本”] relatedTerms: [“东京”, “京都”, “大阪”, “旅行”, “游记”]
- 例如用户问”你跑过马拉松吗”→ primaryTerms: [“马拉松”] relatedTerms: [“跑步”, “跑马”, “运动”, “赛事”]
- 结合上下文理解指代（如”推荐几篇”指的是之前聊的话题）
- 严禁输出无关字段`;

function extractJsonPayload(text: string): Record<string, unknown> | null {
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

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function buildKeywordQueryFromModelOutput(text: string): {
  query: string;
  primaryQuery: string;
} {
  const payload = extractJsonPayload(text);
  if (payload) {
    const primaryTerms = toStringList(payload.primaryTerms);
    const relatedTerms = toStringList(payload.relatedTerms);
    const allTerms = [...primaryTerms, ...relatedTerms];
    if (typeof payload.query === "string") {
      allTerms.push(payload.query);
    }
    const query = buildSearchQuery(allTerms.join(" "));
    const primaryQuery = buildSearchQuery(primaryTerms.join(" "));
    if (query) return { query, primaryQuery: primaryQuery || query };
  }

  const fallback = buildSearchQuery(text.trim().replace(/[，,、;；。.]/g, " "));
  return { query: fallback, primaryQuery: fallback };
}

const REUSE_INTENT_CHECK_PROMPT = `你是检索上下文复用判定器。请判断“最新用户问题”是否和“上一条用户问题”属于同一检索意图。

只允许输出一个单词：
- SAME：同一检索意图的追问/澄清/延展，可复用上次检索上下文
- SHIFT：检索意图已切换，需要重新检索

判定要点：
- 即使实体词相同（如同一城市/同一公司），只要关注点从“经历A”切到“经历B”，也判定为 SHIFT
- 是/否追问若仍围绕同一事实核验，可判定为 SAME
- 拿不准时输出 SHIFT`;

const RESPONSE_REPAIR_PROMPT = `你是中文回答补全助手。任务：判断一段回答末尾是否半句截断；若截断，只补上最后一句收尾。

规则：
- 只输出补全文本，不要解释
- 不要重复前文，不要改写前文
- 不要新增链接、列表或新话题
- 最多 1-2 句，控制在 60 字以内
- 若原文已完整，输出：无`;

async function extractSearchKeywords(
  messages: Array<Omit<UIMessage, "id">>,
  provider: ReturnType<typeof createOpenAICompatible>,
  model: string,
  abortSignal?: AbortSignal,
): Promise<{ query: string; primaryQuery: string; usage?: TokenUsageStats }> {
  const recentMessages = messages.slice(-KEYWORD_EXTRACTION_RECENT_MESSAGES);
  const conversation = recentMessages
    .map((m) => {
      const text = getMessageText(m);
      return text ? `${m.role === "user" ? "读者" : "博主"}：${text}` : "";
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
    return {
      ...buildKeywordQueryFromModelOutput(text),
      usage: toTokenUsageStats(totalUsage),
    };
  } catch {
    const latest = getMessageText(recentMessages[recentMessages.length - 1]);
    const fallback = buildSearchQuery(latest);
    return { query: fallback, primaryQuery: fallback };
  }
}

async function isSameSearchIntent(
  previousUserMessage: string,
  latestUserMessage: string,
  provider: ReturnType<typeof createOpenAICompatible>,
  model: string,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  try {
    const { text } = await generateText({
      model: provider.chatModel(model),
      system: REUSE_INTENT_CHECK_PROMPT,
      prompt: `上一条用户问题：${previousUserMessage}\n最新用户问题：${latestUserMessage}`,
      temperature: 0,
      maxOutputTokens: REUSE_INTENT_CHECK_MAX_OUTPUT_TOKENS,
      abortSignal,
    });

    const normalized = text.trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (normalized.startsWith("SAME")) return true;
    if (normalized.startsWith("SHIFT")) return false;
    return false;
  } catch {
    return false;
  }
}

async function repairIncompleteResponseTail(
  partialResponse: string,
  latestQuestion: string,
  provider: ReturnType<typeof createOpenAICompatible>,
  model: string,
): Promise<{ text: string; usage?: TokenUsageStats }> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), RESPONSE_REPAIR_TIMEOUT_MS);

  try {
    const { text, totalUsage } = await generateText({
      model: provider.chatModel(model),
      system: RESPONSE_REPAIR_PROMPT,
      prompt: `用户问题：${latestQuestion}\n\n已生成回答：${partialResponse}`,
      temperature: 0,
      maxOutputTokens: RESPONSE_REPAIR_MAX_OUTPUT_TOKENS,
      abortSignal: abortController.signal,
    });

    return {
      text: normalizeRepairedTail(text),
      usage: toTokenUsageStats(totalUsage),
    };
  } catch {
    return { text: "" };
  } finally {
    clearTimeout(timeoutId);
  }
}

function classifyUpstreamError(detail: string, model: string): { reason: string; status: number } {
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

export async function POST(req: Request) {
  const requestStart = performance.now();
  const ip = getClientIP(req);
  const rateCheck = checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return rateLimitResponse(rateCheck);
  }

  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;

  if (!baseUrl || !apiKey || !model) {
    return Response.json(
      { error: "AI 服务未配置" },
      { status: 503 },
    );
  }
  const keywordModel = process.env.AI_KEYWORD_MODEL || model;

  let body: { messages?: UIMessage[] };
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "请求格式错误" },
      { status: 400 },
    );
  }

  const messages = (body.messages ?? []).slice(-MAX_HISTORY_MESSAGES);
  if (messages.length === 0) {
    return Response.json(
      { error: "消息不能为空" },
      { status: 400 },
    );
  }

  const latestText = getMessageText(messages[messages.length - 1]);
  if (latestText.length > MAX_INPUT_LENGTH) {
    return Response.json(
      { error: `消息过长，最多 ${MAX_INPUT_LENGTH} 字` },
      { status: 400 },
    );
  }

  const provider = createOpenAICompatible({
    name: "blog-chat",
    baseURL: baseUrl,
    apiKey,
    includeUsage: true,
  });

  const cacheKey = getSessionCacheKey(req, ip);
  const now = Date.now();
  cleanupSearchContextCache(now);
  const cachedContext = searchContextCache.get(cacheKey);
  const userTurnCount = messages.reduce(
    (count, message) => (message.role === "user" ? count + 1 : count),
    0,
  );
  const localSearchQuery = buildLocalSearchQuery(messages);
  const normalizedLatestQuery = localSearchQuery || buildSearchQuery(latestText);
  const currentQueryForReuseCheck = normalizedLatestQuery || latestText;
  const hasNewTopicTokens = cachedContext
    ? hasNewSignificantTokens(currentQueryForReuseCheck, cachedContext.query)
    : false;
  const shouldEvaluateReuseCandidate = Boolean(
    cachedContext &&
      userTurnCount > 1 &&
      now - cachedContext.updatedAt <= SEARCH_CONTEXT_CACHE_TTL_MS &&
      isLikelyFollowUp(latestText) &&
      hasSearchQueryOverlap(currentQueryForReuseCheck, cachedContext.query) &&
      !hasNewTopicTokens,
  );
  let shouldReuseSearchContext = false;
  if (shouldEvaluateReuseCandidate && cachedContext) {
    const previousUserText = getPreviousUserMessageText(messages);
    if (previousUserText) {
      const abortController = new AbortController();
      const timeoutId = setTimeout(
        () => abortController.abort(),
        REUSE_INTENT_CHECK_TIMEOUT_MS,
      );
      try {
        shouldReuseSearchContext = await isSameSearchIntent(
          previousUserText,
          latestText,
          provider,
          keywordModel,
          abortController.signal,
        );
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  let searchQuery = normalizedLatestQuery || latestText;
  let relatedArticles: ArticleContext[] = [];
  let relatedTweets: TweetContext[] = [];
  let keywordUsage: TokenUsageStats | undefined;
  let keywordExtractionMs: number | undefined;
  let searchMs = 0;

  if (shouldReuseSearchContext && cachedContext) {
    searchQuery = cachedContext.query;
    relatedArticles = cachedContext.articles;
    relatedTweets = cachedContext.tweets;
    searchContextCache.set(cacheKey, {
      ...cachedContext,
      updatedAt: now,
    });
  } else {
    const runKeywordExtraction = shouldRunKeywordExtractionModel(messages, localSearchQuery, latestText);

    // Phase 1: Run local search immediately, and AI keyword extraction in parallel
    const searchStart = performance.now();

    // Local search (near-instant)
    const localArticles = searchRelatedArticles(searchQuery, true);
    const localTweets = searchRelatedTweets(searchQuery);

    if (runKeywordExtraction) {
      const keywordStart = performance.now();
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), KEYWORD_EXTRACTION_TIMEOUT_MS);
      try {
        const keywordResult = await extractSearchKeywords(
          messages,
          provider,
          keywordModel,
          abortController.signal,
        );
        const normalizedKeywordQuery = buildSearchQuery(keywordResult.query || "");
        if (normalizedKeywordQuery && normalizedKeywordQuery !== searchQuery) {
          searchQuery = normalizedKeywordQuery;
          relatedArticles = searchRelatedArticles(searchQuery, true);
          relatedTweets = searchRelatedTweets(searchQuery);

          // Extra broad search using only primaryTerms to catch more relevant results
          // that may be filtered out when the full expanded query has too many terms
          const primaryQuery = buildSearchQuery(keywordResult.primaryQuery || "");
          if (primaryQuery && primaryQuery !== searchQuery) {
            const primaryArticles = searchRelatedArticles(primaryQuery, false);
            const primaryTweets = searchRelatedTweets(primaryQuery);
            relatedArticles = mergeSearchResults(relatedArticles, primaryArticles);
            relatedTweets = mergeSearchResults(relatedTweets, primaryTweets);
          }
        } else {
          relatedArticles = localArticles;
          relatedTweets = localTweets;
        }
        keywordUsage = keywordResult.usage;
      } catch {
        relatedArticles = localArticles;
        relatedTweets = localTweets;
      } finally {
        clearTimeout(timeoutId);
      }
      keywordExtractionMs = durationMs(keywordStart);
    } else {
      relatedArticles = localArticles;
      relatedTweets = localTweets;
    }

    const hasSearchHits = relatedArticles.length > 0 || relatedTweets.length > 0;
    const fallbackQuery = localSearchQuery || buildSearchQuery(latestText);
    if (!hasSearchHits && fallbackQuery && fallbackQuery !== searchQuery) {
      const fallbackArticles = searchRelatedArticles(fallbackQuery, true);
      const fallbackTweets = searchRelatedTweets(fallbackQuery);
      if (fallbackArticles.length > 0 || fallbackTweets.length > 0) {
        searchQuery = fallbackQuery;
        relatedArticles = fallbackArticles;
        relatedTweets = fallbackTweets;
      }
    }
    searchMs = durationMs(searchStart);

    searchContextCache.set(cacheKey, {
      query: searchQuery,
      articles: relatedArticles,
      tweets: relatedTweets,
      updatedAt: now,
    });
  }

  const promptBuildStart = performance.now();
  const systemPrompt = buildSystemPrompt(relatedArticles, relatedTweets, searchQuery || latestText);
  const promptBuildMs = durationMs(promptBuildStart);

  try {
    let baseResponseText = "";
    let chatCompletionUsage: TokenUsageStats | undefined;
    let repairedTailUsage: TokenUsageStats | undefined;
    let repairedTailMs: number | undefined;
    let streamFinishReason: FinishReason | undefined;
    let streamRawFinishReason: string | undefined;

    const stream = createUIMessageStream<UIMessage>({
      originalMessages: messages,
      execute: async ({ writer }) => {
        // Phase 2: Emit search context status so the frontend can show progress
        const articleCount = relatedArticles.length + relatedTweets.length;
        const statusMessage = articleCount > 0
          ? `找到 ${articleCount} 篇相关内容，正在生成回答...`
          : "正在生成回答...";
        writer.write({
          type: "message-metadata",
          messageMetadata: createChatStatusData({ stage: "answer", message: statusMessage, progress: 60 }),
        });

        const result = streamText({
          model: provider.chatModel(model),
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
          temperature: 0.3,
          maxOutputTokens: 2000,
          onFinish: ({ text, totalUsage, finishReason, rawFinishReason }) => {
            baseResponseText = text;
            chatCompletionUsage = toTokenUsageStats(totalUsage);
            streamFinishReason = finishReason;
            streamRawFinishReason = rawFinishReason;
          },
        });

        writer.merge(
          result.toUIMessageStream({
            sendFinish: false,
          }),
        );
        await result.consumeStream({ onError: writer.onError });

        if (shouldRepairResponseTail(baseResponseText)) {
          const repairStart = performance.now();
          const repairResult = await repairIncompleteResponseTail(
            baseResponseText,
            latestText,
            provider,
            model,
          );
          repairedTailMs = durationMs(repairStart);
          repairedTailUsage = repairResult.usage;

          if (repairResult.text) {
            const repairChunkId = `repair-${Date.now().toString(36)}`;
            writer.write({ type: "text-start", id: repairChunkId });
            writer.write({
              type: "text-delta",
              id: repairChunkId,
              delta: repairResult.text,
            });
            writer.write({ type: "text-end", id: repairChunkId });
            baseResponseText += repairResult.text;
          }
        }

        writer.write({
          type: "finish",
          finishReason: streamFinishReason,
        });
      },
      onFinish: async ({ responseMessage }) => {
        const finalResponseText = getMessageText(responseMessage) || baseResponseText;
        const chatAndRepairUsage = mergeTokenUsage(chatCompletionUsage, repairedTailUsage);
        const totalTokenUsage = mergeTokenUsage(keywordUsage, chatAndRepairUsage);
        const timings: RequestTimingStats = {
          totalMs: durationMs(requestStart),
          keywordExtractionMs,
          searchMs,
          promptBuildMs,
          responseRepairMs: repairedTailMs,
          reusedSearchContext: shouldReuseSearchContext,
        };

        await sendChatNotification({
          userIp: ip,
          userMessage: latestText,
          aiResponse: finalResponseText,
          articleTitles: [
            ...relatedArticles.map((a) => `文章 · ${a.title}`),
            ...relatedTweets.map((t) => `推文 · ${t.title}`),
          ],
          messageCount: messages.length,
          modelConfig: {
            apiBaseUrl: baseUrl,
            chatModel: model,
            keywordModel,
          },
          tokenUsage: {
            total: totalTokenUsage,
            chatCompletion: chatAndRepairUsage,
            keywordExtraction: keywordUsage,
          },
          timings,
          finishReason: streamFinishReason,
          rawFinishReason: streamRawFinishReason,
        });
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
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

    return Response.json(
      { error: reason, detail: detail.slice(0, 200) },
      { status: upstreamStatus >= 400 ? upstreamStatus : 502 },
    );
  }
}
