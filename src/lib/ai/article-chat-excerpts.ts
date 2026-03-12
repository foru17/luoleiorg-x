import { normalizeSearchText } from "./chat-utils.ts";
import { extractSearchTokens } from "./search-query.ts";

const MAX_EXCERPTS = 3;
const MAX_EXCERPT_LENGTH = 320;
const MAX_QUESTION_FACTS = 10;
const MAX_QUESTION_FACT_LENGTH = 220;
const LODGING_EXPANSION_TOKENS = ["住宿", "酒店", "airbnb", "民宿", "别墅", "旅店", "入住", "住在"];
const ROUTE_EXPANSION_TOKENS = ["行程", "路线", "路书", "出发", "前往", "到达", "离开", "目的地"];
const LODGING_QUERY_PATTERN = /住哪里|住哪|住宿|酒店|hotel|airbnb|民宿|别墅|旅店|入住|住了几晚/u;
const ROUTE_QUERY_PATTERN = /去了哪些地方|去哪些地方|去了哪里|路线|行程|路书|途经|经过|目的地|沿途|先去哪里|后面去哪/u;
const PLACE_HINT_PATTERN =
  /\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2}\b|[\p{Script=Han}]{2,}(?:湖|湾|山|谷|城|镇|市|州|岛|河|桥|路|公路|公园|机场|车站|码头|饭店|酒店|旅店|民宿|别墅|营地)/u;
const DIRECT_LODGING_FACT_PATTERNS = [/住在/u, /入住/u, /租了/u, /HOTEL/u, /旅店/u, /饭店/u, /民宿/u, /别墅/u];
const SECONDARY_LODGING_FACT_PATTERNS = [/酒店/u, /住宿/u];
const DIRECT_ROUTE_FACT_PATTERNS = [
  /从[^。；\n]{0,24}出发/u,
  /出发前往/u,
  /出发去/u,
  /前往/u,
  /到达/u,
  /来到/u,
  /回到/u,
  /先回/u,
  /返回/u,
  /离开/u,
  /终点/u,
];
const SECONDARY_ROUTE_FACT_PATTERNS = [/行程/u, /路书/u, /目的地/u, /途径/u, /经过/u];

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function splitIntoParagraphs(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function splitIntoSentences(content: string): string[] {
  return content
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])/u))
    .map((sentence) => sentence.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildExpandedQueryTokens(query: string): string[] {
  const tokens = extractSearchTokens(query, 12);
  const expanded = new Set(tokens);

  if (/(住哪里|住哪|住宿|酒店|airbnb|民宿|别墅|旅店|入住)/iu.test(query)) {
    for (const token of LODGING_EXPANSION_TOKENS) {
      expanded.add(token);
    }
  }

  if (/(去了哪些地方|去哪些地方|去了哪里|行程|路线|路书|途经|经过|目的地)/u.test(query)) {
    for (const token of ROUTE_EXPANSION_TOKENS) {
      expanded.add(token);
    }
  }

  return Array.from(expanded);
}

function scoreParagraph(paragraph: string, normalizedQuery: string, queryTokens: string[]): number {
  const normalizedParagraph = normalizeSearchText(paragraph);
  if (!normalizedParagraph) return 0;

  let score = 0;

  if (normalizedQuery && normalizedParagraph.includes(normalizedQuery)) {
    score += 8;
  }

  for (const token of queryTokens) {
    if (normalizedParagraph.includes(token)) {
      score += token.length >= 4 ? 3 : 2;
    }
  }

  return score;
}

function collectQuestionFacts(
  content: string,
  predicate: (sentence: string) => boolean,
  maxCount = MAX_QUESTION_FACTS,
): string[] {
  const seen = new Set<string>();
  const facts: string[] = [];

  for (const sentence of splitIntoSentences(content)) {
    if (!predicate(sentence)) continue;
    const normalized = normalizeSearchText(sentence);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    facts.push(truncateText(sentence, MAX_QUESTION_FACT_LENGTH));
    if (facts.length >= maxCount) break;
  }

  return facts;
}

function hasPattern(sentence: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(sentence));
}

function isLikelyLodgingFact(sentence: string): boolean {
  const hasDirectMatch = hasPattern(sentence, DIRECT_LODGING_FACT_PATTERNS);
  const hasSecondaryMatch = hasPattern(sentence, SECONDARY_LODGING_FACT_PATTERNS);
  const hasPlaceHint = PLACE_HINT_PATTERN.test(sentence);

  let score = 0;
  if (hasDirectMatch) score += 3;
  if (hasSecondaryMatch) score += 1;
  if (hasPlaceHint) score += 1;

  return score >= 3;
}

function isLikelyRouteFact(sentence: string): boolean {
  const hasDirectMatch = hasPattern(sentence, DIRECT_ROUTE_FACT_PATTERNS);
  const hasSecondaryMatch = hasPattern(sentence, SECONDARY_ROUTE_FACT_PATTERNS);
  const hasPlaceHint = PLACE_HINT_PATTERN.test(sentence);

  let score = 0;
  if (hasDirectMatch) score += 3;
  if (hasSecondaryMatch) score += 1;
  if (hasPlaceHint) score += 1;

  return score >= 4;
}

export function extractRelevantArticleExcerpts(content: string, query: string): string[] {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = buildExpandedQueryTokens(query);
  if (!normalizedQuery && queryTokens.length === 0) return [];

  const paragraphs = splitIntoParagraphs(content);
  const ranked = paragraphs
    .map((paragraph, index) => ({
      paragraph,
      index,
      score: scoreParagraph(paragraph, normalizedQuery, queryTokens),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

  const seen = new Set<string>();
  const excerpts: string[] = [];

  for (const item of ranked) {
    const normalizedParagraph = normalizeSearchText(item.paragraph);
    if (!normalizedParagraph || seen.has(normalizedParagraph)) continue;
    seen.add(normalizedParagraph);
    excerpts.push(truncateText(item.paragraph, MAX_EXCERPT_LENGTH));
    if (excerpts.length >= MAX_EXCERPTS) break;
  }

  return excerpts;
}

export function extractCurrentArticleQuestionFacts(content: string, query: string): string[] {
  if (!content.trim() || !query.trim()) return [];

  if (LODGING_QUERY_PATTERN.test(query)) {
    return collectQuestionFacts(content, isLikelyLodgingFact);
  }

  if (ROUTE_QUERY_PATTERN.test(query)) {
    return collectQuestionFacts(content, isLikelyRouteFact);
  }

  return [];
}
