/**
 * 构建作者上下文数据（模型无关）
 *
 * 聚合博客文章、推文和 GitHub 数据为统一的 author-context.json，
 * 作为所有 AI 模型的标准化输入。
 *
 * 用法:
 *   node scripts/build-author-context.mjs
 *   node scripts/build-author-context.mjs --refresh-tweets
 */

import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { fileURLToPath } from "url";
import { loadEnv } from "./utils/load-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const POSTS_DIR = path.join(ROOT_DIR, "content", "posts");
const SOURCES_DIR = path.join(DATA_DIR, "sources");
const OUTPUT_FILE = path.join(DATA_DIR, "author-context.json");

const DEFAULT_SITE_URL = "https://luolei.org";
const DEFAULT_USERNAME = "luoleiorg";
const MAX_RECENT_POSTS = 150;
const MAX_HOT_POSTS = 100;
const MAX_TWEETS = 300;
const MAX_PROJECTS = 10;
const TWEET_CACHE_MAX_AGE_DAYS = 7;
const GITHUB_PROFILE_REPO = "foru17/foru17";
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_PROFILE_REPO}/main`;
const GITHUB_RESUME_FILE = path.join(DATA_DIR, "github-resume.json");

const UMAMI_API_URL = "https://u.is26.com/api";
const UMAMI_WEBSITE_ID = "185ef031-29b2-49e3-bc50-1c9f80b4e831";

// ─── 工具函数 ────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    refreshTweets: args.includes("--refresh-tweets"),
  };
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// ─── 博客数据 ────────────────────────────────────────────────

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
  return relativePath
    .replace(/\\/g, "/")
    .replace(/\.md$/, "")
    .replace(/\//g, "-");
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

async function fetchHotSlugs() {
  const token = process.env.UMAMI_API_TOKEN;
  if (!token) {
    console.log("   ⚠️  未设置 UMAMI_API_TOKEN，跳过热门文章获取");
    return [];
  }

  try {
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const url = new URL(`${UMAMI_API_URL}/websites/${UMAMI_WEBSITE_ID}/metrics`);
    url.searchParams.set("startAt", String(oneYearAgo));
    url.searchParams.set("endAt", String(now));
    url.searchParams.set("type", "path");
    url.searchParams.set("limit", "200");

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      console.warn(`   ⚠️  Umami API 请求失败: ${response.status}`);
      return [];
    }

    const metrics = await response.json();
    // metrics 格式: [{ x: "/slug-name", y: pageview_count }, ...]
    // 过滤出文章路径（排除首页、分页等）
    return metrics
      .filter((m) => {
        const p = m.x;
        return (
          p &&
          p !== "/" &&
          !p.startsWith("/page/") &&
          !p.startsWith("/about") &&
          !p.startsWith("/api/") &&
          !p.startsWith("/_next/") &&
          !p.includes("?")
        );
      })
      .map((m) => m.x.replace(/^\//, "").replace(/\/$/, ""))
      .slice(0, MAX_HOT_POSTS);
  } catch (err) {
    console.warn(`   ⚠️  获取热门文章失败: ${err.message}`);
    return [];
  }
}

async function collectBlogDigest(siteUrl) {
  const files = await collectMarkdownFiles(POSTS_DIR);
  const aiSummaries = await readJson(path.join(DATA_DIR, "ai-summaries.json"), {
    articles: {},
  });

  const allPosts = [];
  for (const filePath of files) {
    const relative = path.relative(POSTS_DIR, filePath);
    const slug = toSlug(relative);
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data ?? {};
    if (!data.title || !data.date || data.hide) continue;

    const summaryEntry = aiSummaries?.articles?.[slug]?.data ?? null;
    const plainContent = stripMarkdown(parsed.content);

    allPosts.push({
      title: String(data.title),
      date: String(data.date),
      slug,
      url: `${siteUrl.replace(/\/$/, "")}/${slug}`,
      categories: Array.isArray(data.categories)
        ? data.categories.map((c) => String(c))
        : [],
      summary: summaryEntry?.summary ?? truncate(plainContent, 100),
      keyPoints: Array.isArray(summaryEntry?.keyPoints)
        ? summaryEntry.keyPoints
        : [],
    });
  }

  // 按日期降序排列
  allPosts.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  // 最新文章
  const recentPosts = allPosts.slice(0, MAX_RECENT_POSTS);

  // 热门文章（按 Umami pageview 排名）
  const hotSlugs = await fetchHotSlugs();
  const slugSet = new Set(hotSlugs);
  const hotPosts = allPosts.filter((p) => slugSet.has(p.slug)).slice(0, MAX_HOT_POSTS);

  // 去重合并: hotPosts 先放，recentPosts 后放（相同 URL 时 recent 覆盖 hot）
  const merged = new Map(
    [...hotPosts, ...recentPosts].map((p) => [p.url, p]),
  );
  const result = [...merged.values()];
  // 按日期降序排列最终结果
  result.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  // 移除内部使用的 slug 字段
  for (const post of result) {
    delete post.slug;
  }

  console.log(
    `   📊 ${result.length} 篇文章（最新 ${recentPosts.length} + 热门 ${hotPosts.length}，去重后 ${result.length}）`,
  );

  return result;
}

// ─── 推文数据 ────────────────────────────────────────────────

function tweetScore(tweet) {
  const m = tweet.metrics ?? {};
  const likes = Number(m.like_count ?? 0);
  const bookmarks = Number(m.bookmark_count ?? 0);
  const retweets = Number(m.retweet_count ?? 0);
  const replies = Number(m.reply_count ?? 0);
  const quotes = Number(m.quote_count ?? 0);
  return likes + bookmarks * 1.5 + retweets * 1.8 + replies + quotes * 1.2;
}

function normalizeAuthorTweetsCache(payload) {
  if (!payload?.tweets || !Array.isArray(payload.tweets)) return [];
  const username = payload?.meta?.username ?? DEFAULT_USERNAME;
  return payload.tweets.map((tweet) => ({
    id: tweet.id,
    text: tweet.text ?? "",
    date: tweet.created_at ?? "",
    url: `https://x.com/${username}/status/${tweet.id}`,
    metrics: tweet.public_metrics ?? {},
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
      url: `https://x.com/${tweet.author?.username ?? DEFAULT_USERNAME}/status/${tweet.id}`,
      metrics: tweet.public_metrics ?? {},
    }));
}

