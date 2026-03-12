import { siteConfig } from "../site-config.ts";
import authorContextJson from "../../../data/author-context.json" with { type: "json" };
import factRegistryJson from "../../../data/fact-registry.json" with { type: "json" };
import type { ChatPromptRuntimeConfig } from "./config.ts";
import {
  rankArticlesByIntent,
  rankTweetsByIntent,
  resolveAnswerMode,
} from "./intent-ranking.ts";
import { fallbackResponseTemplates } from "./core-rules.ts";
import type {
  ArticleContext,
  PromptAnswerMode,
  ProjectContext,
  TweetContext,
} from "./types.ts";

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

interface StableFacts {
  focusAreas?: string[];
  recurringTopics?: string[];
  flagshipPosts?: Array<{
    title: string;
    date?: string;
    url: string;
  }>;
  publicPlatforms?: Array<{
    label: string;
    url: string;
  }>;
  contentFootprint?: {
    posts?: number;
    tweets?: number;
  };
}

interface TimelineFacts {
  latestPosts?: Array<{
    date?: string;
    title: string;
    url: string;
  }>;
  latestTweets?: Array<{
    date?: string;
    text: string;
    url: string;
  }>;
  careerMoments?: Array<{
    period?: string;
    title?: string;
    company?: string;
  }>;
}

interface StructuredEvidenceItem {
  title: string;
  date?: string;
  url: string;
}

interface StructuredCountFact {
  value: number;
  mode?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  sourceDate?: string;
}

interface StructuredTravelEntry {
  name: string;
  kind?: string;
  tripCount?: number;
  countMode?: string;
  firstMentionedAt?: string;
  latestMentionedAt?: string;
  evidence?: StructuredEvidenceItem[];
}

interface StructuredRaceEvent {
  name: string;
  date?: string;
  url: string;
  title?: string;
  eventType?: string;
  result?: string;
  sequenceNumber?: number;
  location?: string;
}

interface StructuredReadingRoundup {
  title: string;
  date?: string;
  url: string;
  bookCount?: number;
  books?: string[];
}

interface StructuredDevicePost {
  title: string;
  date?: string;
  url: string;
  category?: string;
}

interface StructuredFacts {
  travel?: {
    countries?: StructuredTravelEntry[];
    regions?: StructuredTravelEntry[];
  };
  races?: {
    totalMarathons?: StructuredCountFact;
    completedEvents?: StructuredRaceEvent[];
  };
  reading?: {
    lifetimeReadCount?: StructuredCountFact;
    roundupPosts?: StructuredReadingRoundup[];
  };
  devices?: {
    featuredPosts?: StructuredDevicePost[];
  };
}

interface AuthorContext {
  profile: AuthorProfile;
  experience: AuthorExperience[];
  skills: AuthorSkills;
  highlights: string[];
  projects?: AuthorProject[];
  publicActivities?: string[];
  stableFacts?: StableFacts;
  timelineFacts?: TimelineFacts;
  structuredFacts?: StructuredFacts;
}

const MAX_ARTICLE_SUMMARY_LENGTH = 140;
const MAX_ARTICLE_KEYPOINTS = 3;
const MAX_ARTICLE_KEYPOINT_LENGTH = 28;
const MAX_TWEET_TEXT_LENGTH = 140;
const MAX_STABLE_FACT_POSTS = 3;
const MAX_TIMELINE_POSTS = 3;
const MAX_TIMELINE_TWEETS = 4;
const MAX_CAREER_MOMENTS = 4;
const MAX_VERIFIED_READING_FACTS = 6;

interface FactRegistryEntry {
  fact_id: string;
  fact_type: string;
  category: string;
  value: string;
  confidence: string;
  review_status?: string;
  source_validation?: string;
  attributes: Record<string, unknown>;
}

interface FactRegistry {
  facts: FactRegistryEntry[];
}

