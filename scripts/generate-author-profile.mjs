/**
 * 生成 About 页面作者画像报告
 *
 * 用法:
 *   node scripts/generate-author-profile.mjs
 *   node scripts/generate-author-profile.mjs --no-ai
 *   node scripts/generate-author-profile.mjs --force
 */

import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

const SCRIPT_DIR = import.meta.dirname;
const ROOT_DIR = path.join(SCRIPT_DIR, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const POSTS_DIR = path.join(ROOT_DIR, "content", "posts");
const OUTPUT_REPORT = path.join(DATA_DIR, "author-profile-report.json");
const OUTPUT_CONTEXT = path.join(DATA_DIR, "author-profile-context.json");

const DEFAULT_SITE_URL = "https://luolei.org";
const DEFAULT_USERNAME = "luoleiorg";

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    force: args.includes("--force"),
    noAI: args.includes("--no-ai"),
  };
}

async function loadEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  try {
    const content = await fs.readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore missing .env
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function toSlug(relativePath) {
  return relativePath.replace(/\\/g, "/").replace(/\.md$/, "").replace(/\//g, "-");
}

function toUrl(siteUrl, slug) {
  return `${siteUrl.replace(/\/$/, "")}/${slug}`;
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/[#>*_\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max = 120) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

async function loadPosts(siteUrl) {
  const files = await collectMarkdownFiles(POSTS_DIR);
  const aiSummaries = await readJson(path.join(DATA_DIR, "ai-summaries.json"), {
    articles: {},
  });

  const posts = [];
  for (const filePath of files) {
    const relative = path.relative(POSTS_DIR, filePath);
    const slug = toSlug(relative);
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data ?? {};
    if (!data.title || !data.date || data.hide) continue;

    const summaryEntry = aiSummaries?.articles?.[slug]?.data ?? null;
    const plainContent = stripMarkdown(parsed.content);

    posts.push({
      slug,
      title: String(data.title),
      date: String(data.date),
      categories: Array.isArray(data.categories)
        ? data.categories.map((item) => String(item))
        : [],
      url: toUrl(siteUrl, slug),
      summary: summaryEntry?.summary ?? truncate(plainContent, 100),
      keyPoints: Array.isArray(summaryEntry?.keyPoints)
        ? summaryEntry.keyPoints
        : [],
    });
  }

  posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return posts;
}

function normalizeAuthorTweetsCache(payload) {
  if (!payload?.tweets || !Array.isArray(payload.tweets)) return [];
  const username = payload?.meta?.username ?? DEFAULT_USERNAME;
  return payload.tweets.map((tweet) => ({
    id: tweet.id,
    text: tweet.text ?? "",
    date: tweet.created_at ?? "",
    username,
    metrics: tweet.public_metrics ?? null,
    url: `https://x.com/${username}/status/${tweet.id}`,
  }));
}

function normalizeTweetCardCache(payload) {
  const map = payload?.tweets ?? {};
  return Object.values(map)
    .filter((tweet) => tweet?.author?.username === DEFAULT_USERNAME)
    .map((tweet) => ({
      id: tweet.id,
      text: tweet.text ?? "",
      date: tweet.created_at ?? "",
      username: tweet.author?.username ?? DEFAULT_USERNAME,
      metrics: tweet.public_metrics ?? null,
      url: `https://x.com/${tweet.author?.username ?? DEFAULT_USERNAME}/status/${tweet.id}`,
    }));
}

function tweetScore(tweet) {
  const metrics = tweet.metrics ?? {};
  const likes = Number(metrics.like_count ?? 0);
  const bookmarks = Number(metrics.bookmark_count ?? 0);
  const retweets = Number(metrics.retweet_count ?? 0);
  const replies = Number(metrics.reply_count ?? 0);
  const quotes = Number(metrics.quote_count ?? 0);
  return likes + bookmarks * 1.5 + retweets * 1.8 + replies + quotes * 1.2;
}

async function loadTweets() {
  const authorCache = await readJson(
    path.join(DATA_DIR, "author-tweets-cache.json"),
    null,
  );
  if (authorCache?.tweets?.length) {
    return {
      source: "author-tweets-cache",
      tweets: normalizeAuthorTweetsCache(authorCache),
    };
  }

  const tweetCardCache = await readJson(path.join(DATA_DIR, "tweets-cache.json"), {
    tweets: {},
  });
  return {
    source: "tweets-cache",
    tweets: normalizeTweetCardCache(tweetCardCache),
  };
}

async function loadGithubResume() {
  return readJson(path.join(DATA_DIR, "github-resume.json"), {
    profile: {},
    highlights: [],
    experience: [],
    projects: [],
  });
}

function buildContext({ posts, tweets, githubResume, siteUrl, tweetSource }) {
  const selectedPosts = posts.slice(0, 12);
  const selectedTweets = [...tweets]
    .sort((a, b) => tweetScore(b) - tweetScore(a))
    .slice(0, 8);
  const selectedProjects = Array.isArray(githubResume.projects)
    ? githubResume.projects.slice(0, 8)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    siteUrl,
    sourceInfo: {
      posts: selectedPosts.length,
      tweets: selectedTweets.length,
      projects: selectedProjects.length,
      tweetSource,
    },
    profile: githubResume.profile ?? {},
    highlights: Array.isArray(githubResume.highlights)
      ? githubResume.highlights
      : [],
    experience: Array.isArray(githubResume.experience)
      ? githubResume.experience
      : [],
    posts: selectedPosts.map((post) => ({
      title: post.title,
      date: post.date,
      categories: post.categories,
      summary: post.summary,
      keyPoints: post.keyPoints,
      url: post.url,
    })),
    tweets: selectedTweets.map((tweet) => ({
      id: tweet.id,
      text: tweet.text,
      date: tweet.date,
      url: tweet.url,
      metrics: tweet.metrics,
    })),
    projects: selectedProjects,
  };
}

async function callAI({ baseUrl, apiKey, model, messages }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 2800,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI API 失败: ${response.status} ${text.slice(0, 300)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI 返回空内容");
  }
  return content;
}

function parseJsonText(text) {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (match?.[1] ?? text).trim();
  return JSON.parse(raw);
}

function toProofReasonFromTweet(text) {
  const cleaned = stripMarkdown(text).replace(/^https?:\/\/\S+\s*/g, "");
  return truncate(cleaned || "该动态反映了作者近期关注的议题与表达风格。", 72);
}

function buildRuleBasedReport(context, tweetSource) {
  const posts = context.posts.slice(0, 5).map((post) => ({
    title: post.title,
    url: post.url,
    reason: post.summary || "该文章可体现作者近期关注方向。",
    date: post.date,
  }));

  const tweets = context.tweets.slice(0, 3).map((tweet) => ({
    title: `X 动态 · ${tweet.date ? tweet.date.slice(0, 10) : "未知日期"}`,
    url: tweet.url,
    reason: toProofReasonFromTweet(tweet.text),
    date: tweet.date,
  }));

  const projects = (context.projects ?? []).slice(0, 4).map((project) => ({
    title: project.name,
    url: project.url,
    reason: project.description || "该项目体现了作者的工程实践方向。",
  }));

  const majorProjectNames = projects.map((item) => item.title).slice(0, 2).join("、");
  const highLevelTopic = context.highlights?.[0]
    ? truncate(context.highlights[0], 56)
    : "持续输出技术、产品与生活方式内容";

  return {
    meta: {
      lastUpdated: new Date().toISOString(),
      model: "rule-based-template",
      generatedBy: "rule-based",
      sources: ["posts", tweetSource, "github-resume"],
    },
    report: {
      hero: {
        title: "AI 视角下的罗磊",
        summary:
          "如果把他放在技术内容创作者光谱中，罗磊更接近把工程能力、产品审美和生活方式长期结合的全栈实践者。",
        intro: `从近期内容看，他的核心重心是：${highLevelTopic}。`,
      },
      identities: [
        {
          name: "全栈开发者",
          description: "长期围绕 Web、工具链和云边部署做完整链路实践。",
          evidence:
            majorProjectNames
              ? `代表项目包括 ${majorProjectNames}。`
              : "持续发布编程与工具类文章和项目。",
          link: "https://github.com/foru17",
        },
        {
          name: "内容创作者",
          description: "在博客与社交平台稳定输出高频、可执行的经验内容。",
          evidence: posts[0]
            ? `近期文章《${posts[0].title}》体现了强执行与复盘风格。`
            : "博客长期保持内容更新。",
          link: DEFAULT_SITE_URL,
        },
        {
          name: "数字生活方式实践者",
          description: "强调效率工具、审美细节和可持续工作流的结合。",
          evidence: context.tweets.length
            ? "从 X 动态可见其对工具、工作方式与生活质量的持续讨论。"
            : "在历史内容中反复呈现技术与生活融合主题。",
        },
      ],
      strengths: [
        {
          title: "技术与工程",
          points: [
            "偏向端到端交付，覆盖前端、后端与部署链路。",
            "重视工程可维护性，倾向脚本化与可复用方案。",
            "对 AI 工具落地有持续实践。"
          ],
        },
        {
          title: "产品与审美",
          points: [
            "关注工具体验与视觉细节，不止于“功能可用”。",
            "内容表达注重结构化、可复现与读者理解成本。",
          ],
        },
      ],
      styles: [
        {
          trait: "行动导向",
          description: "习惯快速验证想法，先做可用版本，再逐步迭代。",
        },
        {
          trait: "真诚公开",
          description: "愿意公开讨论决策、困惑与经验，形成可信内容风格。",
        },
        {
          trait: "长期主义",
          description: "在技术输出与个人生活方式建设上保持长期投入。",
        },
      ],
      proofs: {
        posts,
        tweets,
        projects,
      },
      disclaimer:
        "该页面由 AI 归纳与规则模板联合生成，旨在帮助访客快速建立认知，可能存在概括偏差，请以原始文章、动态与项目信息为准。",
    },
  };
}

async function generateReportWithAI(context, tweetSource) {
  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;
  if (!baseUrl || !apiKey || !model) {
    throw new Error("缺少 AI_BASE_URL / AI_API_KEY / AI_MODEL");
  }

  const systemPrompt = `你是一位中文科技写作编辑。请基于给定上下文，以第三方视角生成作者画像 JSON。
要求：
1. 严格输出 JSON，不要输出 Markdown 或多余文本。
2. 语气客观、克制、具体，不要夸张和空泛。
3. 必须遵守给定 schema，字段齐全。
4. 结论必须可由上下文支撑，避免编造。
5. 文案使用中文，第三人称，不使用“我”。

输出 schema:
{
  "report": {
    "hero": {"title":"AI 视角下的罗磊","summary":"...","intro":"..."},
    "identities":[{"name":"...","description":"...","evidence":"...","link":"..."}],
    "strengths":[{"title":"...","points":["..."]}],
    "styles":[{"trait":"...","description":"..."}],
    "proofs":{
      "posts":[{"title":"...","url":"...","reason":"...","date":"YYYY-MM-DD"}],
      "tweets":[{"title":"...","url":"...","reason":"...","date":"ISO"}],
      "projects":[{"title":"...","url":"...","reason":"..."}]
    },
    "disclaimer":"..."
  }
}`;

  const contextText = JSON.stringify(context, null, 2).slice(0, 30000);
  const userPrompt = `上下文数据如下，请根据这些信息生成报告：\n${contextText}`;
  const content = await callAI({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  const parsed = parseJsonText(content);
  const report = parsed?.report;
  if (!report) {
    throw new Error("AI 返回缺少 report 字段");
  }

  return {
    meta: {
      lastUpdated: new Date().toISOString(),
      model,
      generatedBy: "ai",
      sources: ["posts", tweetSource, "github-resume"],
    },
    report,
  };
}

async function main() {
  const args = parseArgs();
  await loadEnv();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;
  const posts = await loadPosts(siteUrl);
  const { source: tweetSource, tweets } = await loadTweets();
  const githubResume = await loadGithubResume();

  const context = buildContext({
    posts,
    tweets,
    githubResume,
    siteUrl,
    tweetSource,
  });

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_CONTEXT, JSON.stringify(context, null, 2), "utf-8");

  let report;
  if (args.noAI) {
    report = buildRuleBasedReport(context, tweetSource);
    console.log("ℹ️ 使用规则模板生成（--no-ai）");
  } else {
    try {
      report = await generateReportWithAI(context, tweetSource);
      console.log("✅ 使用 AI 生成作者画像报告");
    } catch (error) {
      if (!args.force) {
        console.warn(`⚠️ AI 生成失败，自动回退规则模板: ${error.message}`);
        report = buildRuleBasedReport(context, tweetSource);
      } else {
        throw error;
      }
    }
  }

  await fs.writeFile(OUTPUT_REPORT, JSON.stringify(report, null, 2), "utf-8");
  console.log(`✅ 已写入: ${OUTPUT_REPORT}`);
  console.log(`🧩 上下文文件: ${OUTPUT_CONTEXT}`);
}

main().catch((error) => {
  console.error("❌ 生成失败:", error.message);
  process.exit(1);
});
