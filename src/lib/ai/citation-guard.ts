import type {
  StreamTextTransform,
  TextStreamPart,
  ToolSet,
} from "ai";
import type {
  ArticleContext,
  ProjectContext,
  TweetContext,
} from "./chat-prompt.ts";
import { normalizeSearchText } from "./chat-utils.ts";
import { extractSearchTokens } from "./search-query.ts";
import { resolveAnswerMode } from "../chat-prompts/intent-ranking.ts";

type CitationSourceKind = "article" | "tweet" | "project";

type CitationGuardActionType =
  | "replace_unknown_with_refusal"
  | "replace_travel_fact_with_grounded_source"
  | "append_direct_source_citation";

export interface CitationGuardAction {
  type: CitationGuardActionType;
  sourceKind?: CitationSourceKind;
  sourceTitle?: string;
  sourceUrl?: string;
}

export interface CitationGuardResult {
  text: string;
  actions: CitationGuardAction[];
}

interface CitationGuardParams {
  answerText: string;
  userQuery: string;
  articles: ArticleContext[];
  tweets: TweetContext[];
  projects: ProjectContext[];
}

type CitationGuardLookupParams = Omit<CitationGuardParams, "answerText">;

interface CitationCandidate {
  kind: CitationSourceKind;
  title: string;
  url: string;
  body: string;
  categories: string[];
}

const URL_PATTERN = /https?:\/\/[^\s)\]]+/giu;
const GENERIC_QUERY_TOKENS = new Set([
  "介绍",
  "一下",
  "自己",
  "什么",
  "哪些",
  "多少",
  "几次",
  "有没有",
  "是否",
  "现在",
  "最近",
  "具体",
  "怎么看",
  "看法",
  "推荐",
  "去过",
]);
const TRAVEL_EXPERIENCE_CATEGORIES = new Set(["travel", "photography", "run"]);
const TRAVEL_NEGATIVE_SOURCE_TERMS = [
  "签证",
  "攻略",
  "领事馆",
  "办理",
  "申请",
];

function normalizeAnswerText(text: string): string {
  return text.trim().replace(/\n{3,}/g, "\n\n");
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/[),.;!?，。；：]+$/u, "").replace(/\/+$/u, "");
}

function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? [];
  return matches.map(normalizeUrl);
}

function buildCandidates(params: Omit<CitationGuardParams, "answerText" | "userQuery">): CitationCandidate[] {
  const articleCandidates = params.articles.map((article) => ({
    kind: "article" as const,
    title: article.title,
    url: article.url,
    body: [article.summary, ...article.keyPoints].filter(Boolean).join(" "),
    categories: article.categories,
  }));

  const tweetCandidates = params.tweets.map((tweet) => ({
    kind: "tweet" as const,
    title: tweet.title,
    url: tweet.url,
    body: `${tweet.text} ${tweet.date}`,
    categories: [],
  }));

  const projectCandidates = params.projects.map((project) => ({
    kind: "project" as const,
    title: project.name,
    url: project.url,
    body: project.description,
    categories: [],
  }));

  return [...articleCandidates, ...tweetCandidates, ...projectCandidates];
}

function getMeaningfulQueryTokens(query: string): string[] {
  const rawTokens = extractSearchTokens(query, 8, { includeJoinedCjk: true });
  const filtered = rawTokens.filter((token) => !GENERIC_QUERY_TOKENS.has(token));
  return filtered.length > 0 ? filtered : rawTokens;
}

function countTokenHits(text: string, tokens: string[]): number {
  const normalized = normalizeSearchText(text);
  let hits = 0;

  for (const token of tokens) {
    if (normalized.includes(normalizeSearchText(token))) {
      hits += 1;
    }
  }

  return hits;
}