function buildFactRegistrySection(): string {
  const registry = factRegistryJson as unknown as FactRegistry | null;
  if (!registry?.facts || registry.facts.length === 0) return "";

  const verifiedFacts = registry.facts.filter((f) => f.confidence === "verified");
  if (verifiedFacts.length === 0) return "";

  const travelFacts = verifiedFacts.filter((f) => f.category === "travel");
  const raceFacts = verifiedFacts.filter((f) => f.category === "race");
  const readingFacts = verifiedFacts
    .filter((f) => f.category === "reading")
    .sort((a, b) => {
      const aDate = typeof a.attributes.date === "string" ? a.attributes.date : "";
      const bDate = typeof b.attributes.date === "string" ? b.attributes.date : "";
      return bDate.localeCompare(aDate);
    });
  const isReadingDeviceFact = (fact: FactRegistryEntry) =>
    /kindle|paperwhite|电子书|阅读器/u.test(fact.value);
  const marathonFacts = raceFacts.filter((f) => {
    if (f.attributes.event_class === "marathon") return true;
    if (f.attributes.event_class === "non_marathon") return false;
    return /马拉松/u.test(f.value);
  });
  const otherRaceFacts = raceFacts.filter((f) => !marathonFacts.includes(f));
  const readingShareFacts = readingFacts.filter((f) => /读|书|书单/u.test(f.value) && !isReadingDeviceFact(f));
  const readingDeviceFacts = readingFacts.filter((f) => isReadingDeviceFact(f));

  const lines: string[] = [];

  // Travel
  const countries = travelFacts.filter((f) => f.attributes.kind === "country");
  const regions = travelFacts.filter((f) => f.attributes.kind === "region");
  if (countries.length > 0 || regions.length > 0) {
    lines.push("", "## 旅行经历（人工审核通过）");
    if (countries.length > 0) {
      const countryList = countries
        .map((c) => {
          const count = c.attributes.trip_count_min;
          const mode = c.attributes.count_mode;
          const suffix = typeof count === "number" && mode === "at_least" ? `（至少${count}次）` : "";
          return `${c.value}${suffix}`;
        })
        .join("、");
      lines.push(`- 海外目的地：${countryList}`);
    }
    if (regions.length > 0) {
      const regionList = regions.map((r) => r.value).join("、");
      lines.push(`- 港澳台地区：${regionList}`);
    }
  }

  // Races
  if (marathonFacts.length > 0) {
    lines.push("", "## 马拉松赛事记录（人工审核通过）");
    lines.push(`公开记录里至少完成 ${marathonFacts.length} 场全马：`);
    for (const race of marathonFacts) {
      const date = typeof race.attributes.date === "string" ? race.attributes.date : "未知";
      const result = typeof race.attributes.result === "string" ? `｜成绩：${race.attributes.result}` : "";
      lines.push(`- ${date}｜${race.value}${result}`);
    }
  }
  if (otherRaceFacts.length > 0) {
    lines.push("", "## 其他公开赛事");
    for (const race of otherRaceFacts) {
      const date = typeof race.attributes.date === "string" ? race.attributes.date : "未知";
      const result = typeof race.attributes.result === "string" ? `｜成绩：${race.attributes.result}` : "";
      lines.push(`- ${date}｜${race.value}${result}`);
    }
  }

  if (readingFacts.length > 0) {
    lines.push("", "## 阅读记录（人工审核通过）");
    if (readingShareFacts.length > 0) {
      const latestReadingDate =
        typeof readingShareFacts[0]?.attributes.date === "string"
          ? readingShareFacts[0].attributes.date
          : "未知";
      const earliestReadingDate =
        typeof readingShareFacts.at(-1)?.attributes.date === "string"
          ? readingShareFacts.at(-1)?.attributes.date
          : "未知";
      lines.push(
        `- 公开书单 / 读书分享至少从 ${earliestReadingDate} 持续到 ${latestReadingDate}，当前保留 ${readingShareFacts.length} 条人工审核通过记录。`,
      );
      for (const item of readingShareFacts.slice(0, MAX_VERIFIED_READING_FACTS)) {
        const date = typeof item.attributes.date === "string" ? item.attributes.date : "未知";
        const url = typeof item.attributes.url === "string" ? item.attributes.url : "";
        const bookCount =
          typeof item.attributes.book_count === "number" ? `（${item.attributes.book_count}本）` : "";
        lines.push(`- ${date}｜${item.value}${bookCount}${url ? `｜${url}` : ""}`);
      }
    }
    if (readingDeviceFacts.length > 0) {
      lines.push(
        `- 另有 ${readingDeviceFacts.length} 条阅读设备相关公开记录，可作为阅读习惯的辅助背景，不当作正式书单数量统计。`,
      );
    }
  }

  if (lines.length === 0) return "";
  return lines.join("\n");
}

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
    stableFacts: (context.stableFacts ?? {}) as StableFacts,
    timelineFacts: (context.timelineFacts ?? {}) as TimelineFacts,
    structuredFacts: (context.structuredFacts ?? {}) as StructuredFacts,
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