function isCacheStale(cacheData, maxAgeDays) {
  const updatedAt = cacheData?.meta?.lastUpdated;
  if (!updatedAt) return true;
  const age = Date.now() - new Date(updatedAt).getTime();
  return age > maxAgeDays * 24 * 60 * 60 * 1000;
}

async function collectTweets() {
  // 优先使用作者专用推文缓存
  const authorCache = await readJson(
    path.join(DATA_DIR, "author-tweets-cache.json"),
    null,
  );
  if (authorCache?.tweets?.length) {
    const tweets = normalizeAuthorTweetsCache(authorCache);
    return {
      tweets: [...tweets].sort((a, b) => tweetScore(b) - tweetScore(a)).slice(0, MAX_TWEETS),
      source: "author-tweets-cache",
      fetchedAt: authorCache?.meta?.lastUpdated ?? new Date().toISOString(),
      count: tweets.length,
      stale: isCacheStale(authorCache, TWEET_CACHE_MAX_AGE_DAYS),
    };
  }

  // 回退到通用推文缓存
  const tweetCardCache = await readJson(
    path.join(DATA_DIR, "tweets-cache.json"),
    { tweets: {} },
  );
  const tweets = normalizeTweetCardCache(tweetCardCache);
  return {
    tweets: [...tweets].sort((a, b) => tweetScore(b) - tweetScore(a)).slice(0, MAX_TWEETS),
    source: "tweets-cache",
    fetchedAt: tweetCardCache?.lastUpdated ?? new Date().toISOString(),
    count: tweets.length,
    stale: true, // 通用缓存不是为此用途设计的
  };
}

