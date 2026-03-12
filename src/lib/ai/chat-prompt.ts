import { getChatPromptRuntimeConfig } from "@/lib/chat-prompts/config";
import { buildSystemPromptV1 } from "@/lib/chat-prompts/legacy-v1";
import {
  buildSystemPromptV2,
  type ArticleContext,
  type TweetContext,
  type ProjectContext,
} from "@/lib/chat-prompts";

export type { ArticleContext, TweetContext, ProjectContext };
export { buildSystemPromptV2 };

export function buildSystemPrompt(
  articles: ArticleContext[],
  tweets: TweetContext[] = [],
  userQuery = "",
  projects: ProjectContext[] = [],
): string {
  const config = getChatPromptRuntimeConfig();
  if (config.promptVersion === "v2") {
    return buildSystemPromptV2(articles, tweets, userQuery, projects);
  }
  return buildSystemPromptV1(articles, tweets);
}
