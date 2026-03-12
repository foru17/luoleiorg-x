import type { ArticleSummary } from "@/lib/ai/types";
import type { ArticleChatContext } from "@/lib/ai/chat-context";
import { buildArticleChatGuideContent } from "./article-chat-guide-utils.js";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore generated JSON loaded at build time
import articleChatGuidesJson from "../../../data/article-chat-guides.json";

interface ArticleChatGuideFile {
  meta?: {
    generatedAt?: string;
    totalArticles?: number;
    version?: number;
  };
  articles?: Record<string, ArticleChatContext>;
}

const articleChatGuideCache = articleChatGuidesJson as
  | ArticleChatGuideFile
  | undefined;

export function buildFallbackArticleChatGuide(params: {
  slug: string;
  title: string;
  categories: string[];
  aiSummary?: ArticleSummary | null;
}): ArticleChatContext {
  const { slug, title, categories, aiSummary } = params;
  const keyPoints = (aiSummary?.keyPoints ?? []).slice(0, 4);
  const guideContent = buildArticleChatGuideContent({
    title,
    categories,
    keyPoints,
    summary: aiSummary?.summary ?? "",
    abstract: aiSummary?.abstract ?? aiSummary?.summary ?? "",
  });

  return {
    slug,
    title,
    categories,
    summary: aiSummary?.summary ?? "",
    abstract: aiSummary?.abstract ?? aiSummary?.summary ?? "",
    keyPoints,
    focusQuestions: guideContent.focusQuestions,
    extensionTopics: guideContent.extensionTopics,
    relatedSlugs: [],
    openingLine: guideContent.openingLine,
    autoOpenEnabled: true,
    autoOpenDelayMs: 7000,
  };
}

export function getArticleChatGuide(slug: string): ArticleChatContext | null {
  const entry = articleChatGuideCache?.articles?.[slug];
  return entry ?? null;
}

export function getArticleChatGuideWithFallback(params: {
  slug: string;
  title: string;
  categories: string[];
  aiSummary?: ArticleSummary | null;
}): ArticleChatContext {
  return getArticleChatGuide(params.slug) ?? buildFallbackArticleChatGuide(params);
}
