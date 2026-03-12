/**
 * Gemini 并发直接调用 — 结构化事实提取脚本
 *
 * 用法:
 *   pnpm facts:gemini                  处理所有尚未缓存的文章（并发调用，~5分钟）
 *   pnpm facts:gemini --force          强制重新处理所有文章
 *   pnpm facts:gemini --dry-run        只显示会处理多少文章，不实际调用
 *   pnpm facts:gemini --concurrency=20 自定义并发数（默认 15）
 *
 * 输出文件:
 *   data/structured-facts-gemini.json      每篇文章的 AI 提取结果（key=slug，带哈希缓存）
 *   data/structured-facts-aggregated.json  聚合后的 structuredFacts
 *
 * 之后在 build-author-context.mjs 里读取此文件替换规则生成的 structuredFacts。
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import matter from "gray-matter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const POSTS_DIR = path.join(ROOT_DIR, "content/posts");
const DATA_DIR = path.join(ROOT_DIR, "data");
const OUTPUT_FILE = path.join(DATA_DIR, "structured-facts-gemini.json");

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const DEFAULT_CONCURRENCY = 15;

// ─── CLI 参数 ─────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    force: false,
    dryRun: false,
    concurrency: DEFAULT_CONCURRENCY,
  };
  for (const arg of args) {
    if (arg === "--force") flags.force = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--concurrency=")) {
      const n = parseInt(arg.slice(14), 10);
      if (n > 0) flags.concurrency = n;
    }
  }
  return flags;
}

// ─── 环境变量 ─────────────────────────────────────────────────

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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env 不存在时继续
  }
}

function getGeminiApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("❌ 缺少 GEMINI_API_KEY，请在 .env 中配置");
    process.exit(1);
  }
  return key;
}

function getGeminiModel() {
  return process.env.GEMINI_MODEL || "gemini-2.0-flash";
}

// ─── 工具函数 ─────────────────────────────────────────────────

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

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/[#>*_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentHash(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);
}

// 并发控制：同时最多运行 limit 个 Promise
async function pLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── 文章读取 ─────────────────────────────────────────────────

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

async function loadPosts() {
  const files = await collectMarkdownFiles(POSTS_DIR);
  const posts = [];
  for (const filePath of files) {
    const relative = path.relative(POSTS_DIR, filePath);
    const slug = toSlug(relative);
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = matter(raw);
    const data = parsed.data ?? {};
    if (!data.title || !data.date || data.hide) continue;
    posts.push({
      slug,
      title: String(data.title),
      date: String(data.date),
      categories: Array.isArray(data.categories) ? data.categories.map(String) : [],
      rawContent: parsed.content,
      plainContent: stripMarkdown(parsed.content),
      hash: contentHash(raw),
    });
  }
  posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return posts;
}

// ─── Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个博客内容分析器。给你一篇博客文章（标题 + 正文），请判断作者在这篇文章中实际亲身到访了哪些地点，以及参加了哪些马拉松/长跑赛事，并提取阅读书单信息。

输出规则：
- 只输出 JSON，不要 Markdown，不要解释
- visited：作者本人在本文中明确亲身到访的国家或地区（城市归属到国家/地区级别），例如"去了东京"→"日本"，"在香港"→"中国香港"
- mentioned：文中仅被提及、引用、攀比或作为背景信息的地点（作者本人未实际前往）
- is_travel_post：本文是否是一篇旅行游记/行程记录（true/false）
- races：如果本文记录了作者亲身参加的跑步赛事，提取赛事名称、日期、成绩（完赛时间）；没有则返回空数组
- books：如果本文是读书分享/书单，提取书名列表；没有则返回空数组
- book_count：本文明确提到的已读书本总数（如"读了12本"），没有则返回 null

地点归一化规则：
- 东京、京都、大阪、镰仓、成田等 → "日本"
- 首尔、釜山 → "韩国"
- 曼谷、清迈、普吉 → "泰国"
- 纽约、洛杉矶、旧金山、拉斯维加斯 → "美国"
- 薄荷岛、宿务、马尼拉、长滩岛 → "菲律宾"
- 台北、台湾 → "中国台湾"
- 香港 → "中国香港"
- 澳门 → "中国澳门"
- 温哥华、多伦多 → "加拿大"

关键区分原则：
- "我在东京跑步" → visited: ["日本"]
- "纽约马拉松我没参加" → mentioned: ["美国"]
- "推荐大家去泰国" → 作者本文未去则放 mentioned
- 一篇文章里同时写了多个亲身到访的国家是正常的
- 【重要】年度总结/回顾类文章（如"我2023年去过的地方"、"这些年的旅行"）：只提取本文重点描述的当次行程，历史行程回顾一律放 mentioned，不放 visited
- 【重要】visited 只放"本篇文章主要描述的这次行程"中亲身到访的地点，不包括作者过去其他行程的历史记录

输出格式：
{
  "visited": ["日本"],
  "mentioned": ["美国"],
  "is_travel_post": true,
  "races": [
    { "name": "京都马拉松", "date": "2025-02-23", "result": "4小时12分" }
  ],
  "books": [],
  "book_count": null
}`;

function buildUserPrompt(post) {
  // 正文截断到 3000 字，避免超出 token 限制，旅行游记关键信息都在前段
  const content = post.plainContent.slice(0, 3000);
  return `标题：${post.title}
日期：${post.date}
分类：${post.categories.join("、") || "无"}

正文：
${content}`;
}

// ─── 结果解析 ─────────────────────────────────────────────────

function extractJsonFromText(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
  }
  return null;
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    visited: Array.isArray(raw.visited) ? raw.visited.map(String).filter(Boolean) : [],
    mentioned: Array.isArray(raw.mentioned) ? raw.mentioned.map(String).filter(Boolean) : [],
    is_travel_post: Boolean(raw.is_travel_post),
    races: Array.isArray(raw.races)
      ? raw.races.map((r) => ({
          name: String(r.name ?? ""),
          date: String(r.date ?? ""),
          result: String(r.result ?? ""),
        })).filter((r) => r.name)
      : [],
    books: Array.isArray(raw.books) ? raw.books.map(String).filter(Boolean) : [],
    book_count: typeof raw.book_count === "number" ? raw.book_count : null,
  };
}

// ─── 并发直接调用 ─────────────────────────────────────────────

async function callGeminiDirect(apiKey, model, post, maxOutputTokens = 8192) {
  const url = `${GEMINI_API_BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(post) }] }],
    generation_config: {
      temperature: 0,
      max_output_tokens: maxOutputTokens,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const candidate = json.candidates?.[0];
  const finishReason = candidate?.finishReason;

  // 找非 thought 的文本 part（思考模型的输出 part 没有 thought:true）
  const parts = candidate?.content?.parts ?? [];
  const textPart = parts.find((p) => p.text && !p.thought);
  const text = textPart?.text ?? parts[0]?.text;

  if (finishReason === "MAX_TOKENS") {
    throw new Error(`MAX_TOKENS: 输出被截断，text=${String(text ?? "").slice(0, 80)}`);
  }

  const parsed = extractJsonFromText(text);
  const normalized = normalizeResult(parsed);
  if (!normalized) throw new Error(`JSON 解析失败: ${String(text ?? "").slice(0, 120)}`);
  return normalized;
}

// 带重试的单篇调用
async function callWithRetry(apiKey, model, post, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callGeminiDirect(apiKey, model, post);
    } catch (err) {
      const isRateLimit = err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED");
      if (attempt === maxRetries) throw err;
      const delay = isRateLimit ? 10000 * attempt : 2000 * attempt;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── 聚合 structuredFacts ─────────────────────────────────────

function daysBetween(dateA, dateB) {
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / (24 * 60 * 60 * 1000);
}

function aggregateStructuredFacts(posts, results) {
  // locationMap 只收录 is_travel_post=true 的文章，用于计算行程次数
  // allMentionMap 收录所有 visited 文章，用于补充证据链接
  const travelPostMap = new Map();
  const allPostMap = new Map();

  for (const post of posts) {
    const result = results[post.slug];
    if (!result) continue;
    const item = {
      date: post.date,
      title: post.title,
      url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://luolei.org"}/${post.slug}`,
    };

    for (const loc of result.visited) {
      // 全部 visited 文章
      if (!allPostMap.has(loc)) allPostMap.set(loc, []);
      allPostMap.get(loc).push(item);

      // 只有 is_travel_post=true 的文章才参与行程次数统计
      if (result.is_travel_post) {
        if (!travelPostMap.has(loc)) travelPostMap.set(loc, []);
        travelPostMap.get(loc).push(item);
      }
    }
  }

  const buildTravelEntry = (name, tripPosts, allPosts) => {
    // tripPosts 用于计算行程次数（仅 travel post）
    // allPosts 用于补充证据（所有 visited 文章）
    const sorted = [...tripPosts].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const trips = [];
    for (const item of sorted) {
      const last = trips[trips.length - 1];
      // 60天窗口：覆盖同一行程的多篇连载游记
      if (!last || daysBetween(last.lastDate, item.date) > 60) {
        trips.push({ lastDate: item.date, posts: [item] });
      } else {
        last.posts.push(item);
        last.lastDate = item.date;
      }
    }

    // 证据：每次行程取最具代表性的一篇（最后发布的），最多展示3次行程
    const evidence = trips
      .map((t) => t.posts[t.posts.length - 1])
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 3)
      .map(({ title, date, url }) => ({ title, date, url }));

    const allSorted = [...allPosts].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return {
      name,
      tripCount: trips.length,
      countMode: "at_least",
      firstMentionedAt: allSorted[0]?.date ?? sorted[0]?.date ?? "",
      latestMentionedAt: allSorted[allSorted.length - 1]?.date ?? sorted[sorted.length - 1]?.date ?? "",
      evidence,
    };
  };

  const REGION_KIND = new Set(["中国香港", "中国台湾", "中国澳门"]);
  const countries = [];
  const regions = [];

  // 合并所有出现过的地点（travel post 或 all post 均可能有）
  const allLocations = new Set([...travelPostMap.keys(), ...allPostMap.keys()]);

  for (const name of allLocations) {
    const tripPosts = travelPostMap.get(name) ?? [];
    const allPosts = allPostMap.get(name) ?? [];
    if (tripPosts.length === 0 && allPosts.length === 0) continue;
    const entry = buildTravelEntry(name, tripPosts, allPosts);
    if (entry.tripCount === 0) continue; // 没有 travel post 记录则跳过
    if (REGION_KIND.has(name)) {
      regions.push(entry);
    } else {
      countries.push(entry);
    }
  }

  countries.sort((a, b) => b.tripCount - a.tripCount || new Date(b.latestMentionedAt).getTime() - new Date(a.latestMentionedAt).getTime());
  regions.sort((a, b) => b.tripCount - a.tripCount);

  // 马拉松赛事
  const raceMap = new Map();
  for (const post of posts) {
    const result = results[post.slug];
    if (!result?.races?.length) continue;
    for (const race of result.races) {
      const key = `${race.name}|${race.date}`;
      if (!raceMap.has(key)) {
        raceMap.set(key, {
          ...race,
          postUrl: `${process.env.NEXT_PUBLIC_SITE_URL || "https://luolei.org"}/${post.slug}`,
        });
      }
    }
  }
  const completedEvents = [...raceMap.values()]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(({ name, date, result, postUrl }) => ({ name, date, result: result || undefined, url: postUrl }));

  // 阅读
  const roundupPosts = [];
  let lifetimeReadCount = null;
  for (const post of posts) {
    const result = results[post.slug];
    if (!result) continue;

    if (result.book_count != null) {
      const val = result.book_count;
      if (!lifetimeReadCount || val > lifetimeReadCount.value) {
        lifetimeReadCount = {
          value: val,
          mode: "approx_public_record",
          sourceTitle: post.title,
          sourceUrl: `${process.env.NEXT_PUBLIC_SITE_URL || "https://luolei.org"}/${post.slug}`,
          sourceDate: post.date,
        };
      }
    }

    if (result.books?.length) {
      roundupPosts.push({
        title: post.title,
        date: post.date,
        url: `${process.env.NEXT_PUBLIC_SITE_URL || "https://luolei.org"}/${post.slug}`,
        bookCount: result.books.length,
        books: result.books.slice(0, 8),
      });
    }
  }
  roundupPosts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    travel: { countries, regions },
    races: { completedEvents },
    reading: { lifetimeReadCount, roundupPosts },
  };
}

// ─── 主流程 ───────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  await loadEnv();

  const apiKey = getGeminiApiKey();
  const model = getGeminiModel();

  console.log("\n📚 读取博客文章...");
  const posts = await loadPosts();
  console.log(`   共 ${posts.length} 篇文章`);

  const existing = await readJson(OUTPUT_FILE, { meta: {}, articles: {} });
  const cachedArticles = existing.articles ?? {};

  const toProcess = args.force
    ? posts
    : posts.filter((post) => {
        const cached = cachedArticles[post.slug];
        return !cached || cached._hash !== post.hash;
      });

  console.log(`   需要处理: ${toProcess.length} 篇（已缓存: ${posts.length - toProcess.length} 篇）`);

  if (toProcess.length === 0) {
    console.log("\n✅ 所有文章均已处理，无需重新调用");
    const structuredFacts = aggregateStructuredFacts(posts, cachedArticles);
    await writeJson(path.join(DATA_DIR, "structured-facts-aggregated.json"), {
      generatedAt: new Date().toISOString(),
      model,
      ...structuredFacts,
    });
    console.log(`   已重新聚合: ${path.join(DATA_DIR, "structured-facts-aggregated.json")}`);
    return;
  }

  if (args.dryRun) {
    console.log("\n🔍 Dry Run 模式，不实际调用：");
    for (const p of toProcess.slice(0, 10)) {
      console.log(`   - [${p.slug}] ${p.title}`);
    }
    if (toProcess.length > 10) console.log(`   ... 共 ${toProcess.length} 篇`);
    return;
  }

  // ── 并发调用 ──
  console.log(`\n🚀 并发调用 Gemini（${args.concurrency} 并发，模型: ${model}）...`);

  let done = 0;
  let successCount = 0;
  let failCount = 0;
  const newResults = {};

  // 进度显示（覆盖同一行）
  const printProgress = () => {
    process.stdout.write(
      `\r   进度: ${done}/${toProcess.length}  ✅ ${successCount}  ❌ ${failCount}  `,
    );
  };

  // 定期保存中间结果（每 30 篇或每 60 秒）
  let lastSave = Date.now();
  const saveCheckpoint = async () => {
    const merged = { ...cachedArticles, ...newResults };
    await writeJson(OUTPUT_FILE, {
      meta: { lastCompletedAt: new Date().toISOString(), model, totalArticles: Object.keys(merged).length },
      articles: merged,
    });
    lastSave = Date.now();
  };

  const tasks = toProcess.map((post) => async () => {
    try {
      const result = await callWithRetry(apiKey, model, post);
      result._hash = post.hash;
      newResults[post.slug] = result;
      successCount++;
    } catch (err) {
      console.warn(`\n   ⚠️  [${post.slug}] 失败: ${err.message.slice(0, 80)}`);
      failCount++;
    } finally {
      done++;
      printProgress();
      // 每处理 50 篇保存一次中间结果
      if (done % 50 === 0 || Date.now() - lastSave > 60_000) {
        await saveCheckpoint();
      }
    }
  });

  printProgress();
  await pLimit(tasks, args.concurrency);
  process.stdout.write("\n");

  // ── 最终保存 ──
  const merged = { ...cachedArticles, ...newResults };
  await writeJson(OUTPUT_FILE, {
    meta: { lastCompletedAt: new Date().toISOString(), model, totalArticles: Object.keys(merged).length },
    articles: merged,
  });

  console.log("\n🔢 聚合结构化事实...");
  const structuredFacts = aggregateStructuredFacts(posts, merged);
  await writeJson(path.join(DATA_DIR, "structured-facts-aggregated.json"), {
    generatedAt: new Date().toISOString(),
    model,
    ...structuredFacts,
  });

  console.log(`\n✅ 全部完成！成功 ${successCount} 篇，失败 ${failCount} 篇`);
  console.log(`   逐文章结果: ${OUTPUT_FILE}`);
  console.log(`   聚合结果:   ${path.join(DATA_DIR, "structured-facts-aggregated.json")}`);
  console.log(`\n📊 摘要:`);
  console.log(`   旅行国家: ${structuredFacts.travel.countries.length} 个`);
  console.log(`   旅行地区: ${structuredFacts.travel.regions.length} 个`);
  console.log(`   马拉松赛事: ${structuredFacts.races.completedEvents.length} 场`);
  console.log(`   书单文章: ${structuredFacts.reading.roundupPosts.length} 篇`);
  console.log(`\n下一步：运行 pnpm profile:context 重新生成 author-context.json`);
}

main().catch((err) => {
  console.error("\n❌ 脚本执行失败:", err.message);
  process.exit(1);
});
