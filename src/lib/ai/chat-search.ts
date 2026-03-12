import {
  createSearchIndex,
  searchDocuments,
  type SearchDocument,
  type SearchIndexedDocument,
} from "@luoleiorg/search-core";
import { getAISummary } from "@/lib/content/ai-data";
import { getSearchDocuments } from "@/lib/content/posts";
import {
  getExperienceSearchDocuments,
  getProjectSearchDocuments,
} from "@/lib/content/projects";
import { getTweetSearchDocuments } from "@/lib/content/tweets";
import type {
  ArticleContext,
  ProjectContext,
  TweetContext,
} from "@/lib/ai/chat-prompt";
import {
  normalizeSearchText,
  parsePositiveFloatEnv,
  parsePositiveIntEnv,
} from "@/lib/ai/chat-utils";
import { siteConfig } from "@/lib/site-config";

const ARTICLE_SEARCH_LIMIT = parsePositiveIntEnv(process.env.ARTICLE_SEARCH_LIMIT, 12);
const ARTICLE_SEARCH_LIMIT_BROAD = parsePositiveIntEnv(
  process.env.ARTICLE_SEARCH_LIMIT_BROAD,
  24,
);
const TWEET_SEARCH_LIMIT = parsePositiveIntEnv(process.env.TWEET_SEARCH_LIMIT, 8);
const TWEET_SEARCH_LIMIT_BROAD = parsePositiveIntEnv(
  process.env.TWEET_SEARCH_LIMIT_BROAD,
  18,
);
const SEARCH_TERM_BROAD_QUERY_MAX = parsePositiveIntEnv(
  process.env.SEARCH_TERM_BROAD_QUERY_MAX,
  2,
);
const SEARCH_RELATIVE_SCORE_THRESHOLD = parsePositiveFloatEnv(
  process.env.SEARCH_RELATIVE_SCORE_THRESHOLD,
  0.35,
);
const SEARCH_MIN_ABSOLUTE_SCORE = parsePositiveFloatEnv(
  process.env.SEARCH_MIN_ABSOLUTE_SCORE,
  2,
);
const SEARCH_ANCHOR_TERM_MAX = parsePositiveIntEnv(
  process.env.SEARCH_ANCHOR_TERM_MAX,
  2,
);
const SEARCH_MIN_ANCHOR_TERM_LENGTH = parsePositiveIntEnv(
  process.env.SEARCH_MIN_ANCHOR_TERM_LENGTH,
  2,
);
export const SEARCH_CONTEXT_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_SEARCH_CONTEXT_CACHE_SIZE = 400;
const MAX_FOLLOW_UP_LENGTH = 48;
const DEEP_ARTICLE_SCORE_THRESHOLD = Number(
  process.env.DEEP_ARTICLE_SCORE_THRESHOLD ?? 8,
);
const DEEP_ARTICLE_FULL_CONTENT_MAX_LENGTH = 1500;
const PROJECT_SEARCH_LIMIT = 5;
const TRAVEL_EVIDENCE_QUERY_TERMS = [
  "旅行",
  "游记",
  "海外",
  "出国",
  "国家",
  "城市",
  "目的地",
];
const TRAVEL_EVIDENCE_POSITIVE_TERMS = [
  "旅行",
  "游记",
  "day1",
  "day2",
  "day3",
  "自驾",
  "潜水",
  "马拉松",
  "旅拍",
  "短片",
  "跨年",
  "东京",
  "京都",
  "首尔",
  "薄荷岛",
  "宿务",
  "美国",
  "日本",
  "菲律宾",
  "韩国",
  "尼泊尔",
];
const TRAVEL_EVIDENCE_NEGATIVE_TERMS = [
  "签证",
  "有感",
  "读后感",
  "攻略",
  "机场",
  "拒绝登机",
];

let cachedPostDocs: SearchDocument[] | null = null;
let cachedPostIndex: SearchIndexedDocument[] | null = null;
let cachedTweetDocs: SearchDocument[] | null = null;
let cachedTweetIndex: SearchIndexedDocument[] | null = null;
let cachedProjectDocs: SearchDocument[] | null = null;
let cachedProjectIndex: SearchIndexedDocument[] | null = null;

export interface CachedSearchContext {
  query: string;
  articles: ArticleContext[];
  tweets: TweetContext[];
  projects: ProjectContext[];
  updatedAt: number;
}

const searchContextCache = new Map<string, CachedSearchContext>();

