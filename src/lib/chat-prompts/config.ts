import type { PromptVersion } from "./types.ts";

const DEFAULT_MAX_ARTICLES_IN_PROMPT = 10;
const DEFAULT_MAX_TWEETS_IN_PROMPT = 8;
const DEFAULT_MAX_SOCIAL_LINKS = 4;
const DEFAULT_MAX_HIGHLIGHTS = 7;

function parseIntEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseOptionalIntEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseListEnv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const list = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

export interface ChatPromptRuntimeConfig {
  promptVersion: PromptVersion;
  maxExperienceLines?: number;
  maxSocialLinks: number;
  maxHighlights: number;
  maxArticlesInPrompt: number;
  maxTweetsInPrompt: number;
  enableIntentRanking: boolean;
  sensitiveHighlightPatterns: string[];
}

export function getChatPromptRuntimeConfig(): ChatPromptRuntimeConfig {
  const versionRaw = (process.env.CHAT_PROMPT_VERSION || "v2").trim().toLowerCase();
  const promptVersion: PromptVersion = versionRaw === "v1" ? "v1" : "v2";

  return {
    promptVersion,
    maxExperienceLines: parseOptionalIntEnv(process.env.MAX_EXPERIENCE_LINES),
    maxSocialLinks: parseIntEnv(process.env.MAX_SOCIAL_LINKS, DEFAULT_MAX_SOCIAL_LINKS),
    maxHighlights: parseIntEnv(process.env.MAX_HIGHLIGHTS, DEFAULT_MAX_HIGHLIGHTS),
    maxArticlesInPrompt: parseIntEnv(process.env.MAX_ARTICLES_IN_PROMPT, DEFAULT_MAX_ARTICLES_IN_PROMPT),
    maxTweetsInPrompt: parseIntEnv(process.env.MAX_TWEETS_IN_PROMPT, DEFAULT_MAX_TWEETS_IN_PROMPT),
    enableIntentRanking: parseBooleanEnv(process.env.ENABLE_INTENT_RANKING, true),
    sensitiveHighlightPatterns: parseListEnv(
      process.env.SENSITIVE_HIGHLIGHT_PATTERNS,
      [],
    ),
  };
}
