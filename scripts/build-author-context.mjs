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
import { createHash } from "crypto";
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
const MAX_RECENT_POSTS = 400;
const MAX_HOT_POSTS = 100;
const MAX_TWEETS = 1000;
const MAX_PROJECTS = 10;
const TWEET_CACHE_MAX_AGE_DAYS = 7;
const GITHUB_PROFILE_REPO = "foru17/foru17";
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_PROFILE_REPO}/main`;
const GITHUB_RESUME_FILE = path.join(DATA_DIR, "github-resume.json");

const UMAMI_API_URL = "https://u.is26.com/api";
const UMAMI_WEBSITE_ID = "185ef031-29b2-49e3-bc50-1c9f80b4e831";

const CATEGORY_LABELS = {
  code: "编程开发",
  tech: "数码科技",
  travel: "旅行",
  lifestyle: "生活方式",
  photography: "摄影",
  run: "跑步",
  zuoluotv: "视频创作",
};

const THEME_STOPWORDS = new Set([
  "可以", "这个", "那个", "一些", "以及", "并且", "如果", "因为", "所以", "还是",
  "一个", "我们", "他们", "你们", "自己", "进行", "使用", "通过", "关于", "相关",
  "作者", "文章", "项目", "内容", "技术", "博客", "推文", "最近", "持续", "方式",
  "经验", "记录", "分享", "实践", "问题", "方案", "以及", "已经", "觉得", "真的",
  "就是", "应该", "动态", "小时", "支持", "采用", "开箱", "体验", "实现", "喜欢",
  "感觉", "东西", "更新", "完成", "开始", "准备", "今天", "昨天", "继续",
]);
const THEME_TOKEN_BLOCKLIST = new Set([
  "http",
  "https",
  "www",
  "com",
  "cn",
  "net",
  "org",
  "t",
  "co",
  "tco",
  "amp",
  "html",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "svg",
  "gif",
  "pro",
  "plus",
  "mini",
  "ultra",
  "max",
  "gb",
  "mb",
  "tb",
]);
const THEME_SHORT_TOKEN_ALLOWLIST = new Set([
  "ai",
  "ui",
  "ux",
  "js",
  "ts",
  "go",
  "ci",
  "cd",
  "db",
  "ip",
  "tv",
  "3d",
  "llm",
  "rag",
  "api",
  "ios",
  "mac",
  "dns",
  "vpn",
  "rss",
]);
const TRAVEL_FACT_LOCATIONS = [
  { name: "日本", kind: "country", aliases: ["日本", "东京", "京都", "大阪", "仙台", "松岛", "白石", "镰仓", "皇居", "成田"] },
  { name: "韩国", kind: "country", aliases: ["韩国", "首尔"] },
  { name: "菲律宾", kind: "country", aliases: ["菲律宾", "马尼拉", "长滩岛", "薄荷岛", "宿务"] },
  { name: "美国", kind: "country", aliases: ["美国", "美西", "纽约", "nyc", "洛杉矶", "拉斯维加斯", "旧金山"] },
  { name: "加拿大", kind: "country", aliases: ["加拿大"] },
  { name: "泰国", kind: "country", aliases: ["泰国", "曼谷"] },
  { name: "中国台湾", kind: "region", aliases: ["台湾", "台北"] },
  { name: "中国香港", kind: "region", aliases: ["香港"] },
  { name: "中国澳门", kind: "region", aliases: ["澳门"] },
];
const TRAVEL_FACT_CUES = [
  "旅行", "游记", "跑马", "徒步", "自驾", "潜水", "跨年", "蜜月",
  "day1", "day2", "day3", "day4", "day5", "day6", "day7", "day8", "day9",
  "day 1", "day 2", "day 3", "day 4", "day 5", "晨跑", "机场",
];
const READING_POST_PATTERNS = [/我在读什么/u, /年終卷/u, /年终卷/u, /读书分享/u];
const DEVICE_CATEGORY_PATTERNS = [
  { category: "显示器", keywords: ["显示器", "monitor", "rd280u"] },
  { category: "电脑", keywords: ["mac mini", "macbook", "电脑", "主机", "imac"] },
  { category: "网络/通信", keywords: ["nas", "wifi", "wi-fi", "路由", "esim", "sim", "宽带", "dns"] },
  { category: "音频", keywords: ["耳机", "音箱", "bose", "freebuds", "pamu"] },
  { category: "摄影", keywords: ["相机", "镜头", "摄影", "ricoh", "索尼", "富士", "小蚁"] },
  { category: "外设", keywords: ["键盘", "鼠标", "硬盘", "拓展坞", "dockcase", "手电筒"] },
  { category: "手机", keywords: ["iphone", "手机", "f50"] },
];

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

function normalizeSpace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function toPlainDate(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function cleanTweetText(text, max = 90) {
  const normalized = normalizeSpace(String(text ?? "").replace(/https?:\/\/t\.co\/\S+/g, ""));
  return truncate(normalized, max);
}

function sanitizeThemeSourceText(text) {
  return normalizeSpace(
    String(text ?? "")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\bwww\.\S+/gi, " ")
      .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
      .replace(/[#*_`<>()[\]{}]/g, " "),
  );
}

