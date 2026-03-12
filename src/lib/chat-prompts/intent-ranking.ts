import type {
  ArticleContext,
  PromptAnswerMode,
  PromptIntent,
  TweetContext,
  VoiceStyleMode,
} from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const INTENT_KEYWORDS: Record<Exclude<PromptIntent, "unknown">, string[]> = {
  ai_rag: [
    "ai",
    "rag",
    "embedding",
    "agent",
    "llm",
    "prompt",
    "数字分身",
    "分身",
    "向量",
    "大模型",
    "claude",
    "gpt",
    "kimi",
    "vercel ai",
  ],
  indie_dev: [
    "neko",
    "neko master",
    "vibe coding",
    "vibe",
    "出海",
    "独立开发",
    "开源",
    "stars",
    "star",
    "raycast",
    "raycast插件",
    "side project",
    "项目",
    "开源项目",
    "nestjs",
    "graphql",
    "clickhouse",
    "prisma",
    "postgresql",
  ],
  devops_homelab: [
    "docker",
    "k8s",
    "kubernetes",
    "nginx",
    "wrangler",
    "cloudflare",
    "openwrt",
    "prometheus",
    "homelab",
    "家庭实验室",
    "路由",
    "openclash",
    "流量",
  ],
  frontend_fullstack: [
    "nextjs",
    "next.js",
    "react",
    "typescript",
    "ts",
    "seo",
    "vitepress",
    "vinext",
    "前端",
    "全栈",
    "workers",
    "cloudflare workers",
  ],
  photo_travel: [
    "摄影",
    "旅行",
    "东京",
    "香港",
    "京都",
    "unsplash",
    "马拉松",
    "run",
    "travel",
    "photo",
    "跑步",
    "潜水",
    "骑行",
  ],
  lifestyle: [
    "生活",
    "消费",
    "眼镜",
    "医院",
    "体验",
    "套餐",
    "投资",
    "健康",
    "lifestyle",
    "装备",
    "数码",
    "主机",
  ],
};

const RECOMMENDATION_PATTERNS = [
  /推荐/,
  /建议/,
  /先读/,
  /先看/,
  /值得看/,
  /值得读/,
  /入门/,
  /怎么选/,
  /看什么/,
  /哪篇/,
  /哪几篇/,
  /哪些文章/,
  /哪些内容/,
  /适合/,
  /有没有.*推荐/,
  /recommend/,
  /suggest/,
  /what should i read/,
];

const VOICE_STYLE_BY_INTENT: Partial<Record<PromptIntent, VoiceStyleMode>> = {
  ai_rag: "technical",
  indie_dev: "technical",
  devops_homelab: "technical",
  frontend_fullstack: "technical",
  photo_travel: "travel",
  lifestyle: "life",
};

const PRIVACY_PATTERNS = [
  /赚多少钱/u,
  /收入/u,
  /工资/u,
  /老婆叫(什么|啥)/u,
  /家人叫(什么|啥)/u,
  /具体住在哪/u,
  /哪个小区/u,
  /门牌/u,
  /具体地址/u,
  /家庭住址/u,
  /联系方式/u,
  /手机号/u,
];

const OPINION_PATTERNS = [
  /怎么看/u,
  /怎么想/u,
  /看法/u,
  /觉得/u,
  /影响/u,
  /判断/u,
  /认不认同/u,
  /值不值得/u,
  /本质上/u,
  /怎么把.*用到/u,
  /如何把.*用到/u,
];

const TIMELINE_PATTERNS = [
  /过去.*公司/u,
  /都在哪些公司/u,
  /怎么转成/u,
  /怎么成为/u,
  /长期/u,
  /一路/u,
  /经历/u,
  /历程/u,
  /时间线/u,
  /先后/u,
  /从.*到.*再到/u,
  /(最近|最新).*(哪一场|哪篇|是哪)/u,
];

const COUNT_PATTERNS = [
  /几次/u,
  /几场/u,
  /几篇/u,
  /多少场/u,
  /多少次/u,
  /多少篇/u,
  /一共/u,
  /总共/u,
  /至少.*(几|多少)/u,
  /跑过多少/u,
  /去过多少/u,
];

const LIST_PATTERNS = [
  /哪些/u,
  /哪几/u,
  /哪几个/u,
  /什么类型/u,
  /列一下/u,
  /有哪些/u,
  /去过哪些国家/u,
  /做过哪些/u,
];

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

function hasRecencyIntent(query: string): boolean {
  const normalized = normalize(query);
  return /最近|最新|最近一次|最近一篇|最新一篇|最近写|最新写|最近公开|最新公开/.test(
    normalized,
  );
}

