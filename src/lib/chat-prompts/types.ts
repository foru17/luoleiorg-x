export interface ArticleContext {
  title: string;
  url: string;
  summary: string;
  keyPoints: string[];
  categories: string[];
  dateTime?: number;
  fullContent?: string;
}

export interface TweetContext {
  title: string;
  url: string;
  text: string;
  date: string;
  dateTime?: number;
}

export interface ProjectContext {
  name: string;
  url: string;
  description: string;
}

export type PromptVersion = "v1" | "v2";

export type PromptIntent =
  | "ai_rag"
  | "indie_dev"
  | "devops_homelab"
  | "frontend_fullstack"
  | "photo_travel"
  | "lifestyle"
  | "unknown";

export type VoiceStyleMode =
  | "technical"
  | "travel"
  | "life"
  | "recommendation";

export type PromptAnswerMode =
  | "fact"
  | "list"
  | "count"
  | "timeline"
  | "opinion"
  | "recommendation"
  | "unknown";
