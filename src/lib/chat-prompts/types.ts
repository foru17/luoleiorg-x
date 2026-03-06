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

export type PromptVersion = "v1" | "v2";

export type PromptIntent =
  | "ai_rag"
  | "indie_dev"
  | "devops_homelab"
  | "frontend_fullstack"
  | "photo_travel"
  | "lifestyle"
  | "unknown";