export function hasRecommendationIntent(query: string): boolean {
  const normalized = normalize(query);
  if (!normalized) return false;
  return RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasPrivacyNoAnswerIntent(query: string): boolean {
  const normalized = normalize(query);
  if (!normalized) return false;
  return PRIVACY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasOpinionIntent(query: string): boolean {
  const normalized = normalize(query);
  if (!normalized) return false;
  return OPINION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasTimelineIntent(query: string): boolean {
  const normalized = normalize(query);
  if (!normalized) return false;
  return TIMELINE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasCountIntent(query: string): boolean {
  const normalized = normalize(query);
  if (!normalized) return false;
  return COUNT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasListIntent(query: string): boolean {
  const normalized = normalize(query);
  if (!normalized) return false;
  return LIST_PATTERNS.some((pattern) => pattern.test(normalized));
}

function countKeywordHits(text: string, keywords: string[]): number {
  if (!text) return 0;
  const normalized = normalize(text);
  let hits = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

function isRecent(dateTime: number | undefined): boolean {
  if (!Number.isFinite(dateTime)) return false;
  const now = Date.now();
  return now - (dateTime as number) <= 365 * DAY_MS;
}

export function classifyIntent(query: string): PromptIntent {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return "unknown";

  let bestIntent: PromptIntent = "unknown";
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as Array<[
    Exclude<PromptIntent, "unknown">,
    string[],
  ]>) {
    const score = countKeywordHits(normalizedQuery, keywords);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  return bestScore > 0 ? bestIntent : "unknown";
}

export function resolveVoiceStyleMode(query: string): VoiceStyleMode | null {
  if (!query.trim()) return null;
  if (hasRecommendationIntent(query)) {
    return "recommendation";
  }

  const intent = classifyIntent(query);
  return VOICE_STYLE_BY_INTENT[intent] ?? null;
}

export function resolveAnswerMode(query: string): PromptAnswerMode {
  if (!query.trim()) return "fact";
  if (hasPrivacyNoAnswerIntent(query)) {
    return "unknown";
  }
  if (hasRecommendationIntent(query)) {
    return "recommendation";
  }
  if (hasOpinionIntent(query)) {
    return "opinion";
  }
  if (hasTimelineIntent(query)) {
    return "timeline";
  }
  if (hasCountIntent(query)) {
    return "count";
  }
  if (hasListIntent(query)) {
    return "list";
  }
  return "fact";
}

export function rankArticlesByIntent(params: {
  query: string;
  articles: ArticleContext[];
  enabled: boolean;
}): { intent: PromptIntent; rankedArticles: ArticleContext[] } {
  const { query, articles, enabled } = params;
  const intent = classifyIntent(query);
  const recencyIntent = hasRecencyIntent(query);

  if (!enabled || intent === "unknown") {
    return {
      intent,
      rankedArticles: articles,
    };
  }

  const keywords = INTENT_KEYWORDS[intent];
  const scored = articles.map((article, index) => {
    const titleHit = countKeywordHits(article.title, keywords) > 0 ? 3 : 0;
    const categoryHit =
      article.categories.some((category) => countKeywordHits(category, keywords) > 0)
        ? 2
        : 0;
    const summaryHit = countKeywordHits(article.summary, keywords) > 0 ? 2 : 0;
    const keyPointHit =
      article.keyPoints.some((keyPoint) => countKeywordHits(keyPoint, keywords) > 0)
        ? 1
        : 0;
    const recentHit = isRecent(article.dateTime) ? 1 : 0;

    return {
      article,
      index,
      score: titleHit + categoryHit + summaryHit + keyPointHit + recentHit,
    };
  });

  const maxScore = Math.max(...scored.map((item) => item.score), 0);
  if (maxScore === 0) {
    return {
      intent,
      rankedArticles: articles,
    };
  }

  const rankedArticles = scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        (recencyIntent
          ? (b.article.dateTime ?? 0) - (a.article.dateTime ?? 0)
          : 0) ||
        a.index - b.index,
    )
    .map((item) => item.article);

  return {
    intent,
    rankedArticles,
  };
}

export function rankTweetsByIntent(params: {
  query: string;
  tweets: TweetContext[];
  intent: PromptIntent;
  enabled: boolean;
}): TweetContext[] {
  const { query, tweets, intent, enabled } = params;
  if (!enabled || intent === "unknown") {
    return tweets;
  }

  const keywords = INTENT_KEYWORDS[intent];
  const normalizedQuery = normalize(query);

  const scored = tweets.map((tweet, index) => {
    const titleHit = countKeywordHits(tweet.title, keywords) > 0 ? 3 : 0;
    const textHit = countKeywordHits(tweet.text, keywords) > 0 ? 2 : 0;
    const queryHit = countKeywordHits(tweet.text, [normalizedQuery]) > 0 ? 1 : 0;
    const recentHit = isRecent(tweet.dateTime) ? 1 : 0;

    return {
      tweet,
      index,
      score: titleHit + textHit + queryHit + recentHit,
    };
  });

  const maxScore = Math.max(...scored.map((item) => item.score), 0);
  if (maxScore === 0) {
    return tweets;
  }

  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.tweet);
}
