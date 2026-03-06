import type { ArticleContext, PromptIntent, TweetContext } from "./types.ts";

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

function normalize(input: string): string {
  return input.trim().toLowerCase();
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

export function rankArticlesByIntent(params: {
  query: string;
  articles: ArticleContext[];
  enabled: boolean;
}): { intent: PromptIntent; rankedArticles: ArticleContext[] } {
  const { query, articles, enabled } = params;
  const intent = classifyIntent(query);

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
    .sort((a, b) => b.score - a.score || a.index - b.index)
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
