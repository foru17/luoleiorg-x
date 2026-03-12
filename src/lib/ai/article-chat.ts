import type { UIMessage } from "ai";
import type { CurrentArticleContext } from "../chat-prompts/types.ts";
import { normalizeSearchText } from "./chat-utils.ts";
import { extractSearchTokens, getMessageText } from "./search-query.ts";

const ARTICLE_EXTENSION_PATTERNS =
  /相关文章|类似文章|延伸阅读|继续深入|一起看|相关主题|类似经验|更多文章|延伸看|继续看/u;
const ARTICLE_FOCUS_PATTERNS =
  /这篇|本文|文中|文章里|这篇文章|这里|这段|这个方案|这种做法|这套方案|这个思路|为什么这么做|怎么做|如何做|什么意思|展开讲|细讲|详细讲|总结|重点|核心|适合什么场景|背后的原因|为什么|原因是什么|具体是怎么|文里提到/u;
const GLOBAL_SHIFT_PATTERNS =
  /最近在做|最近写|最近发|最新|最近的|别的文章|其他文章|其它文章|除了这篇|项目|GitHub|github|X 动态|x 动态|推文|tweet|博客里还有|全站/u;
const ARTICLE_FOLLOW_UP_PATTERNS =
  /^(那|那你|然后|后来|这里|那边|这边|具体呢|然后呢|为什么|住哪里|住哪|都住|路线呢|行程呢|后来呢|接着呢|再后来呢)/u;
const ARTICLE_TOPIC_SIGNAL_PATTERNS =
  /住哪里|住哪|住宿|酒店|hotel|airbnb|民宿|别墅|旅店|入住|去了哪些地方|去哪些地方|去了哪里|路线|行程|路书|途经|经过|目的地|景点|费用|花了多少钱|预算|票价|装备|器材|相机|镜头|拍摄|机票|租车|住了几晚/u;
const GENERIC_SHORT_FOLLOW_UP_PATTERNS =
  /^(那|那你|然后|后来|这里|那边|这边|具体呢|然后呢|后来呢|接着呢|再后来呢|为什么|为啥|怎么说|展开讲讲|详细说说|还有呢|那呢)$/u;

export type ArticleIntentMode =
  | "article_understanding"
  | "article_detail"
  | "article_extension"
  | "global_shift";

export interface ArticleIntentDecision {
  mode: ArticleIntentMode;
  shouldSearchSiteWide: boolean;
  queryHint: string;
}

function cleanTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.map((token) => token.trim()).filter(Boolean)));
}

function buildArticleTokenSet(article: CurrentArticleContext): Set<string> {
  const tokens = [
    ...extractSearchTokens(article.title, 12),
    ...(article.categories ?? []).flatMap((category) => extractSearchTokens(category, 4)),
    ...(article.keyPoints ?? []).flatMap((point) => extractSearchTokens(point, 4)),
    ...(article.fullContent ? extractSearchTokens(article.fullContent, 80) : []),
  ];
  return new Set(cleanTokens(tokens));
}

export function buildArticleScopedSearchQuery(article: CurrentArticleContext): string {
  const tokens = cleanTokens([
    ...extractSearchTokens(article.title, 6),
    ...(article.keyPoints ?? []).slice(0, 3).flatMap((point) => extractSearchTokens(point, 3)),
  ]);
  return tokens.join(" ");
}

export function buildArticleConversationQuery(messages: UIMessage[]): string {
  const userTexts = messages
    .filter((message) => message.role === "user")
    .map(getMessageText)
    .map((text) => text.trim())
    .filter(Boolean);

  const latest = userTexts[userTexts.length - 1] ?? "";
  if (!latest || userTexts.length <= 1) return latest;

  const latestTokens = extractSearchTokens(latest, 8, { includeJoinedCjk: true });
  const shouldExpand =
    latest.length <= 18 ||
    latestTokens.length <= 2 ||
    ARTICLE_FOLLOW_UP_PATTERNS.test(latest);

  if (!shouldExpand) return latest;

  return userTexts.slice(-3).join(" ");
}