function scoreCandidate(
  candidate: CitationCandidate,
  queryTokens: string[],
  options: { preferTravelExperience: boolean },
): number {
  if (queryTokens.length === 0) {
    return 0;
  }

  const titleHits = countTokenHits(candidate.title, queryTokens);
  const bodyHits = countTokenHits(candidate.body, queryTokens);
  const matchedTokens = new Set<string>();

  for (const token of queryTokens) {
    const normalizedToken = normalizeSearchText(token);
    const joined = normalizeSearchText(
      [candidate.title, candidate.body, candidate.categories.join(" ")].join(" "),
    );
    if (joined.includes(normalizedToken)) {
      matchedTokens.add(normalizedToken);
    }
  }

  const coverage = matchedTokens.size / queryTokens.length;
  let score = coverage * 6 + titleHits * 2.5 + bodyHits;

  if (candidate.kind === "article") score += 1.2;
  if (candidate.kind === "project") score += 0.8;
  if (candidate.kind === "tweet") score += 0.4;

  if (options.preferTravelExperience) {
    if (
      candidate.categories.some((category) =>
        TRAVEL_EXPERIENCE_CATEGORIES.has(normalizeSearchText(category)),
      )
    ) {
      score += 2;
    }

    const normalizedBody = normalizeSearchText(
      [candidate.title, candidate.body].join(" "),
    );
    if (
      TRAVEL_NEGATIVE_SOURCE_TERMS.some((term) =>
        normalizedBody.includes(normalizeSearchText(term)),
      )
    ) {
      score -= 4;
    }
  }

  return score;
}

function pickBestDirectSource(params: {
  userQuery: string;
  articles: ArticleContext[];
  tweets: TweetContext[];
  projects: ProjectContext[];
  preferTravelExperience?: boolean;
}): CitationCandidate | undefined {
  const queryTokens = getMeaningfulQueryTokens(params.userQuery);
  if (queryTokens.length === 0) {
    return undefined;
  }

  const candidates = buildCandidates(params);
  if (candidates.length === 0) {
    return undefined;
  }

  const preferTravelExperience = params.preferTravelExperience ?? false;
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, queryTokens, { preferTravelExperience }),
    }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) {
    return undefined;
  }

  const threshold = preferTravelExperience ? 5 : 3.5;
  return best.score >= threshold ? best.candidate : undefined;
}

function hasKnownCitation(text: string, candidates: CitationCandidate[]): boolean {
  const citedUrls = new Set(extractUrls(text));
  return candidates.some((candidate) => citedUrls.has(normalizeUrl(candidate.url)));
}

function hasCitationForSource(text: string, source: CitationCandidate): boolean {
  return extractUrls(text).includes(normalizeUrl(source.url));
}

function buildUnknownRefusal(query: string): string {
  const normalized = normalizeSearchText(query);

  if (/(住址|地址|小区|门牌|住在哪|家在哪)/u.test(normalized)) {
    return "具体住址这类信息未公开，我也不提供。";
  }
  if (/(赚多少钱|收入|工资|薪资|月入|年入)/u.test(normalized)) {
    return "收入这类信息未公开，我不提供。";
  }
  if (/(老婆叫什么|妻子叫什么|家人姓名|父母姓名|孩子姓名)/u.test(normalized)) {
    return "家人的真实姓名这类信息未公开，我不提供。";
  }

  return "这个信息未公开，我不提供。";
}

function isTravelYesNoFactQuery(userQuery: string): boolean {
  const normalized = userQuery.trim();
  return resolveAnswerMode(userQuery) === "fact" && /去过.+吗|有没有去过|是否去过/u.test(normalized);
}

function buildSourceTopic(source: CitationCandidate): string {
  const firstClause = source.body
    .replace(/^作者(?:记录|分享|回顾|介绍|详述|讲述)/u, "")
    .split(/[，。；]/u)[0]
    ?.trim();

  return firstClause || source.title;
}

function buildGroundedTravelAnswer(source: CitationCandidate): string {
  const topic = buildSourceTopic(source);
  return `去过。公开记录里至少有一篇直接相关的文章是 [${source.title}](${source.url})，主题就是${topic}。`;
}

function buildCitationSuffix(source: CitationCandidate): string {
  if (source.kind === "project") {
    return `相关项目：[${source.title}](${source.url})。`;
  }
  if (source.kind === "tweet") {
    return `相关动态：[${source.title}](${source.url})。`;
  }
  return `更直接的参考：[${source.title}](${source.url})。`;
}