function isNoiseThemeToken(token) {
  const normalized = String(token ?? "").trim();
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  if (THEME_TOKEN_BLOCKLIST.has(lower)) return true;
  if (/^\d+$/.test(lower)) return true;
  if (/^[a-z]{1,2}$/i.test(lower) && !THEME_SHORT_TOKEN_ALLOWLIST.has(lower)) {
    return true;
  }

  return false;
}

function tokenizeThemeText(text) {
  const raw = sanitizeThemeSourceText(text);
  const tokens = raw.match(/[A-Za-z][A-Za-z0-9.+#-]{1,}|[\u4e00-\u9fa5]{2,6}/g) ?? [];
  return tokens.filter((token) => {
    const lower = token.toLowerCase?.() ?? token;
    return !THEME_STOPWORDS.has(lower) && !isNoiseThemeToken(token);
  });
}

function textIncludesAny(text, keywords) {
  const source = String(text ?? "").toLowerCase();
  return keywords.some((keyword) => source.includes(String(keyword).toLowerCase()));
}

function daysBetween(dateA, dateB) {
  const timeA = new Date(dateA).getTime();
  const timeB = new Date(dateB).getTime();
  if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) return Number.POSITIVE_INFINITY;
  return Math.abs(timeA - timeB) / (24 * 60 * 60 * 1000);
}

function pickEvidencePosts(posts, max = 3) {
  return posts
    .slice()
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, max)
    .map((post) => ({
      title: post.title,
      date: post.date,
      url: post.url,
    }));
}

function buildPostAnalysisText(post) {
  return normalizeSpace(
    [post.title, post.summary, ...(post.keyPoints ?? []), post.analysisText ?? ""].join("\n"),
  );
}

