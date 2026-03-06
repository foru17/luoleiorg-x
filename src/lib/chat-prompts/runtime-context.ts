import { siteConfig } from "../site-config";
import authorContextJson from "../../../data/author-context.json";
import type { ChatPromptRuntimeConfig } from "./config.ts";
import { rankArticlesByIntent, rankTweetsByIntent } from "./intent-ranking.ts";
import { fallbackResponseTemplates } from "./core-rules.ts";
import type { ArticleContext, TweetContext } from "./types.ts";

interface AuthorProfile {
  name: string;
  headline: string;
  location: string;
  social: {
    github?: string;
    x?: string;
    youtube?: string;
    bilibili?: string;
    blog?: string;
    instagram?: string;
    unsplash?: string;
    telegram?: string;
    linkedin?: string;
    email?: string;
  };
}

interface AuthorExperience {
  title: string;
  company: string;
  period: string;
  description: string;
}

interface AuthorSkills {
  frontend?: string[];
  backend?: string[];
  devops?: string[];
  tools?: string[];
  design?: string[];
}

interface AuthorProject {
  name: string;
  url: string;
  description: string;
}

interface AuthorContext {
  profile: AuthorProfile;
  experience: AuthorExperience[];
  skills: AuthorSkills;
  highlights: string[];
  projects?: AuthorProject[];
  publicActivities?: string[];
}

const MAX_ARTICLE_SUMMARY_LENGTH = 140;
const MAX_ARTICLE_KEYPOINTS = 3;
const MAX_ARTICLE_KEYPOINT_LENGTH = 28;
const MAX_TWEET_TEXT_LENGTH = 140;

function toAuthorContext(): AuthorContext | null {
  const data = authorContextJson as unknown;
  if (!data || typeof data !== "object") return null;
  const context = data as Partial<AuthorContext>;
  if (!context.profile || !Array.isArray(context.experience)) {
    return null;
  }
  return {
    profile: context.profile as AuthorProfile,
    experience: Array.isArray(context.experience) ? context.experience : [],
    skills: (context.skills ?? {}) as AuthorSkills,
    highlights: Array.isArray(context.highlights) ? context.highlights : [],
    projects: Array.isArray(context.projects) ? context.projects as AuthorProject[] : [],
    publicActivities: Array.isArray(context.publicActivities) ? context.publicActivities : [],
  };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeCompanyName(company: string): string {
  if (company === "Independent" || company === "独立") {
    return "独立开发者";
  }
  return company;
}

function trimDescription(description: string, maxLength = 72): string {
  const normalized = description
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";

  const breakIndexes: number[] = [];
  for (const token of ["。", "；", ";", "！", "？", "!", "?"]) {
    const idx = normalized.indexOf(token);
    if (idx > 0) breakIndexes.push(idx);
  }

  const periodWithSpace = normalized.match(/\.\s/);
  if (periodWithSpace?.index && periodWithSpace.index > 0) {
    breakIndexes.push(periodWithSpace.index);
  }

  const firstBreak =
    breakIndexes.length > 0 ? Math.min(...breakIndexes) : normalized.length;
  const firstClause = normalized.slice(0, firstBreak).trim();
  if (!firstClause) return truncateText(normalized, maxLength);
  return truncateText(firstClause, maxLength);
}

function formatExperience(exp: AuthorExperience): string {
  const company = normalizeCompanyName(exp.company || "-");
  const period = exp.period || "时间未记录";
  const title = exp.title || "职位未记录";
  const description = trimDescription(exp.description || "");
  return description
    ? `- ${period}｜${company}｜${title}。${description}`
    : `- ${period}｜${company}｜${title}`;
}

function cleanupLocation(location: string): string {
  return location
    .replace(", China", "")
    .replace("，中国", "")
    .trim();
}

function markdownLinkToText(input: string): string {
  return input.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
}

function buildSocialLinks(profile: AuthorProfile, maxSocialLinks: number): string[] {
  const sources: Array<{ label: string; value?: string }> = [
    { label: "博客", value: profile.social.blog || siteConfig.siteUrl },
    { label: "GitHub", value: profile.social.github },
    { label: "X", value: profile.social.x },
    { label: "Unsplash", value: profile.social.unsplash },
    { label: "YouTube", value: profile.social.youtube },
    { label: "Bilibili", value: profile.social.bilibili },
    { label: "LinkedIn", value: profile.social.linkedin },
    { label: "Telegram", value: profile.social.telegram },
    { label: "邮箱", value: profile.social.email },
  ];

  const links: string[] = [];
  for (const source of sources) {
    if (!source.value) continue;
    const value = source.label === "邮箱" ? source.value : source.value.trim();
    links.push(`- ${source.label}：${value}`);
    if (links.length >= maxSocialLinks) {
      break;
    }
  }
  return links;
}

function buildAuthorBio(config: ChatPromptRuntimeConfig): string {
  const ctx = toAuthorContext();
  if (!ctx) {
    return [
      "- 身份：全栈开发者、独立开发者、内容创作者",
      "- 坐标：深圳",
      `- 博客：${siteConfig.siteUrl}`,
    ].join("\n");
  }

  const identityLine = truncateText(ctx.profile.headline || "全栈开发者", 30);
  const location = cleanupLocation(ctx.profile.location || "深圳");
  const socialLines = buildSocialLinks(ctx.profile, config.maxSocialLinks);
  const experience =
    config.maxExperienceLines && config.maxExperienceLines > 0
      ? ctx.experience.slice(0, config.maxExperienceLines)
      : ctx.experience;

  const experienceLines = experience.map(formatExperience);

  const highlights = ctx.highlights
    .map(markdownLinkToText)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const normalized = item.toLowerCase();
      return !config.sensitiveHighlightPatterns.some((pattern) => normalized.includes(pattern));
    })
    .slice(0, config.maxHighlights)
    .map((item) => `- ${item}`);

  const skillGroups = [
    ["前端", ctx.skills.frontend ?? [], 6],
    ["后端", ctx.skills.backend ?? [], 6],
    ["DevOps", ctx.skills.devops ?? [], 6],
    ["AI/工具", ctx.skills.tools ?? [], 6],
  ] as const;

  const skillLines = skillGroups
    .filter(([, list]) => list.length > 0)
    .map(([label, list, max]) => `- ${label}：${list.slice(0, max).join("、")}`);

  const projectLines = (ctx.projects ?? [])
    .slice(0, 3)
    .map((p) => `- [${p.name}](${p.url})：${truncateText(p.description, 60)}`);

  const activityLines = (ctx.publicActivities ?? [])
    .slice(0, 3)
    .map((a) => `- ${a}`);

  return [
    `- 身份：${identityLine}`,
    `- 坐标：${location}`,
    ...socialLines,
    "",
    "## 精选项目（最新）",
    ...(projectLines.length > 0 ? projectLines : ["- 暂无公开记录"]),
    "",
    "## 工作经历",
    ...(experienceLines.length > 0 ? experienceLines : ["- 暂无公开记录"]),
    "",
    "## 技能栈",
    ...(skillLines.length > 0 ? skillLines : ["- 暂无公开记录"]),
    "",
    "## 亮点",
    ...(highlights.length > 0 ? highlights : ["- 暂无公开记录"]),
    ...(activityLines.length > 0 ? ["", "## 公开活动", ...activityLines] : []),
  ].join("\n");
}

