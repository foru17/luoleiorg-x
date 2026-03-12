import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type FinishReason,
  type UIMessage,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type {
  ArticleContext,
  CurrentArticleContext,
  ProjectContext,
  TweetContext,
} from "@/lib/ai/chat-prompt";
import { buildSystemPrompt } from "@/lib/ai/chat-prompt";
import {
  buildArticleConversationQuery,
  buildArticleEvidenceQuery,
  decideArticleIntent,
} from "@/lib/ai/article-chat";
import {
  extractCurrentArticleQuestionFacts,
  extractRelevantArticleExcerpts,
} from "@/lib/ai/article-chat-excerpts";
import { parseChatRequestContext } from "@/lib/ai/chat-context";
import {
  buildEvidenceAnalysisSection,
  analyzeRetrievedEvidence,
  shouldSkipAnalysis,
} from "@/lib/ai/evidence-analysis";
import {
  cleanupSearchContextCache,
  getArticleContextBySlug,
  getArticleContextsBySlugs,
  getCachedSearchContext,
  getSessionCacheKey,
  isLikelyFollowUp,
  mergeSearchResults,
  searchRelatedArticles,
  searchRelatedProjects,
  searchRelatedTweets,
  SEARCH_CONTEXT_CACHE_TTL_MS,
  setCachedSearchContext,
} from "@/lib/ai/chat-search";
import { createChatStatusData } from "@/lib/ai/chat-status";
import {
  classifyUpstreamError,
  createRequestId,
  durationMs,
  logChatAIDebug,
  mergeTokenUsage,
  parsePositiveIntEnv,
  summarizeError,
  toTokenUsageStats,
  truncateForLog,
  truncateRawTextForLog,
} from "@/lib/ai/chat-utils";
import {
  createCitationGuardTransform,
  getCitationGuardPreflight,
  type CitationGuardAction,
} from "@/lib/ai/citation-guard";
import {
  extractSearchKeywords,
  KEYWORD_EXTRACTION_TIMEOUT_MS,
  shouldRunKeywordExtractionModel,
  type QueryComplexity,
} from "@/lib/ai/keyword-extraction";
import {
  buildLocalSearchQuery,
  buildSearchQuery,
  getMessageText,
  hasNewSignificantTokens,
  hasSearchQueryOverlap,
} from "@/lib/ai/search-query";
import { getPostRawContent } from "@/lib/content/posts";
import { getClientIP, checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { siteConfig } from "@/lib/site-config";
import {
  sendChatNotification,
  type RequestTimingStats,
  type TokenUsageStats,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

const MAX_HISTORY_MESSAGES = 20;
const MAX_INPUT_LENGTH = 500;
const EVIDENCE_ANALYSIS_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.EVIDENCE_ANALYSIS_TIMEOUT_MS,
  8000,
);
const EVIDENCE_ANALYSIS_MAX_OUTPUT_TOKENS = parsePositiveIntEnv(
  process.env.EVIDENCE_ANALYSIS_MAX_OUTPUT_TOKENS,
  360,
);
const CURRENT_ARTICLE_FULL_CONTENT_MAX_LENGTH = parsePositiveIntEnv(
  process.env.CURRENT_ARTICLE_FULL_CONTENT_MAX_LENGTH,
  12000,
);

function hasRecencyIntent(text: string): boolean {
  return /最近|最新|最近一次|最近一篇|最新一篇|最近公开|最新公开/u.test(
    text.trim(),
  );
}

function sortByRecency<T extends { dateTime?: number }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => (b.dateTime ?? Number.NEGATIVE_INFINITY) - (a.dateTime ?? Number.NEGATIVE_INFINITY),
  );
}