function loadSearchData(): {
  postIndex: SearchIndexedDocument[];
  tweetIndex: SearchIndexedDocument[];
  projectIndex: SearchIndexedDocument[];
} {
  if (
    cachedPostDocs &&
    cachedPostIndex &&
    cachedTweetDocs &&
    cachedTweetIndex &&
    cachedProjectDocs &&
    cachedProjectIndex
  ) {
    return {
      postIndex: cachedPostIndex,
      tweetIndex: cachedTweetIndex,
      projectIndex: cachedProjectIndex,
    };
  }

  const postDocs = getSearchDocuments();
  const tweetDocs = getTweetSearchDocuments();
  const projectDocs = [
    ...getProjectSearchDocuments(),
    ...getExperienceSearchDocuments(),
  ];
  const postIndex = createSearchIndex(postDocs);
  const tweetIndex = createSearchIndex(tweetDocs);
  const projectIndex = createSearchIndex(projectDocs);

  cachedPostDocs = postDocs;
  cachedPostIndex = postIndex;
  cachedTweetDocs = tweetDocs;
  cachedTweetIndex = tweetIndex;
  cachedProjectDocs = projectDocs;
  cachedProjectIndex = projectIndex;

  return { postIndex, tweetIndex, projectIndex };
}

function resolveSearchLimit(
  query: string,
  narrowLimit: number,
  broadLimit: number,
): number {
  const terms = getNormalizedQueryTerms(query);
  if (terms.length <= SEARCH_TERM_BROAD_QUERY_MAX) {
    return broadLimit;
  }
  return narrowLimit;
}

function countKeywordHitsInText(text: string, keywords: string[]): number {
  const normalized = normalizeSearchText(text);
  if (!normalized) return 0;

  let hits = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword.toLowerCase())) {
      hits += 1;
    }
  }
  return hits;
}

function isTravelEvidenceQuery(query: string): boolean {
  return countKeywordHitsInText(query, TRAVEL_EVIDENCE_QUERY_TERMS) >= 2;
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

export function mergeSearchResults<T extends { url: string }>(
  primary: T[],
  secondary: T[],
): T[] {
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

function rerankTravelEvidenceResults<
  T extends {
    title: string;
    excerpt?: string;
    content: string;
    categories: string[];
    keyPoints?: string[];
    dateTime: number;
    score: number;
  },
>(query: string, results: T[]): T[] {
  if (!isTravelEvidenceQuery(query) || results.length === 0) {
    return results;
  }

  return results
    .map((item, index) => {
      const joinedText = [
        item.title,
        item.excerpt ?? "",
        item.content.slice(0, 200),
        ...(item.keyPoints ?? []),
        ...item.categories,
      ].join(" ");

      const positiveHits = countKeywordHitsInText(
        joinedText,
        TRAVEL_EVIDENCE_POSITIVE_TERMS,
      );
      const negativeHits = countKeywordHitsInText(
        joinedText,
        TRAVEL_EVIDENCE_NEGATIVE_TERMS,
      );
      const travelCategoryBoost = item.categories.some((category) =>
        ["travel", "photography", "run"].includes(category.toLowerCase()),
      )
        ? 3
        : 0;
      const adjustedScore =
        item.score + positiveHits * 1.8 + travelCategoryBoost - negativeHits * 2.5;

      return {
        item,
        index,
        adjustedScore,
      };
    })
    .sort((a, b) => b.adjustedScore - a.adjustedScore || a.index - b.index)
    .map(({ item }) => item);
}

export function searchRelatedArticles(
  query: string,
  enableDeepContent = false,
): ArticleContext[] {
  if (!query.trim()) return [];
  const { postIndex } = loadSearchData();
  const limit = resolveSearchLimit(
    query,
    ARTICLE_SEARCH_LIMIT,
    ARTICLE_SEARCH_LIMIT_BROAD,
  );
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
          if (
            item.categories.some((category) =>
              normalizeSearchText(category).includes(term),
            )
          ) {
            return true;
          }
          return (item.keyPoints ?? []).some((point) =>
            normalizeSearchText(point).includes(term),
          );
        },
      })
    : [];
  const strictMatches =
    shouldApplyAnchorFilter && anchorTerms.length > 0
      ? rawResults.filter((item) => {
          return anchorTerms.some((term) => {
            if (normalizeSearchText(item.title).includes(term)) return true;
            if (
              item.categories.some((category) =>
                normalizeSearchText(category).includes(term),
              )
            ) {
              return true;
            }
            return (item.keyPoints ?? []).some((point) =>
              normalizeSearchText(point).includes(term),
            );
          });
        })
      : rawResults;
  const candidates = strictMatches.length > 0 ? strictMatches : rawResults;
  const filtered = filterLowRelevanceResults(candidates);
  const reranked = rerankTravelEvidenceResults(query, filtered);
  const results = reranked.slice(0, limit);

  const topScore = results[0]?.score ?? 0;
  const secondScore = results[1]?.score ?? 0;
  const isDeepHit =
    enableDeepContent &&
    topScore >= DEEP_ARTICLE_SCORE_THRESHOLD &&
    topScore > secondScore * 1.5;

  return results.map((result, index) => {
    const fullContent =
      isDeepHit && index === 0 && result.content
        ? result.content.slice(0, DEEP_ARTICLE_FULL_CONTENT_MAX_LENGTH)
        : undefined;
    return {
      title: result.title,
      url: result.url.startsWith("http")
        ? result.url
        : `${siteConfig.siteUrl}${result.url}`,
      summary: getAISummary(result.id)?.summary ?? result.excerpt,
      keyPoints: getAISummary(result.id)?.keyPoints ?? [],
      categories: result.categories,
      dateTime: result.dateTime,
      fullContent,
    };
  });
}