function formatArticleSection(articles: ArticleContext[], maxCount: number): string {
  if (articles.length === 0) {
    return `（${fallbackResponseTemplates.emptySearch}）`;
  }

  const selected = articles.slice(0, maxCount);
  const omitted = Math.max(0, articles.length - selected.length);
  const totalLine = `检索命中：共 ${articles.length} 篇，当前展示 ${selected.length} 篇。`;
  const lines = selected.map((article, index) => {
    const summary = truncateText(article.summary, MAX_ARTICLE_SUMMARY_LENGTH);
    const keyPoints = article.keyPoints
      .slice(0, MAX_ARTICLE_KEYPOINTS)
      .map((point) => truncateText(point, MAX_ARTICLE_KEYPOINT_LENGTH))
      .join("；");

    const parts = [
      `${index + 1}. 《${article.title}》 | ${article.url}`,
      `   摘要：${summary}`,
      keyPoints ? `   要点：${keyPoints}` : "",
      article.fullContent ? `   全文节选：${article.fullContent}` : "",
    ];

    return parts.filter(Boolean).join("\n");
  });

  if (omitted > 0) {
    lines.push(`（另有 ${omitted} 篇已省略）`);
  }

  return [totalLine, ...lines].join("\n");
}

function formatTweetSection(tweets: TweetContext[], maxCount: number): string {
  if (tweets.length === 0) {
    return `（${fallbackResponseTemplates.emptySearch}）`;
  }

  const selected = tweets.slice(0, maxCount);
  const omitted = Math.max(0, tweets.length - selected.length);
  const totalLine = `检索命中：共 ${tweets.length} 条，当前展示 ${selected.length} 条。`;
  const lines = selected.map((tweet, index) => {
    const content = truncateText(tweet.text, MAX_TWEET_TEXT_LENGTH);
    return [
      `${index + 1}. ${tweet.title} | ${tweet.url}`,
      `   内容：${content}`,
      `   日期：${tweet.date}`,
    ].join("\n");
  });

  if (omitted > 0) {
    lines.push(`（另有 ${omitted} 条已省略）`);
  }

  return [totalLine, ...lines].join("\n");
}

export function buildRuntimeContext(params: {
  articles: ArticleContext[];
  tweets: TweetContext[];
  userQuery: string;
  config: ChatPromptRuntimeConfig;
}): string {
  const { articles, tweets, userQuery, config } = params;

  const { intent, rankedArticles } = rankArticlesByIntent({
    query: userQuery,
    articles,
    enabled: config.enableIntentRanking,
  });

  const rankedTweets = rankTweetsByIntent({
    query: userQuery,
    tweets,
    intent,
    enabled: config.enableIntentRanking,
  });

  const authorBio = buildAuthorBio(config);
  const articleSection = formatArticleSection(rankedArticles, config.maxArticlesInPrompt);
  const tweetSection = formatTweetSection(rankedTweets, config.maxTweetsInPrompt);

  return `## 关于你
${authorBio}

## 运行时上下文
- 用户问题：${userQuery || "（未提供）"}
- 识别意图：${intent}
- 引用约束：你只能引用下列列表中的完整 URL。

## 相关文章（博客）
${articleSection}

## 相关动态（X）
${tweetSection}`;
}