function stripMarkdownForPrompt(content: string): string {
  const withCodePreserved = content.replace(
    /```(?:[\w-]+)?\n([\s\S]*?)```/g,
    (_match, code: string) => `\n${code.trim()}\n`,
  );

  const normalizedLines = withCodePreserved
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/`([^`]*)`/g, "$1")
        .replace(/^#{1,6}\s+/, "")
        .replace(/^\s*>\s?/, "")
        .replace(/^\s*[-*+]\s+/, "- ")
        .replace(/\s+/g, " ")
        .trim(),
    );

  const cleanedLines: string[] = [];
  let previousBlank = false;

  for (const line of normalizedLines) {
    if (!line) {
      if (!previousBlank) {
        cleanedLines.push("");
      }
      previousBlank = true;
      continue;
    }

    cleanedLines.push(line);
    previousBlank = false;
  }

  return cleanedLines.join("\n").trim();
}

function resolveCurrentArticleContext(
  value: ReturnType<typeof parseChatRequestContext>,
  articleQuery: string,
): CurrentArticleContext | undefined {
  if (!value || value.scope !== "article") return undefined;

  const baseArticle = getArticleContextBySlug(value.article.slug, {
    fullContentMaxLength: CURRENT_ARTICLE_FULL_CONTENT_MAX_LENGTH,
  });
  const rawContent = getPostRawContent(value.article.slug);
  const fullContent = rawContent
    ? stripMarkdownForPrompt(rawContent).slice(0, CURRENT_ARTICLE_FULL_CONTENT_MAX_LENGTH)
    : baseArticle?.fullContent;
  const questionFacts = fullContent
    ? extractCurrentArticleQuestionFacts(fullContent, articleQuery)
    : [];
  const relevantExcerpts = fullContent
    ? extractRelevantArticleExcerpts(fullContent, articleQuery)
    : [];

  return {
    slug: value.article.slug,
    title: baseArticle?.title ?? value.article.title,
    url: baseArticle?.url ?? `${siteConfig.siteUrl}/${value.article.slug}`,
    summary: value.article.summary ?? baseArticle?.summary ?? "",
    abstract: value.article.abstract,
    keyPoints:
      value.article.keyPoints && value.article.keyPoints.length > 0
        ? value.article.keyPoints
        : baseArticle?.keyPoints ?? [],
    categories:
      value.article.categories && value.article.categories.length > 0
        ? value.article.categories
        : baseArticle?.categories ?? [],
    relatedSlugs: value.article.relatedSlugs ?? [],
    questionFacts,
    relevantExcerpts,
    fullContent,
  };
}

export async function POST(req: Request) {
  const requestStart = performance.now();
  const requestId = createRequestId();
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

  let body: { messages?: UIMessage[]; context?: unknown };
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
  const articleConversationQuery = buildArticleConversationQuery(messages);
  const articleEvidenceQuery = buildArticleEvidenceQuery(messages);
  const requestContext = parseChatRequestContext(body.context);
  const currentArticle = resolveCurrentArticleContext(
    requestContext,
    articleEvidenceQuery || latestText,
  );
  const articleIntentDecision = currentArticle
    ? decideArticleIntent(articleConversationQuery || latestText, currentArticle)
    : undefined;
  const shouldUseArticleScopedFlow = Boolean(
    currentArticle &&
      articleIntentDecision &&
      !articleIntentDecision.shouldSearchSiteWide,
  );

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
  logChatAIDebug(requestId, "request.received", {
    latestText: truncateForLog(latestText),
    articleConversationQuery: truncateForLog(articleConversationQuery || latestText),
    articleEvidenceQuery: truncateForLog(articleEvidenceQuery || latestText),
    messageCount: messages.length,
    model,
    keywordModel,
  });

  const cacheKey = getSessionCacheKey(req);
  const now = Date.now();
  cleanupSearchContextCache(now);
  const cachedContext = cacheKey ? getCachedSearchContext(cacheKey) : undefined;
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
  const shouldReuseSearchContext = Boolean(
    !shouldUseArticleScopedFlow &&
    cachedContext &&
      userTurnCount > 1 &&
      now - cachedContext.updatedAt <= SEARCH_CONTEXT_CACHE_TTL_MS &&
      isLikelyFollowUp(latestText) &&
      hasSearchQueryOverlap(currentQueryForReuseCheck, cachedContext.query) &&
      !hasNewTopicTokens,
  );
  if (shouldReuseSearchContext) {
    logChatAIDebug(requestId, "reuse-intent.rule-based", {
      latestText: truncateForLog(latestText, 120),
      decision: "SAME",
    });
  }

  let searchQuery = normalizedLatestQuery || latestText;
  let relatedArticles: ArticleContext[] = [];
  let relatedTweets: TweetContext[] = [];
  let relatedProjects: ProjectContext[] = [];
  let keywordUsage: TokenUsageStats | undefined;
  let keywordExtractionMs: number | undefined;
  let searchMs = 0;
  let queryComplexity: QueryComplexity = "moderate";

  if (shouldUseArticleScopedFlow && currentArticle && articleIntentDecision) {
    searchQuery = articleIntentDecision.queryHint || currentArticle.title;
    if (articleIntentDecision.mode === "article_extension") {
      relatedArticles = getArticleContextsBySlugs(currentArticle.relatedSlugs ?? []);
    }
    if (articleIntentDecision.mode === "article_extension" && relatedArticles.length === 0) {
      relatedArticles = searchRelatedArticles(searchQuery, true).filter(
        (article) => article.url !== currentArticle.url,
      );
    }
  } else if (shouldReuseSearchContext && cachedContext) {
    searchQuery = cachedContext.query;
    relatedArticles = cachedContext.articles;
    relatedTweets = cachedContext.tweets;
    relatedProjects = cachedContext.projects || [];
    if (cacheKey) {
      setCachedSearchContext(cacheKey, {
        ...cachedContext,
        updatedAt: now,
      });
    }
  } else {
    const runKeywordExtraction = shouldRunKeywordExtractionModel(
      messages,
      localSearchQuery,
      latestText,
    );
    const searchStart = performance.now();

    const localArticles = searchRelatedArticles(searchQuery, true);
    const localTweets = searchRelatedTweets(searchQuery);
    const localProjects = searchRelatedProjects(searchQuery);

    if (runKeywordExtraction) {
      const keywordStart = performance.now();
      const abortController = new AbortController();
      const timeoutId = setTimeout(
        () => abortController.abort(),
        KEYWORD_EXTRACTION_TIMEOUT_MS,
      );

      try {
        const keywordResult = await extractSearchKeywords(
          messages,
          provider,
          keywordModel,
          abortController.signal,
        );
        logChatAIDebug(requestId, "keyword-extraction.result", {
          parseMode: keywordResult.parseMode,
          usedFallback: keywordResult.usedFallback,
          query: keywordResult.query,
          primaryQuery: keywordResult.primaryQuery,
          rawTextLength: keywordResult.rawText?.length,
          rawText: keywordResult.rawText
            ? truncateRawTextForLog(keywordResult.rawText)
            : undefined,
          error: keywordResult.error,
        });

        const normalizedKeywordQuery = keywordResult.query || "";
        if (normalizedKeywordQuery && normalizedKeywordQuery !== searchQuery) {
          searchQuery = normalizedKeywordQuery;
          relatedArticles = searchRelatedArticles(searchQuery, true);
          relatedTweets = searchRelatedTweets(searchQuery);
          relatedProjects = searchRelatedProjects(searchQuery);

          const primaryQuery = keywordResult.primaryQuery || "";
          if (primaryQuery && primaryQuery !== searchQuery) {
            const primaryArticles = searchRelatedArticles(primaryQuery, false);
            const primaryTweets = searchRelatedTweets(primaryQuery);
            relatedArticles = mergeSearchResults(primaryArticles, relatedArticles);
            relatedTweets = mergeSearchResults(primaryTweets, relatedTweets);
          }
        } else {
          relatedArticles = localArticles;
          relatedTweets = localTweets;
          relatedProjects = localProjects;
        }

        keywordUsage = keywordResult.usage;
        queryComplexity = keywordResult.complexity;
      } catch {
        relatedArticles = localArticles;
        relatedTweets = localTweets;
        relatedProjects = localProjects;
      } finally {
        clearTimeout(timeoutId);
      }

      keywordExtractionMs = durationMs(keywordStart);
    } else {
      relatedArticles = localArticles;
      relatedTweets = localTweets;
      relatedProjects = localProjects;
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
      relatedProjects = searchRelatedProjects(fallbackQuery);
      }
    }

    if (hasRecencyIntent(latestText)) {
      relatedArticles = sortByRecency(relatedArticles);
      relatedTweets = sortByRecency(relatedTweets);
    }
    searchMs = durationMs(searchStart);

    if (cacheKey) {
      setCachedSearchContext(cacheKey, {
        query: searchQuery,
        articles: relatedArticles,
        tweets: relatedTweets,
        projects: relatedProjects,
        updatedAt: now,
      });
    }
  }

  logChatAIDebug(requestId, "search.summary", {
    hasExplicitSessionId: Boolean(cacheKey),
    currentArticleSlug: currentArticle?.slug,
    articleIntentMode: articleIntentDecision?.mode,
    articleScopedFlow: shouldUseArticleScopedFlow,
    reusedSearchContext: shouldReuseSearchContext,
    searchQuery,
    articleCount: relatedArticles.length,
    tweetCount: relatedTweets.length,
    projectCount: relatedProjects.length,
    topArticleTitles: relatedArticles.slice(0, 4).map((item) => item.title),
    topTweetTitles: relatedTweets.slice(0, 4).map((item) => item.title),
    topProjectNames: relatedProjects.slice(0, 3).map((item) => item.name),
  });

  const baseSystemPrompt = buildSystemPrompt(
    relatedArticles,
    relatedTweets,
    currentArticle ? articleEvidenceQuery || latestText : articleConversationQuery || latestText,
    relatedProjects,
    currentArticle,
  );

  const evidenceModel = process.env.AI_EVIDENCE_MODEL || keywordModel;
  let evidenceAnalysisSection = "";
  let evidenceUsage: TokenUsageStats | undefined;
  let evidenceAnalysisMs: number | undefined;
  let evidenceParseStatus = "";

  const skipAnalysis =
    shouldUseArticleScopedFlow ||
    shouldSkipAnalysis(latestText, relatedArticles.length, relatedTweets.length);
  if (!skipAnalysis) {
    const evidenceStart = performance.now();
    const evidenceAbortController = new AbortController();
    const evidenceTimeoutId = setTimeout(
      () => evidenceAbortController.abort(),
      EVIDENCE_ANALYSIS_TIMEOUT_MS,
    );
    try {
      const evidenceResult = await analyzeRetrievedEvidence({
        messages,
        searchQuery,
        articles: relatedArticles,
        tweets: relatedTweets,
        provider,
        model: evidenceModel,
        maxOutputTokens: EVIDENCE_ANALYSIS_MAX_OUTPUT_TOKENS,
        complexity: queryComplexity,
        abortSignal: evidenceAbortController.signal,
      });
      evidenceUsage = evidenceResult.usage;
      evidenceParseStatus = evidenceResult.parseStatus;
      if (evidenceResult.analysis) {
        const sourceTitleByUrl = new Map<string, string>();
        for (const article of relatedArticles) {
          sourceTitleByUrl.set(article.url, article.title);
        }
        for (const tweet of relatedTweets) {
          sourceTitleByUrl.set(tweet.url, tweet.title);
        }
        evidenceAnalysisSection = buildEvidenceAnalysisSection(
          evidenceResult.analysis,
          sourceTitleByUrl,
        );
      }
      logChatAIDebug(requestId, "evidence-analysis.result", {
        parseStatus: evidenceResult.parseStatus,
        hasSection: evidenceAnalysisSection.length > 0,
        sectionLength: evidenceAnalysisSection.length,
        rawTextLength: evidenceResult.rawText?.length,
        rawText: evidenceResult.rawText
          ? truncateRawTextForLog(evidenceResult.rawText)
          : undefined,
        error: evidenceResult.error,
      });
    } catch (error) {
      logChatAIDebug(requestId, "evidence-analysis.error", {
        error: summarizeError(error),
      });
    } finally {
      clearTimeout(evidenceTimeoutId);
    }
    evidenceAnalysisMs = durationMs(evidenceStart);
  } else {
    logChatAIDebug(requestId, "evidence-analysis.skipped", {
      reason: shouldUseArticleScopedFlow ? "article_scoped_flow" : "skip_analysis",
      articleCount: relatedArticles.length,
      tweetCount: relatedTweets.length,
    });
  }

  const finalSystemPrompt = evidenceAnalysisSection
    ? `${baseSystemPrompt}\n\n${evidenceAnalysisSection}`
    : baseSystemPrompt;
  const citationGuardPreflight = getCitationGuardPreflight({
    userQuery: latestText,
    articles: relatedArticles,
    tweets: relatedTweets,
    projects: relatedProjects,
  });
  if (citationGuardPreflight) {
    logChatAIDebug(requestId, "citation-guard.preflight", {
      actions: citationGuardPreflight.actions,
      responsePreview: truncateForLog(citationGuardPreflight.text),
    });
  }

  try {
    let baseResponseText = "";
    let chatCompletionUsage: TokenUsageStats | undefined;
    let promptBuildMs: number | undefined;
    let streamFinishReason: FinishReason | undefined;
    let streamRawFinishReason: string | undefined;
    let citationGuardActions: CitationGuardAction[] = citationGuardPreflight?.actions ?? [];

    const stream = createUIMessageStream<UIMessage>({
      originalMessages: messages,
      execute: async ({ writer }) => {
        const articleCount = relatedArticles.length + relatedTweets.length;

        if (shouldUseArticleScopedFlow && currentArticle) {
          writer.write({
            type: "message-metadata",
            messageMetadata: createChatStatusData({
              stage: "search",
              message: "正在结合当前文章全文回答",
              progress: 40,
            }),
          });
        } else if (articleCount > 0) {
          writer.write({
            type: "message-metadata",
            messageMetadata: createChatStatusData({
              stage: "search",
              message: `找到 ${articleCount} 篇相关内容`,
              progress: 40,
            }),
          });
        }

        if (citationGuardPreflight) {
          streamFinishReason = "stop";
          streamRawFinishReason = "citation_guard_preflight";
          baseResponseText = citationGuardPreflight.text;
          writer.write({
            type: "message-metadata",
            messageMetadata: createChatStatusData({
              stage: "answer",
              message: "已基于公开记录直接给出回答",
              progress: 100,
            }),
          });
          writer.write({
            type: "text-start",
            id: `citation-guard-${requestId}`,
          });
          writer.write({
            type: "text-delta",
            id: `citation-guard-${requestId}`,
            delta: citationGuardPreflight.text,
          });
          writer.write({
            type: "text-end",
            id: `citation-guard-${requestId}`,
          });
          writer.write({
            type: "finish",
            finishReason: streamFinishReason,
          });
          return;
        }

        const promptBuildStart = performance.now();
        const systemPrompt = finalSystemPrompt;
        promptBuildMs = durationMs(promptBuildStart);
        logChatAIDebug(requestId, "prompt.summary", {
          systemPromptLength: systemPrompt.length,
          hasEvidenceAnalysisSection: evidenceAnalysisSection.length > 0,
        });

        writer.write({
          type: "message-metadata",
          messageMetadata: createChatStatusData({
            stage: "answer",
            message: "正在生成回答...",
            progress: 60,
          }),
        });

        const result = streamText({
          model: provider.chatModel(model),
          system: systemPrompt,
          messages: await convertToModelMessages(messages),
          temperature: 0.3,
          maxOutputTokens: 2500,
          experimental_transform: createCitationGuardTransform({
            userQuery: articleConversationQuery || latestText,
            articles: relatedArticles,
            tweets: relatedTweets,
            projects: relatedProjects,
            onApplied: (guardResult) => {
              citationGuardActions = guardResult.actions;
            },
          }),
          onFinish: ({ text, totalUsage, finishReason, rawFinishReason }) => {
            baseResponseText = text;
            chatCompletionUsage = toTokenUsageStats(totalUsage);
            streamFinishReason = finishReason;
            streamRawFinishReason = rawFinishReason;
            logChatAIDebug(requestId, "chat-model.finish", {
              finishReason,
              rawFinishReason,
              responsePreview: truncateForLog(text),
              responseLength: text.length,
            });
          },
        });

        writer.merge(
          result.toUIMessageStream({
            sendFinish: false,
          }),
        );
        await result.consumeStream({ onError: writer.onError });

        writer.write({
          type: "finish",
          finishReason: streamFinishReason,
        });
      },
      onFinish: async ({ responseMessage }) => {
        const finalResponseText = getMessageText(responseMessage) || baseResponseText;
        const totalTokenUsage = mergeTokenUsage(
          mergeTokenUsage(keywordUsage, evidenceUsage),
          chatCompletionUsage,
        );
        const timings: RequestTimingStats = {
          totalMs: durationMs(requestStart),
          keywordExtractionMs,
          evidenceAnalysisMs,
          searchMs,
          promptBuildMs,
          reusedSearchContext: shouldReuseSearchContext,
        };

        await sendChatNotification({
          userIp: ip,
          userMessage: latestText,
          aiResponse: finalResponseText,
          articleTitles: [
            ...relatedArticles.map((article) => `文章 · ${article.title}`),
            ...relatedTweets.map((tweet) => `推文 · ${tweet.title}`),
          ],
          messageCount: messages.length,
          modelConfig: {
            apiBaseUrl: baseUrl,
            chatModel: model,
            keywordModel,
            evidenceModel,
          },
          tokenUsage: {
            total: totalTokenUsage,
            chatCompletion: chatCompletionUsage,
            keywordExtraction: keywordUsage,
            evidenceAnalysis: evidenceUsage,
          },
          timings,
          finishReason: streamFinishReason,
          rawFinishReason: streamRawFinishReason,
        });
        logChatAIDebug(requestId, "request.completed", {
          totalMs: timings.totalMs,
          searchMs,
          keywordExtractionMs,
          evidenceAnalysisMs,
          evidenceParseStatus,
          citationGuardActions,
          hasEvidenceSection: evidenceAnalysisSection.length > 0,
          promptBuildMs,
          finalResponsePreview: truncateForLog(finalResponseText),
        });
      },
    });

    return createUIMessageStreamResponse({ stream });
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    logChatAIDebug(requestId, "request.failed", {
      detail: truncateForLog(detail, 240),
    });
    const { reason, status } = classifyUpstreamError(detail, model);

    return Response.json(
      { error: reason, detail: detail.slice(0, 200) },
      { status },
    );
  }
}
