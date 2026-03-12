export interface ArticleChatContext {
  slug: string;
  title: string;
  categories?: string[];
  summary?: string;
  abstract?: string;
  keyPoints?: string[];
  focusQuestions?: string[];
  extensionTopics?: string[];
  relatedSlugs?: string[];
  openingLine?: string;
  autoOpenEnabled?: boolean;
  autoOpenDelayMs?: number;
}

export type ChatEntryContext =
  | { scope: "global" }
  | { scope: "article"; article: ArticleChatContext };

export type ChatRequestContext =
  | { scope: "global" }
  | {
      scope: "article";
      article: Pick<
        ArticleChatContext,
        "slug" | "title" | "categories" | "summary" | "abstract" | "keyPoints" | "relatedSlugs"
      >;
    };

export const GLOBAL_CHAT_CONTEXT: ChatEntryContext = { scope: "global" };

export function isArticleChatEntryContext(
  context: ChatEntryContext | null | undefined,
): context is Extract<ChatEntryContext, { scope: "article" }> {
  return context?.scope === "article" && Boolean(context.article?.slug);
}

export function isArticleChatRequestContext(
  context: ChatRequestContext | null | undefined,
): context is Extract<ChatRequestContext, { scope: "article" }> {
  return context?.scope === "article" && Boolean(context.article?.slug);
}

export function getChatEntryContextKey(context: ChatEntryContext): string {
  if (isArticleChatEntryContext(context)) {
    return `article:${context.article.slug}`;
  }

  return "global";
}

export function toChatRequestContext(context: ChatEntryContext): ChatRequestContext {
  if (!isArticleChatEntryContext(context)) {
    return GLOBAL_CHAT_CONTEXT;
  }

  const article = context.article;
  return {
    scope: "article",
    article: {
      slug: article.slug,
      title: article.title,
      categories: article.categories ?? [],
      summary: article.summary,
      abstract: article.abstract,
      keyPoints: article.keyPoints ?? [],
      relatedSlugs: article.relatedSlugs ?? [],
    },
  };
}

export function parseChatRequestContext(value: unknown): ChatRequestContext | undefined {
  if (!value || typeof value !== "object") return undefined;

  const scope = Reflect.get(value, "scope");
  if (scope !== "article") return undefined;

  const articleValue = Reflect.get(value, "article");
  if (!articleValue || typeof articleValue !== "object") return undefined;

  const slug = Reflect.get(articleValue, "slug");
  const title = Reflect.get(articleValue, "title");
  if (typeof slug !== "string" || !slug.trim()) return undefined;
  if (typeof title !== "string" || !title.trim()) return undefined;

  const toStringArray = (input: unknown): string[] =>
    Array.isArray(input)
      ? input
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [];

  const summary = Reflect.get(articleValue, "summary");
  const abstract = Reflect.get(articleValue, "abstract");

  return {
    scope: "article",
    article: {
      slug: slug.trim(),
      title: title.trim(),
      categories: toStringArray(Reflect.get(articleValue, "categories")),
      summary: typeof summary === "string" ? summary.trim() : undefined,
      abstract: typeof abstract === "string" ? abstract.trim() : undefined,
      keyPoints: toStringArray(Reflect.get(articleValue, "keyPoints")),
      relatedSlugs: toStringArray(Reflect.get(articleValue, "relatedSlugs")),
    },
  };
}
