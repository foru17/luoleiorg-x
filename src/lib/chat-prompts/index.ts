import { getChatPromptRuntimeConfig } from "./config.ts";
import { buildCoreIdentity } from "./core-identity.ts";
import { buildCoreRules } from "./core-rules.ts";
import { buildRuntimeContext } from "./runtime-context.ts";
import type {
  ArticleContext,
  TweetContext,
  ProjectContext,
  CurrentArticleContext,
} from "./types.ts";

export type { ArticleContext, TweetContext, ProjectContext, CurrentArticleContext } from "./types";
export { fallbackResponseTemplates } from "./core-rules";

export function buildSystemPromptV2(
  articles: ArticleContext[],
  tweets: TweetContext[] = [],
  userQuery = "",
  projects: ProjectContext[] = [],
  currentArticle?: CurrentArticleContext,
): string {
  const config = getChatPromptRuntimeConfig();
  const identity = buildCoreIdentity(userQuery);
  const rules = buildCoreRules();
  const runtime = buildRuntimeContext({
    articles,
    tweets,
    projects,
    userQuery,
    config,
    currentArticle,
  });

  return `${identity}\n\n${rules}\n\n${runtime}`;
}