export function buildArticleEvidenceQuery(messages: UIMessage[]): string {
  const userTexts = messages
    .filter((message) => message.role === "user")
    .map(getMessageText)
    .map((text) => text.trim())
    .filter(Boolean);

  const latest = userTexts[userTexts.length - 1] ?? "";
  if (!latest || userTexts.length <= 1) return latest;

  const latestTokens = extractSearchTokens(latest, 8, { includeJoinedCjk: true });
  const hasTopicSignal = ARTICLE_TOPIC_SIGNAL_PATTERNS.test(latest);
  const isGenericShortFollowUp =
    GENERIC_SHORT_FOLLOW_UP_PATTERNS.test(latest) ||
    (latest.length <= 8 && latestTokens.length <= 2 && !hasTopicSignal);

  if (hasTopicSignal || !isGenericShortFollowUp) {
    return latest;
  }

  return userTexts.slice(-3).join(" ");
}

export function decideArticleIntent(
  userQuery: string,
  article: CurrentArticleContext,
): ArticleIntentDecision {
  const query = userQuery.trim();
  const queryHint = buildArticleScopedSearchQuery(article) || article.title;

  if (!query) {
    return {
      mode: "article_understanding",
      shouldSearchSiteWide: false,
      queryHint,
    };
  }

  if (ARTICLE_EXTENSION_PATTERNS.test(query)) {
    return {
      mode: "article_extension",
      shouldSearchSiteWide: false,
      queryHint,
    };
  }

  if (ARTICLE_FOCUS_PATTERNS.test(query)) {
    return {
      mode: "article_detail",
      shouldSearchSiteWide: false,
      queryHint,
    };
  }

  if (GLOBAL_SHIFT_PATTERNS.test(query)) {
    return {
      mode: "global_shift",
      shouldSearchSiteWide: true,
      queryHint,
    };
  }

  const queryTokens = extractSearchTokens(query, 10, { includeJoinedCjk: false });
  const articleTokens = buildArticleTokenSet(article);
  const overlapCount = queryTokens.filter((token) => articleTokens.has(token)).length;
  const overlapRatio =
    queryTokens.length > 0 ? overlapCount / queryTokens.length : 0;
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(article.title);
  const normalizedFullContent = normalizeSearchText(article.fullContent ?? "");
  const contentOverlapCount = queryTokens.filter((token) =>
    normalizedFullContent.includes(token),
  ).length;
  const contentOverlapRatio =
    queryTokens.length > 0 ? contentOverlapCount / queryTokens.length : 0;

  if (
    normalizedTitle &&
    normalizedQuery &&
    normalizedQuery.includes(normalizedTitle)
  ) {
    return {
      mode: "article_understanding",
      shouldSearchSiteWide: false,
      queryHint,
    };
  }

  if (
    normalizedQuery &&
    normalizedFullContent &&
    normalizedFullContent.includes(normalizedQuery)
  ) {
    return {
      mode: "article_detail",
      shouldSearchSiteWide: false,
      queryHint,
    };
  }

  if (queryTokens.length === 0 && query.length <= 18) {
    return {
      mode: "article_detail",
      shouldSearchSiteWide: false,
      queryHint,
    };
  }

  if (overlapRatio >= 0.45 || (queryTokens.length <= 3 && overlapCount >= 1)) {
    return {
      mode: "article_detail",
      shouldSearchSiteWide: false,
      queryHint,
    };
  }

  if (contentOverlapRatio >= 0.45 || (queryTokens.length <= 4 && contentOverlapCount >= 1)) {
    return {
      mode: "article_detail",
      shouldSearchSiteWide: false,
      queryHint,
    };
  }

  return {
    mode: "global_shift",
    shouldSearchSiteWide: true,
    queryHint,
  };
}