function normalizePublicActivity(activity: string): string {
  return activity
    .replace(/前端体验大会（腾讯主办）/u, "腾讯前端体验大会")
    .replace(/内部技术讲师/u, "内部技术分享讲师")
    .trim();
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

function buildStructuredFactsSection(): string {
  const factRegistrySection = buildFactRegistrySection();
  if (!factRegistrySection) return "";
  return [
    "---",
    "## 结构化事实索引（L3 validated_derived，辅助参考）",
    "以下数据来自离线抽取 + 人工审核。只有人工审核通过的事实会出现在这里。回答旅行、马拉松、读书等问题时，仍必须以 L1「相关文章 / 相关动态」和 L2「关于你 / 相关项目」中的公开信息为准；本节只作辅助索引。旅行次数不确定时，只说【有博客记录去过】或【至少去过】，不要编造精确数字。",
    factRegistrySection,
  ].join("\n");
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

  const highlightItems = ctx.highlights
    .map(markdownLinkToText)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const normalized = item.toLowerCase();
      return !config.sensitiveHighlightPatterns.some((pattern) => normalized.includes(pattern));
    })
    .slice(0, config.maxHighlights);

  const cooperationHighlights = highlightItems
    .filter((item) => /合作|全职机会|开放态度|欢迎合作/u.test(item))
    .map((item) => `- ${item}`);
  const highlights = highlightItems
    .filter((item) => !/合作|全职机会|开放态度|欢迎合作/u.test(item))
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
    .map((a) => `- ${normalizePublicActivity(a)}`);

  const stableFacts = ctx.stableFacts ?? {};
  const stableFactLines = [
    stableFacts.focusAreas?.length
      ? `- 重点方向：${stableFacts.focusAreas.slice(0, 5).join("、")}`
      : "",
    stableFacts.recurringTopics?.length
      ? `- 高频主题：${stableFacts.recurringTopics.slice(0, 8).join("、")}`
      : "",
    stableFacts.contentFootprint
      ? `- 内容规模：${stableFacts.contentFootprint.posts ?? 0} 篇文章 / ${stableFacts.contentFootprint.tweets ?? 0} 条动态`
      : "",
  ].filter(Boolean);

  const stableFactPostLines = (stableFacts.flagshipPosts ?? [])
    .slice(0, MAX_STABLE_FACT_POSTS)
    .map((post) => `- ${post.date || "日期未记录"}｜《${post.title}》｜${post.url}`);

  const timelineFacts = ctx.timelineFacts ?? {};
  const careerMomentLines = (timelineFacts.careerMoments ?? [])
    .slice(0, MAX_CAREER_MOMENTS)
    .map((item) => {
      const period = item.period || "时间未记录";
      const title = item.title || "角色未记录";
      const company = item.company || "机构未记录";
      return `- ${period}｜${company}｜${title}`;
    });
  const latestPostLines = (timelineFacts.latestPosts ?? [])
    .slice(0, MAX_TIMELINE_POSTS)
    .map((post) => `- 文章：${post.date || "日期未记录"}｜《${post.title}》｜${post.url}`);
  const latestTweetLines = (timelineFacts.latestTweets ?? [])
    .slice(0, MAX_TIMELINE_TWEETS)
    .map((tweet) => `- 动态：${tweet.date || "日期未记录"}｜${truncateText(tweet.text, 64)}｜${tweet.url}`);

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
    ...(cooperationHighlights.length > 0
      ? ["", "## 合作状态", ...cooperationHighlights]
      : []),
    ...(stableFactLines.length > 0 || stableFactPostLines.length > 0
      ? ["", "## 长期公开主线", ...stableFactLines, ...stableFactPostLines]
      : []),
    ...(careerMomentLines.length > 0 || latestPostLines.length > 0 || latestTweetLines.length > 0
      ? ["", "## 时间线与近期公开动态", ...careerMomentLines, ...latestPostLines, ...latestTweetLines]
      : []),
    ...(activityLines.length > 0 ? ["", "## 公开活动", ...activityLines] : []),
    "",
    buildStructuredFactsSection(),
  ].join("\n");
}