function buildThemeStats(posts, tweets) {
  const counts = new Map();
  const addToken = (token, weight = 1) => {
    if (!token || token.length < 2) return;
    counts.set(token, (counts.get(token) ?? 0) + weight);
  };

  for (const post of posts) {
    for (const category of post.categories ?? []) {
      addToken(CATEGORY_LABELS[category] ?? category, 3);
    }
    for (const token of tokenizeThemeText(post.title)) addToken(token, 3);
    for (const token of tokenizeThemeText(post.summary)) addToken(token, 2);
    for (const point of post.keyPoints ?? []) {
      for (const token of tokenizeThemeText(point)) addToken(token, 2);
    }
  }

  for (const tweet of tweets) {
    for (const token of tokenizeThemeText(tweet.text)) addToken(token, 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([token]) => token);
}

function selectRepresentativePosts(posts, limit = 5, recentCount = 2) {
  if (posts.length <= limit) return posts.slice(0, limit);

  const recent = posts.slice(0, Math.min(recentCount, limit));
  const recentUrls = new Set(recent.map((post) => post.url));
  const categorySeen = new Map();
  for (const post of recent) {
    for (const category of post.categories ?? []) {
      categorySeen.set(category, (categorySeen.get(category) ?? 0) + 1);
    }
  }

  const candidates = posts
    .filter((post) => !recentUrls.has(post.url))
    .map((post, index) => {
      const categoryScore = (post.categories ?? []).reduce(
        (score, category) => score + 1 / (1 + (categorySeen.get(category) ?? 0)),
        0,
      );
      const keyPointScore = Math.min((post.keyPoints ?? []).length, 3) * 0.4;
      const summaryScore = post.summary ? 0.3 : 0;
      const recencyScore = 1 / (1 + index * 0.08);

      return {
        post,
        score: categoryScore + keyPointScore + summaryScore + recencyScore,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit - recent.length))
    .map((entry) => entry.post);

  return [...recent, ...candidates].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

function findTravelLocations(text) {
  const normalized = String(text ?? "").toLowerCase();
  return TRAVEL_FACT_LOCATIONS.filter((location) =>
    location.aliases.some((alias) => normalized.includes(alias.toLowerCase())));
}

function isTravelFactCandidate(post) {
  const text = buildPostAnalysisText(post);
  const hasTravelCategory = (post.categories ?? []).some((category) =>
    ["travel", "photography"].includes(String(category).toLowerCase()));
  return hasTravelCategory || textIncludesAny(text, TRAVEL_FACT_CUES);
}

function buildTravelFacts(posts) {
  const candidates = [];
  for (const post of posts) {
    if (!isTravelFactCandidate(post)) continue;

    const locations = findTravelLocations(buildPostAnalysisText(post));
    if (locations.length === 0) continue;

    for (const location of locations) {
      candidates.push({
        ...location,
        title: post.title,
        date: post.date,
        url: post.url,
      });
    }
  }

  const grouped = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.name}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(candidate);
  }

  const buildEntries = (kind) => {
    return [...grouped.entries()]
      .filter(([key]) => key.startsWith(`${kind}:`))
      .map(([, items]) => {
        const sorted = items
          .slice()
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const tripGroups = [];
        for (const item of sorted) {
          const latestGroup = tripGroups[tripGroups.length - 1];
          if (!latestGroup || daysBetween(latestGroup.lastDate, item.date) > 21) {
            tripGroups.push({
              lastDate: item.date,
              posts: [item],
            });
            continue;
          }
          latestGroup.posts.push(item);
          latestGroup.lastDate = item.date;
        }

        const evidence = pickEvidencePosts(
          tripGroups.map((group) => {
            const latest = group.posts[group.posts.length - 1];
            return {
              title: latest.title,
              date: latest.date,
              url: latest.url,
            };
          }),
          3,
        );

        return {
          name: sorted[0]?.name ?? "",
          kind,
          tripCount: tripGroups.length,
          countMode: "at_least",
          firstMentionedAt: sorted[0]?.date ?? "",
          latestMentionedAt: sorted[sorted.length - 1]?.date ?? "",
          evidence,
        };
      })
      .sort(
        (a, b) =>
          b.tripCount - a.tripCount ||
          new Date(b.latestMentionedAt).getTime() - new Date(a.latestMentionedAt).getTime(),
      );
  };

  return {
    countries: buildEntries("country"),
    regions: buildEntries("region"),
  };
}

function extractRaceName(title) {
  let normalized = String(title ?? "")
    .replace(/^跑步\s*\|\s*/u, "")
    .replace(/^马拉松\s*\|\s*/u, "")
    .trim();

  const pipeSegments = normalized.split("|").map((segment) => segment.trim()).filter(Boolean);
  const pipeMatch = pipeSegments.find((segment) => /马拉松|长跑节/u.test(segment));
  if (pipeMatch) {
    normalized = pipeMatch;
  }

  normalized = normalized.split(/[：:]/u)[0]?.trim() ?? normalized;
  normalized = normalized.replace(/比赛日$/u, "").trim();
  return normalized;
}

function extractRaceResult(text) {
  const normalized = String(text ?? "");
  const hourMinuteMatch = normalized.match(/(\d+\s*小时\s*\d+\s*分(?:\s*\d+\s*秒)?)/u);
  if (hourMinuteMatch?.[1]) {
    return normalizeSpace(hourMinuteMatch[1]);
  }
  const clockMatch = normalized.match(/\b(\d{1,2}:\d{2}:\d{2})\b/);
  return clockMatch?.[1] ?? "";
}

function extractMarathonSequence(text) {
  const match = String(text ?? "").match(/第\s*(\d+)\s*场全马/u);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function buildRaceFacts(posts) {
  const events = new Map();
  let totalMarathons = null;

  for (const post of posts) {
    const text = buildPostAnalysisText(post);
    if (!/马拉松|长跑节/u.test(text)) continue;
    if (/训练小记/u.test(post.title)) continue;

    const eventName = extractRaceName(post.title);
    if (!eventName) continue;

    const eventType = /长跑节/u.test(eventName)
      ? "road_run"
      : /半马|半程/u.test(text)
        ? "half_marathon"
        : "full_marathon";

    const sequenceNumber = extractMarathonSequence(text);
    if (eventType === "full_marathon" && sequenceNumber) {
      if (!totalMarathons || sequenceNumber > totalMarathons.value) {
        totalMarathons = {
          value: sequenceNumber,
          mode: "at_least",
          sourceTitle: post.title,
          sourceUrl: post.url,
          sourceDate: post.date,
        };
      }
    }

    const raceKey = normalizeSpace(eventName.toLowerCase());
    const existing = events.get(raceKey);
    const current = {
      name: eventName,
      date: post.date,
      url: post.url,
      title: post.title,
      eventType,
      result: extractRaceResult(text),
      sequenceNumber: sequenceNumber ?? undefined,
      location: findTravelLocations(text)[0]?.name ?? "",
    };

    const currentScore =
      (current.sequenceNumber ?? 0) * 3 +
      (current.result ? 4 : 0) +
      (current.location ? 2 : 0) +
      text.length / 1000;
    const existingScore =
      existing
        ? (existing.sequenceNumber ?? 0) * 3 +
          (existing.result ? 4 : 0) +
          (existing.location ? 2 : 0) +
          String(existing.title ?? "").length / 1000
        : Number.NEGATIVE_INFINITY;

    if (!existing || currentScore >= existingScore) {
      events.set(raceKey, current);
    }
  }

  const completedEvents = [...events.values()]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return {
    totalMarathons,
    completedEvents,
  };
}

function extractBookTitlesFromMarkdown(markdown) {
  const matches = [...String(markdown ?? "").matchAll(/^\s*\d+\.\s*\[?《([^》]+)》/gmu)];
  const titles = [];
  const seen = new Set();
  for (const match of matches) {
    const title = normalizeSpace(match[1]);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    titles.push(title);
  }
  return titles;
}

function extractReadingCount(text) {
  const normalized = String(text ?? "");
  const patterns = [
    /分享[^。]{0,20}?(\d+)\s*本书/u,
    /读的\s*(\d+)\s*本书/u,
    /集中阅读\s*(\d+)\s*本书/u,
    /读了\s*(\d+)\s*本书/u,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  }
  return null;
}

function extractLifetimeReadCount(text) {
  const match = String(text ?? "").match(/已(?:经)?读了\s*(\d+)\s*本书/u);
  return match?.[1] ? Number.parseInt(match[1], 10) : null;
}

function buildReadingFacts(posts) {
  const roundupPosts = [];
  let lifetimeReadCount = null;

  for (const post of posts) {
    const title = String(post.title ?? "");
    const text = buildPostAnalysisText(post);

    const lifetimeCount = extractLifetimeReadCount(text);
    if (lifetimeCount && (!lifetimeReadCount || lifetimeCount > lifetimeReadCount.value)) {
      lifetimeReadCount = {
        value: lifetimeCount,
        mode: "approx_public_record",
        sourceTitle: post.title,
        sourceUrl: post.url,
        sourceDate: post.date,
      };
    }

    if (!READING_POST_PATTERNS.some((pattern) => pattern.test(title))) continue;

    roundupPosts.push({
      title: post.title,
      date: post.date,
      url: post.url,
      bookCount: extractReadingCount(text) ?? undefined,
      books: extractBookTitlesFromMarkdown(post.analysisText).slice(0, 8),
    });
  }

  roundupPosts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    lifetimeReadCount,
    roundupPosts,
  };
}

function inferDeviceCategory(text) {
  for (const rule of DEVICE_CATEGORY_PATTERNS) {
    if (textIncludesAny(text, rule.keywords)) {
      return rule.category;
    }
  }
  return "";
}

function buildDeviceFacts(posts) {
  const featuredPosts = [];
  for (const post of posts) {
    const category = inferDeviceCategory(`${post.title}\n${post.summary}`);
    if (!category) continue;

    featuredPosts.push({
      title: post.title,
      date: post.date,
      url: post.url,
      category,
    });
  }

  return {
    featuredPosts: featuredPosts
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 12),
  };
}

function buildStructuredFacts(posts) {
  return {
    travel: buildTravelFacts(posts),
    races: buildRaceFacts(posts),
    reading: buildReadingFacts(posts),
    devices: buildDeviceFacts(posts),
  };
}

function buildStableFacts({ posts, tweets, profile }) {
  const categoryCounts = new Map();
  for (const post of posts) {
    for (const category of post.categories ?? []) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }

  const focusAreas = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category]) => CATEGORY_LABELS[category] ?? category);

  const recurringTopics = buildThemeStats(posts, tweets)
    .filter((token) => !focusAreas.includes(token))
    .slice(0, 10);

  const flagshipPosts = selectRepresentativePosts(posts, 5).map((post) => ({
    title: post.title,
    date: post.date,
    url: post.url,
  }));

  const publicPlatforms = Object.entries(profile?.social ?? {})
    .filter(([, url]) => typeof url === "string" && url.trim())
    .slice(0, 8)
    .map(([label, url]) => ({ label, url }));

  return {
    focusAreas,
    recurringTopics,
    flagshipPosts,
    publicPlatforms,
    contentFootprint: {
      posts: posts.length,
      tweets: tweets.length,
    },
  };
}