export function applyCitationGuard(params: CitationGuardParams): CitationGuardResult {
  const answerMode = resolveAnswerMode(params.userQuery);
  const normalizedAnswer = normalizeAnswerText(params.answerText);

  if (answerMode === "unknown") {
    return {
      text: buildUnknownRefusal(params.userQuery),
      actions: [{ type: "replace_unknown_with_refusal" }],
    };
  }

  const bestDirectSource = pickBestDirectSource({
    userQuery: params.userQuery,
    articles: params.articles,
    tweets: params.tweets,
    projects: params.projects,
    preferTravelExperience: isTravelYesNoFactQuery(params.userQuery),
  });

  if (
    bestDirectSource &&
    bestDirectSource.kind === "article" &&
    isTravelYesNoFactQuery(params.userQuery) &&
    !hasCitationForSource(normalizedAnswer, bestDirectSource)
  ) {
    return {
      text: buildGroundedTravelAnswer(bestDirectSource),
      actions: [
        {
          type: "replace_travel_fact_with_grounded_source",
          sourceKind: bestDirectSource.kind,
          sourceTitle: bestDirectSource.title,
          sourceUrl: bestDirectSource.url,
        },
      ],
    };
  }

  if (!normalizedAnswer) {
    return { text: normalizedAnswer, actions: [] };
  }

  const candidates = buildCandidates(params);
  if (candidates.length === 0) {
    return { text: normalizedAnswer, actions: [] };
  }

  if (bestDirectSource && !hasKnownCitation(normalizedAnswer, candidates)) {
    return {
      text: `${normalizedAnswer}\n\n${buildCitationSuffix(bestDirectSource)}`,
      actions: [
        {
          type: "append_direct_source_citation",
          sourceKind: bestDirectSource.kind,
          sourceTitle: bestDirectSource.title,
          sourceUrl: bestDirectSource.url,
        },
      ],
    };
  }

  return { text: normalizedAnswer, actions: [] };
}

export function getCitationGuardPreflight(
  params: CitationGuardLookupParams,
): CitationGuardResult | null {
  const result = applyCitationGuard({
    ...params,
    answerText: "",
  });

  return result.actions.some((action) =>
    action.type === "replace_unknown_with_refusal" ||
    action.type === "replace_travel_fact_with_grounded_source",
  )
    ? result
    : null;
}

interface BufferedTextState {
  text: string;
}

export function createCitationGuardTransform<TOOLS extends ToolSet>(
  params: CitationGuardLookupParams & {
    onApplied?: (result: CitationGuardResult) => void;
  },
): StreamTextTransform<TOOLS> {
  return () => {
    const buffers = new Map<string, BufferedTextState>();

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(chunk, controller) {
        if (chunk.type === "text-start") {
          buffers.set(chunk.id, { text: "" });
          controller.enqueue(chunk);
          return;
        }

        if (chunk.type === "text-delta") {
          const state = buffers.get(chunk.id);
          if (!state) {
            controller.enqueue(chunk);
            return;
          }
          state.text += chunk.text;
          controller.enqueue(chunk);
          return;
        }

        if (chunk.type === "text-end") {
          const state = buffers.get(chunk.id);
          if (!state) {
            controller.enqueue(chunk);
            return;
          }

          const result = applyCitationGuard({
            ...params,
            answerText: state.text,
          });

          params.onApplied?.(result);

          const normalizedAnswer = normalizeAnswerText(state.text);
          if (
            result.actions.some((action) => action.type === "append_direct_source_citation") &&
            result.text.startsWith(normalizedAnswer)
          ) {
            const suffix = result.text.slice(normalizedAnswer.length);
            if (suffix) {
              controller.enqueue({
                type: "text-delta",
                id: chunk.id,
                text: suffix,
              });
            }
          }

          controller.enqueue(chunk);
          buffers.delete(chunk.id);
          return;
        }

        controller.enqueue(chunk);
      },
      flush() {
        buffers.clear();
      },
    });
  };
}