function formatArticleSection(articles: ArticleContext[], maxCount: number): string {
  if (articles.length === 0) {
    return [
      `来源层级：L1 authored_public（原始博客公开内容，事实优先级最高）`,
      `（${fallbackResponseTemplates.emptySearch}）`,
    ].join("\n");
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

  return [
    `来源层级：L1 authored_public（原始博客公开内容，事实优先级最高）`,
    totalLine,
    ...lines,
  ].join("\n");
}

function formatTweetSection(tweets: TweetContext[], maxCount: number): string {
  if (tweets.length === 0) {
    return [
      `来源层级：L1 authored_public（原始公开动态，可直接作为事实依据）`,
      `（${fallbackResponseTemplates.emptySearch}）`,
    ].join("\n");
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

  return [
    `来源层级：L1 authored_public（原始公开动态，可直接作为事实依据）`,
    totalLine,
    ...lines,
  ].join("\n");
}

function formatProjectSection(projects: ProjectContext[]): string {
  if (projects.length === 0) {
    return [`来源层级：L2 curated_public（公开项目 / 履历档案）`, `（${fallbackResponseTemplates.emptySearch}）`].join("\n");
  }

  const lines = projects.map((project, index) => {
    return [
      `${index + 1}. ${project.name} | ${project.url}`,
      `   描述：${project.description}`,
    ].join("\n");
  });

  return [
    `来源层级：L2 curated_public（公开项目 / 履历档案）`,
    `检索命中：共 ${projects.length} 个项目/经历。`,
    ...lines,
  ].join("\n");
}

function buildAnswerModeHint(answerMode: PromptAnswerMode): string {
  switch (answerMode) {
    case "list":
      return "直接给 2-6 个同一维度的条目；如果是国家/项目/文章，优先列点或短列表。";
    case "count":
      return "第一句先给数字结论；若证据不完整，用“至少 / 大概 / 有公开记录”而不是伪精确。";
    case "timeline":
      return "按时间顺序回答，优先写年份、阶段或“先…后来…现在…”这类时间锚点。";
    case "opinion":
      return "先明确给出个人判断，再用 2-3 个明确观点展开；尽量沿用证据里的关键词，必要时直接用“效率提升 / 工程能力 / 架构判断”这类维度。";
    case "recommendation":
      return "先推荐 2-4 个具体项目/文章，再各用一句说明为什么适合先看。";
    case "unknown":
      return "第一句必须明确说未公开 / 不提供 / 不方便透露；1-2 句内收尾，不补充背景或隐私线索。";
    case "fact":
    default:
      return "先一句结论，再补 1-2 句依据；如果某篇文章/动态直接对应问题，顺手带出标题或 Markdown 链接；不需要强行展开成长列表或时间线。";
  }
}

export function buildRuntimeContext(params: {
  articles: ArticleContext[];
  tweets: TweetContext[];
  projects?: ProjectContext[];
  userQuery: string;
  config: ChatPromptRuntimeConfig;
}): string {
  const { articles, tweets, projects = [], userQuery, config } = params;

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
  const answerMode = resolveAnswerMode(userQuery);

  const authorBio = buildAuthorBio(config);
  const articleSection = formatArticleSection(rankedArticles, config.maxArticlesInPrompt);
  const tweetSection = formatTweetSection(rankedTweets, config.maxTweetsInPrompt);
  const projectSection = formatProjectSection(projects);

  const sections = [
    `## 关于你（L2 curated_public）`,
    authorBio,
    ``,
    `## 运行时上下文`,
    `- 用户问题：${userQuery || "（未提供）"}`,
    `- 识别意图：${intent}`,
    `- 预期回答模式：${answerMode}`,
    `- 模式提示：${buildAnswerModeHint(answerMode)}`,
    `- 来源优先级：L1 相关文章/相关动态 > L2 关于你/相关项目 > L3 结构化事实索引 > L5 语言风格`,
    `- 引用约束：你只能引用下列列表中的完整 URL。`,
    ``,
    `## 相关文章（博客，L1 authored_public）`,
    articleSection,
    ``,
    `## 相关动态（X，L1 authored_public）`,
    tweetSection,
  ];

  // 只在有项目结果时才添加项目部分
  if (projects.length > 0) {
    sections.push(``, `## 相关项目/经历（L2 curated_public）`, projectSection);
  }

  return sections.join("\n");
}