function buildTimelineFacts({ posts, tweets, experience }) {
  const latestPosts = posts.slice(0, 5).map((post) => ({
    date: post.date,
    title: post.title,
    url: post.url,
  }));

  const latestTweets = [...tweets]
    .filter((tweet) => tweet.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)
    .map((tweet) => ({
      date: toPlainDate(tweet.date),
      text: cleanTweetText(tweet.text, 84),
      url: tweet.url,
    }));

  const careerMoments = (experience ?? [])
    .slice(0, 8)
    .map((exp) => ({
      period: normalizeSpace(exp.period),
      title: normalizeSpace(exp.title),
      company: normalizeSpace(exp.company),
    }))
    .filter((item) => item.period || item.title || item.company);

  return {
    latestPosts,
    latestTweets,
    careerMoments,
  };
}

function computeContextHash(payload) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16);
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
      analysisText: parsed.content,
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

function toPublicPosts(posts) {
  return posts.map(({ slug, analysisText, ...post }) => post);
}

// ─── 推文数据 ────────────────────────────────────────────────

function sortTweetsByDateDesc(tweets) {
  return [...tweets].sort(
    (a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime(),
  );
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
      tweets: sortTweetsByDateDesc(tweets).slice(0, MAX_TWEETS),
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
    tweets: sortTweetsByDateDesc(tweets).slice(0, MAX_TWEETS),
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
  const rawPosts = await collectBlogDigest(siteUrl);
  const posts = toPublicPosts(rawPosts);

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

  const stableFacts = buildStableFacts({
    posts,
    tweets: tweetResult.tweets,
    profile: github.profile,
  });
  const timelineFacts = buildTimelineFacts({
    posts,
    tweets: tweetResult.tweets,
    experience: github.experience,
  });
  const structuredFacts = await (async () => {
    const geminiFactsFile = path.join(DATA_DIR, "structured-facts-aggregated.json");
    const geminiFacts = await readJson(geminiFactsFile, null);
    if (geminiFacts) {
      console.log("   ✨ 使用 Gemini 聚合的 structuredFacts（运行 pnpm facts:gemini 可更新）");
      return {
        travel: geminiFacts.travel,
        races: geminiFacts.races,
        reading: geminiFacts.reading,
        devices: buildStructuredFacts(rawPosts).devices, // devices 仍用规则提取
      };
    }
    console.log("   ⚠️  未找到 structured-facts-aggregated.json，使用规则提取（运行 pnpm facts:gemini 生成）");
    return buildStructuredFacts(rawPosts);
  })();

  // ── 构建统一上下文 ──
  const baseContext = {
    $schema: "author-context-v2",
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
    stableFacts,
    timelineFacts,
    structuredFacts,
    sourceVersions: {
      tweets: {
        fetchedAt: tweetResult.fetchedAt,
        count: tweetResult.count,
        source: tweetResult.source,
        latestTweetAt: timelineFacts.latestTweets[0]?.date ?? null,
      },
      posts: {
        scannedAt: new Date().toISOString(),
        count: posts.length,
        latestPostAt: posts[0]?.date ?? null,
      },
      github: {
        updatedAt: github.updatedAt,
      },
    },
  };

  const context = {
    ...baseContext,
    contextHash: computeContextHash(baseContext),
  };

  await writeJson(OUTPUT_FILE, context);
  console.log(`\n✅ 已生成: ${OUTPUT_FILE}`);
  console.log(`📊 数据概览: ${posts.length} 文章 / ${tweetResult.tweets.length} 推文 / ${github.projects.length} 项目`);
}

main().catch((error) => {
  console.error("❌ 构建失败:", error.message);
  process.exit(1);
});