// ─── GitHub 数据（在线拉取 + 本地缓存兜底） ──────────────────

async function fetchGithubRaw(filename) {
  const url = `${GITHUB_RAW_URL}/${filename}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "luoleiorg-context-builder" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${filename}`);
  return res.text();
}

function extractMdSection(md, heading, level = 2) {
  const prefix = "#".repeat(level) + " ";
  const re = new RegExp(`^${prefix}${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
  const match = re.exec(md);
  if (!match) return "";
  const contentStart = md.indexOf("\n", match.index) + 1;
  const nextRe = new RegExp(`^${prefix}\\S`, "m");
  const nextMatch = nextRe.exec(md.slice(contentStart));
  return nextMatch
    ? md.slice(contentStart, contentStart + nextMatch.index).trim()
    : md.slice(contentStart).trim();
}

function parseMdLinks(text) {
  const links = {};
  const re = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    links[m[1].replace(/[*_]/g, "").trim()] = m[2].trim();
  }
  return links;
}

function parseBullets(text) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).replace(/\*\*([^*]+)\*\*/g, "$1").trim());
}

function parseGithubProfile(readmeMd, resumeMd) {
  // ─ Bio from README tagline (支持中英文关键词)
  const bioLine =
    readmeMd
      .split("\n")
      .find(
        (l) =>
          !l.startsWith("#") &&
          !l.startsWith("|") &&
          !l.startsWith("!") &&
          (l.includes("Developer") || l.includes("Photographer") || l.includes("YouTuber") ||
           l.includes("开发") || l.includes("摄影") || l.includes("马拉松")),
      ) ?? "";

  // ─ Headline from RESUME title
  const resumeTitle = resumeMd.split("\n").find((l) => l.startsWith("# ")) ?? "";
  const headlineParts = resumeTitle.replace(/^#\s+/, "").split(" - ");
  const nameEn = headlineParts[0]?.trim() || "Luo Lei";
  const headline = headlineParts.slice(1).join(" - ").trim() || "";

  // ─ Social links from both files
  const allLinks = { ...parseMdLinks(resumeMd), ...parseMdLinks(readmeMd) };
  const social = {
    github: "https://github.com/foru17",
    x: "https://x.com/luoleiorg",
    youtube: "https://zuoluo.tv/youtube",
    bilibili: "https://zuoluo.tv/bilibili",
    blog: "https://luolei.org",
    instagram: "",
    unsplash: "",
    telegram: "",
    linkedin: "",
    email: "i@luolei.org",
  };
  for (const [label, url] of Object.entries(allLinks)) {
    const ll = label.toLowerCase();
    // 跳过 badge/统计图片 URL，避免污染 social 链接
    if (url.includes("badge.is26.com") || url.includes("komarev.com")) continue;
    if (url.includes("x.com") || ll.includes("twitter") || ll.includes("twitter:")) social.x = url;
    else if (ll.includes("youtube") || url.includes("zuoluo.tv/youtube")) social.youtube = url;
    else if (ll.includes("bilibili")) social.bilibili = url;
    else if (ll.includes("blog") || ll.includes("博客") || (url.includes("luolei.org") && !url.includes("mailto"))) social.blog = url;
    else if (ll.includes("instagram")) social.instagram = url;
    else if (ll.includes("unsplash")) social.unsplash = url;
    else if (ll.includes("telegram") || ll.includes("telegram 频道")) social.telegram = url;
    else if (ll.includes("linkedin")) social.linkedin = url;
    else if (url.startsWith("mailto:")) social.email = url.replace("mailto:", "");
  }

  // ─ Highlights from README "关于我" (中文) or "About Me" (英文，兜底)
  const aboutSection = extractMdSection(readmeMd, "关于我") || extractMdSection(readmeMd, "About Me");
  const highlights = parseBullets(aboutSection)
    .map((h) => h.replace(/^[^\w\u4e00-\u9fff]+/, "").trim())
    .filter(Boolean);

  // ─ Skills from RESUME "核心技能" (中文) or "Key Skills" (英文，兜底)
  const skillsSection = extractMdSection(resumeMd, "核心技能") || extractMdSection(resumeMd, "Key Skills");
  const skills = {};
  const skillRe = /\*\*([^*]+)\*\*[：:]\s*(.+)/g;
  let sm;
  while ((sm = skillRe.exec(skillsSection))) {
    const cat = sm[1].trim();
    // 括号内的顿号/逗号不作为分隔符，先替换保护再 split
    const protectedValue = sm[2].replace(/（[^）]*）/g, (m) => m.replace(/[,，、]/g, "\x00"));
    const items = protectedValue.split(/[,，、]/).map((s) => s.replace(/\x00/g, "、").trim()).filter(Boolean);
    const catLow = cat.toLowerCase();
    if (cat.includes("前端") || catLow.includes("front")) skills.frontend = items;
    else if (cat.includes("后端") || cat.includes("数据库") || catLow.includes("back") || catLow.includes("db")) skills.backend = items;
    else if (cat.includes("DevOps") || cat.includes("架构") || catLow.includes("devops") || catLow.includes("architect")) skills.devops = items;
    else if (cat.includes("设计") || catLow.includes("design")) skills.design = items;
    else if (cat.includes("AI") || cat.includes("生产力") || catLow.includes("ai") || catLow.includes("productivity")) skills.tools = items;
    else skills[catLow.replace(/[^a-z0-9]/g, "_")] = items;
  }

  // ─ Projects from RESUME "开源与精选项目" (中文) or "Open Source & Featured Projects" (英文，兜底)
  const projectsSection = extractMdSection(resumeMd, "开源与精选项目") || extractMdSection(resumeMd, "Open Source & Featured Projects");
  const projects = [];
  const projRe = /\[?\*\*([^*\]]+)\*\*\]?\(([^)]+)\)[：:\s]*(.+)/g;
  let pm;
  while ((pm = projRe.exec(projectsSection))) {
    projects.push({
      name: pm[1].trim(),
      url: pm[2].trim(),
      description: pm[3].replace(/\*\*/g, "").trim(),
      tags: [],
    });
  }

  // ─ Experience from RESUME "工作经历" (中文) or "Experience" (英文，兜底)
  // 中文格式1（独立开发）: ### 职位名称 \n _期间_
  // 中文格式2（公司）:     ### 公司名称 \n _职位（期间）_
  const expSection = extractMdSection(resumeMd, "工作经历") || extractMdSection(resumeMd, "Experience");
  const experience = [];
  const expBlocks = expSection.split(/\n(?=### )/);
  for (const block of expBlocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const headerLine = lines.find((l) => l.startsWith("### "));
    if (!headerLine) continue;
    const headerRaw = headerLine.replace(/^###\s+/, "").trim();
    const italicLine = lines.find((l) => /^_.*_$/.test(l));
    let title = "";
    let company = headerRaw;
    let period = "";
    if (italicLine) {
      const content = italicLine.replace(/^_/, "").replace(/_$/, "").trim();
      // 中文格式：_职位（期间）_ 或 _期间_（独立开发者）
      const cnPeriodMatch = content.match(/（([^）]+)）\s*$/);
      const enPeriodMatch = content.match(/\(([^)]+)\)\s*$/);
      if (cnPeriodMatch) {
        period = cnPeriodMatch[1].trim();
        title = content.replace(/（[^）]+）\s*$/, "").trim();
      } else if (enPeriodMatch) {
        period = enPeriodMatch[1].trim();
        title = content.replace(/\([^)]+\)\s*$/, "").trim();
      } else {
        // 纯期间行（独立开发者格式）
        period = content;
        title = company;
        company = "独立";
      }
    }
    if (!title) title = company;
    const bullets = lines
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim());
    experience.push({
      title,
      company,
      period,
      description: bullets.join("；"),
    });
  }

  // ─ Education from RESUME "教育背景" (中文) or "Education" (英文，兜底)
  const eduSection = extractMdSection(resumeMd, "教育背景") || extractMdSection(resumeMd, "Education");
  let degree = "";
  let school = "";
  let eduNote = "";
  for (const line of eduSection.split("\n")) {
    const bold = line.match(/\*\*([^*]+)\*\*\s*[-－]\s*(.+)/);
    if (bold) {
      degree = bold[1].trim();
      school = bold[2].trim();
    }
    const italic = line.match(/^_([^_]+)_$/);
    if (italic && (italic[1].includes("•") || italic[1].includes("大学") || italic[1].includes("University"))) {
      school = `${school} (${italic[1].trim()})`;
    }
    if (line.trim().startsWith("- ")) {
      const note = line.trim().slice(2).trim();
      eduNote = eduNote ? `${eduNote}；${note}` : note;
    }
  }

  // ─ Side Projects & Interests (中文简历无此独立章节，用空数组)
  const sideSection = extractMdSection(resumeMd, "Side Projects & Interests");
  const sideProjects = parseBullets(sideSection);

  // ─ Public Activities from "公开活动" (中文) or "Public Activities" (英文，兜底)
  const pubSection = extractMdSection(resumeMd, "公开活动") || extractMdSection(resumeMd, "Public Activities");
  const publicActivities = parseBullets(pubSection);

  return {
    meta: {
      lastUpdated: new Date().toISOString(),
      source: `github-${GITHUB_PROFILE_REPO}`,
      owner: GITHUB_PROFILE_REPO.split("/")[0],
      fetchedAt: new Date().toISOString(),
    },
    profile: {
      name: "罗磊",
      nameEn,
      headline,
      location: "Shenzhen, China",
      bio: bioLine.trim(),
      social,
    },
    highlights,
    experience,
    sideProjects,
    publicActivities,
    projects,
    skills,
    education: degree ? { degree, school, note: eduNote } : null,
  };
}

async function fetchGithubProfile() {
  console.log(`   🔗 从 GitHub 在线获取 (${GITHUB_PROFILE_REPO})...`);
  const [readmeMd, resumeMd] = await Promise.all([
    fetchGithubRaw("README.zh-CN.md"),
    fetchGithubRaw("RESUME.zh-CN.md"),
  ]);
  console.log(`   └─ README.zh-CN ${readmeMd.length} 字符 / RESUME.zh-CN ${resumeMd.length} 字符`);
  const profile = parseGithubProfile(readmeMd, resumeMd);
  await writeJson(GITHUB_RESUME_FILE, profile);
  console.log(`   └─ 已更新本地缓存: data/github-resume.json`);
  return profile;
}

function normalizeResumeData(resume) {
  return {
    profile: resume.profile ?? {},
    highlights: Array.isArray(resume.highlights) ? resume.highlights : [],
    experience: Array.isArray(resume.experience) ? resume.experience : [],
    sideProjects: Array.isArray(resume.sideProjects) ? resume.sideProjects : [],
    publicActivities: Array.isArray(resume.publicActivities) ? resume.publicActivities : [],
    skills: resume.skills ?? {},
    education: resume.education ?? null,
    projects: Array.isArray(resume.projects)
      ? resume.projects.slice(0, MAX_PROJECTS)
      : [],
    updatedAt: resume?.meta?.lastUpdated ?? null,
  };
}

async function collectGithubData() {
  try {
    const profile = await fetchGithubProfile();
    return normalizeResumeData(profile);
  } catch (err) {
    console.warn(`   ⚠️  GitHub 在线获取失败: ${err.message}`);
    console.log("   └─ 回退使用本地缓存 data/github-resume.json");
    const resume = await readJson(GITHUB_RESUME_FILE, {
      profile: {},
      highlights: [],
      experience: [],
      projects: [],
    });
    return normalizeResumeData(resume);
  }
}

// ─── 主流程 ──────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  await loadEnv();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL;

  console.log("📦 收集博客文章数据...");
  const posts = await collectBlogDigest(siteUrl);

  // 保存博客摘要到 sources
  await writeJson(path.join(SOURCES_DIR, "blog-digest.json"), {
    generatedAt: new Date().toISOString(),
    count: posts.length,
    posts,
  });

  console.log("🐦 收集推文数据...");
  const tweetResult = await collectTweets();
  if (tweetResult.stale) {
    console.log(
      `   ⚠️  推文缓存已过期（来源: ${tweetResult.source}）`,
    );
    if (args.refreshTweets) {
      console.log("   🔄 正在刷新推文（需要 TWITTER_BEARER_TOKEN）...");
      // 动态导入并执行 fetch-author-tweets
      try {
        const { execSync } = await import("child_process");
        execSync("node scripts/fetch-author-tweets.mjs", {
          cwd: ROOT_DIR,
          stdio: "inherit",
        });
        // 重新读取
        const refreshed = await collectTweets();
        tweetResult.tweets = refreshed.tweets;
        tweetResult.fetchedAt = refreshed.fetchedAt;
        tweetResult.count = refreshed.count;
        tweetResult.stale = false;
        console.log(`   └─ 刷新完成，${refreshed.count} 条推文`);
      } catch (err) {
        console.warn(`   ❌ 推文刷新失败: ${err.message}`);
      }
    } else {
      console.log("   💡 使用 --refresh-tweets 标志可自动刷新");
    }
  }
  console.log(`   └─ ${tweetResult.tweets.length} 条推文（来源: ${tweetResult.source}）`);

  console.log("🐙 收集 GitHub 数据...");
  const github = await collectGithubData();
  console.log(`   └─ ${github.projects.length} 个项目`);

  // 保存 GitHub 数据到 sources
  await writeJson(path.join(SOURCES_DIR, "github-profile.json"), {
    generatedAt: new Date().toISOString(),
    ...github,
  });

  // ── 构建统一上下文 ──
  const context = {
    $schema: "author-context-v1",
    generatedAt: new Date().toISOString(),
    profile: {
      name: github.profile?.name ?? "罗磊",
      headline:
        github.profile?.headline ??
        "全栈开发者 / 内容创作者 / 数字游民实践者",
      location: github.profile?.location ?? "Shenzhen, China",
      social: github.profile?.social ?? {
        github: "https://github.com/foru17",
        x: "https://x.com/luoleiorg",
        youtube: "https://zuoluo.tv/youtube",
        blog: siteUrl,
      },
    },
    experience: github.experience,
    sideProjects: github.sideProjects,
    publicActivities: github.publicActivities,
    skills: github.skills,
    education: github.education,
    highlights: github.highlights,
    posts,
    tweets: tweetResult.tweets,
    projects: github.projects,
    sourceVersions: {
      tweets: {
        fetchedAt: tweetResult.fetchedAt,
        count: tweetResult.count,
        source: tweetResult.source,
      },
      posts: {
        scannedAt: new Date().toISOString(),
        count: posts.length,
      },
      github: {
        updatedAt: github.updatedAt,
      },
    },
  };

  await writeJson(OUTPUT_FILE, context);
  console.log(`\n✅ 已生成: ${OUTPUT_FILE}`);
  console.log(`📊 数据概览: ${posts.length} 文章 / ${tweetResult.tweets.length} 推文 / ${github.projects.length} 项目`);
}

main().catch((error) => {
  console.error("❌ 构建失败:", error.message);
  process.exit(1);
});