function formatTweetDate(dateTime: number): string {
  if (!Number.isFinite(dateTime) || dateTime <= 0) return "未知日期";
  return new Date(dateTime).toISOString().slice(0, 10);
}

export function searchRelatedTweets(query: string): TweetContext[] {
  if (!query.trim()) return [];
  const { tweetIndex } = loadSearchData();
  const limit = resolveSearchLimit(
    query,
    TWEET_SEARCH_LIMIT,
    TWEET_SEARCH_LIMIT_BROAD,
  );
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
  const strictMatches =
    shouldApplyAnchorFilter && anchorTerms.length > 0
      ? rawResults.filter((item) => {
          return anchorTerms.some((term) => {
            if (normalizeSearchText(item.title).includes(term)) return true;
            return normalizeSearchText(item.excerpt || item.content).includes(term);
          });
        })
      : rawResults;
  const candidates = strictMatches.length > 0 ? strictMatches : rawResults;
  const filtered = filterLowRelevanceResults(candidates);
  const results = rerankTravelEvidenceResults(query, filtered).slice(0, limit);

  return results.map((result) => ({
    title: result.title,
    url: result.url,
    text: result.excerpt || result.content.slice(0, 220),
    date: formatTweetDate(result.dateTime),
    dateTime: result.dateTime,
  }));
}

export function searchRelatedProjects(query: string): ProjectContext[] {
  if (!query.trim()) return [];
  const { projectIndex } = loadSearchData();
  const rawResults = searchDocuments(projectIndex, query, PROJECT_SEARCH_LIMIT * 2);
  if (rawResults.length === 0) return [];

  return rawResults.slice(0, PROJECT_SEARCH_LIMIT).map((result) => ({
    name: result.title,
    url: result.url,
    description: result.excerpt || result.content.slice(0, 200),
  }));
}

const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{7,63}$/i;

export function getSessionCacheKey(req: Request): string | null {
  const sessionId = req.headers.get("x-session-id")?.trim();
  if (sessionId && SESSION_ID_PATTERN.test(sessionId)) {
    return `sid:${sessionId}`;
  }
  return null;
}

export function isLikelyFollowUp(message: string): boolean {
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

export function cleanupSearchContextCache(now: number): void {
  for (const [key, value] of searchContextCache) {
    if (now - value.updatedAt > SEARCH_CONTEXT_CACHE_TTL_MS) {
      searchContextCache.delete(key);
    }
  }

  if (searchContextCache.size <= MAX_SEARCH_CONTEXT_CACHE_SIZE) return;

  const overflowCount = searchContextCache.size - MAX_SEARCH_CONTEXT_CACHE_SIZE;
  const keys = searchContextCache.keys();
  for (let index = 0; index < overflowCount; index += 1) {
    const next = keys.next();
    if (next.done) break;
    searchContextCache.delete(next.value);
  }
}

export function getCachedSearchContext(
  cacheKey: string,
): CachedSearchContext | undefined {
  return searchContextCache.get(cacheKey);
}

export function setCachedSearchContext(
  cacheKey: string,
  context: CachedSearchContext,
): void {
  searchContextCache.set(cacheKey, context);
}
