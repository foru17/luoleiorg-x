// AI 模块类型定义

/** AI API 配置 */
export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** Chat Completions 请求消息 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Chat Completions 响应 */
export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
    index: number;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** 文章摘要数据 */
export interface ArticleSummary {
  /** 一句话摘要（50-80字） */
  summary: string;
  /** 详细摘要（150-300字） */
  abstract: string;
  /** 结构化要点（3-6条），用于语义检索、RAG、推荐等系统能力 */
  keyPoints?: string[];
  /** 内容标签 */
  tags: string[];
  /** AI 预估阅读时间（分钟） */
  readingTime?: number;
}

/** 文章对话引导数据 */
export interface ArticleChatGuideGeneration {
  /** 弹窗或欢迎区的开场引导语 */
  openingLine: string;
  /** 当前文章优先展示的读者问题 */
  focusQuestions: string[];
  /** 顺着本文继续追问的方向 */
  extensionTopics: string[];
}

/** SEO 数据 */
export interface ArticleSeo {
  /** SEO meta description（120-160字） */
  metaDescription: string;
  /** SEO 关键词 */
  keywords: string[];
  /** 社交分享描述（60-100字） */
  ogDescription: string;
}

/** 缓存条目 */
export interface AICacheEntry<T> {
  data: T;
  contentHash: string;
  processedAt: string;
}

/** 缓存文件结构 */
export interface AICacheFile<T> {
  meta: {
    lastUpdated: string;
    model: string;
    totalProcessed: number;
  };
  articles: Record<string, AICacheEntry<T>>;
}

/** AI 任务接口 —— 所有任务模块实现此接口 */
export interface AITask<T> {
  name: string;
  cacheFile: string;
  buildPrompt(article: ArticleInput): {
    system: string;
    user: string;
  };
  parseResponse(raw: string): T;
}

/** 传入 AI 任务的文章数据 */
export interface ArticleInput {
  slug: string;
  title: string;
  categories: string[];
  content: string;
}
