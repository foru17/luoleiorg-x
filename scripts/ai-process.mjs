/**
 * AI 文章批处理脚本
 *
 * 用法:
 *   pnpm ai:process                   处理所有文章（跳过已缓存且未变更的）
 *   pnpm ai:process --force            强制重新处理所有文章
 *   pnpm ai:process --slug=xxx         只处理指定文章
 *   pnpm ai:process --task=summary     只运行摘要任务
 *   pnpm ai:process --task=seo         只运行 SEO 任务
 *   pnpm ai:process --task=chat-guide  只运行文章对话引导任务
 *   pnpm ai:process --recent=10        处理最近 10 篇文章
 *   pnpm ai:process --new-only         只处理没有缓存的文章
 *   pnpm ai:process --dry-run          只显示会处理哪些文章
 *   pnpm ai:process --concurrency=10   设置并发数（默认 10）
 *   pnpm ai:process --no-skip          忽略跳过列表，重试所有文章
 *   pnpm ai:process --clear-skip       清空跳过列表后再处理
 */

import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  buildArticleChatGuideContent,
  normalizeGuideOpeningLine,
  normalizeGuideQuestions,
  normalizeGuideTopics,
} from "../src/lib/content/article-chat-guide-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const CONTENT_DIR = path.join(ROOT_DIR, "content/posts");
const DATA_DIR = path.join(ROOT_DIR, "data");

// ─── CLI 参数解析 ───────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    force: false,
    slug: null,
    task: null, // "summary" | "seo" | "chat-guide" | null (all)
    recent: null,
    newOnly: false,
    dryRun: false,
    concurrency: 10,
    noSkip: false,
    clearSkip: false,
  };

  for (const arg of args) {
    if (arg === "--force") flags.force = true;
    else if (arg === "--new-only") flags.newOnly = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--no-skip") flags.noSkip = true;
    else if (arg === "--clear-skip") flags.clearSkip = true;
    else if (arg.startsWith("--slug=")) flags.slug = arg.split("=")[1];
    else if (arg.startsWith("--task=")) flags.task = arg.split("=")[1];
    else if (arg.startsWith("--recent="))
      flags.recent = parseInt(arg.split("=")[1], 10);
    else if (arg.startsWith("--concurrency="))
      flags.concurrency = parseInt(arg.split("=")[1], 10);
  }

  return flags;
}

// ─── 环境变量 ───────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  return fs
    .readFile(envPath, "utf-8")
    .then((content) => {
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
    })
    .catch(() => {});
}

function getConfig() {
  const baseUrl = process.env.AI_BASE_URL;
  const apiKey = process.env.AI_API_KEY;
  const model = process.env.AI_MODEL;

  if (!baseUrl || !apiKey || !model) {
    console.error("❌ 缺少 AI 配置，请在 .env 中设置:");
    console.error(
      "   AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    console.error("   AI_API_KEY=your_api_key_here");
    console.error("   AI_MODEL=qwen-plus");
    process.exit(1);
  }

  return { baseUrl, apiKey, model };
}

// ─── Frontmatter 解析（简易版，不依赖 gray-matter） ─────────

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { data: {}, content: raw };

  const frontmatterStr = match[1];
  const content = raw.slice(match[0].length).trim();
  const data = {};

  let currentKey = null;
  let inArray = false;

  for (const line of frontmatterStr.split("\n")) {
    const trimmed = line.trim();

    if (inArray) {
      if (trimmed.startsWith("- ")) {
        let val = trimmed.slice(2).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        data[currentKey].push(val);
        continue;
      } else {
        inArray = false;
      }
    }

    const kvMatch = trimmed.match(/^(\w+):\s*(.*)/);
    if (kvMatch) {
      const key = kvMatch[1];
      let value = kvMatch[2].trim();

      if (value === "") {
        data[key] = [];
        currentKey = key;
        inArray = true;
      } else {
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (value === "true") value = true;
        else if (value === "false") value = false;
        data[key] = value;
      }
    }
  }

  return { data, content };
}

// ─── 文章扫描 ───────────────────────────────────────────────

async function scanArticles() {
  const files = await fs.readdir(CONTENT_DIR);
  const articles = [];

  for (const file of files) {
    if (!file.endsWith(".md")) continue;

    const filePath = path.join(CONTENT_DIR, file);
    const raw = await fs.readFile(filePath, "utf-8");
    const { data, content } = parseFrontmatter(raw);

    if (!data.title || !data.date || data.hide) continue;

    const slug = file.replace(/\.md$/, "");
    const contentHash = crypto
      .createHash("md5")
      .update(content)
      .digest("hex")
      .slice(0, 8);

    articles.push({
      slug,
      title: data.title,
      date: data.date,
      categories: Array.isArray(data.categories) ? data.categories : [],
      content,
      contentHash,
      dateTime: new Date(data.date).getTime(),
    });
  }

  articles.sort((a, b) => b.dateTime - a.dateTime);
  return articles;
}

// ─── 缓存管理（带写入锁） ────────────────────────────────────

/**
 * 为每个缓存文件创建一个带锁的管理器
 * 所有并发的 worker 通过 manager 串行写入同一个 JSON 文件
 */
function createCacheManager(cacheFile) {
  let cache = null;
  let writeQueue = Promise.resolve();

  return {
    async load() {
      const cachePath = path.join(DATA_DIR, cacheFile);
      try {
        const raw = await fs.readFile(cachePath, "utf-8");
        cache = JSON.parse(raw);
      } catch {
        cache = {
          meta: { lastUpdated: null, model: null, totalProcessed: 0 },
          articles: {},
        };
      }
      return cache;
    },

    getCache() {
      return cache;
    },

    /** 串行写入：无论多少并发 worker 同时调用，写操作排队执行 */
    writeEntry(slug, entry, model) {
      writeQueue = writeQueue.then(async () => {
        cache.articles[slug] = entry;
        cache.meta.lastUpdated = new Date().toISOString();
        cache.meta.model = model;
        cache.meta.totalProcessed = Object.keys(cache.articles).length;

        await fs.mkdir(DATA_DIR, { recursive: true });
        const cachePath = path.join(DATA_DIR, cacheFile);
        await fs.writeFile(
          cachePath,
          JSON.stringify(cache, null, 2),
          "utf-8",
        );
      });
      return writeQueue;
    },
  };
}

// ─── AI API 调用 ─────────────────────────────────────────────

// ─── 跳过列表管理 ────────────────────────────────────────────

const SKIP_LIST_FILE = path.join(DATA_DIR, "ai-skip-list.json");

async function loadSkipList() {
  try {
    const raw = await fs.readFile(SKIP_LIST_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveSkipList(skipList) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(SKIP_LIST_FILE, JSON.stringify(skipList, null, 2), "utf-8");
}

/**
 * 将失败的文章添加到跳过列表
 * key 格式: "taskName:slug"，确保不同任务独立跟踪
 */
async function addToSkipList(skipList, taskName, slug, errorMsg) {
  const key = `${taskName}:${slug}`;
  const existing = skipList[key];
  skipList[key] = {
    slug,
    task: taskName,
    reason: errorMsg,
    failCount: (existing?.failCount ?? 0) + 1,
    lastFailedAt: new Date().toISOString(),
    firstFailedAt: existing?.firstFailedAt ?? new Date().toISOString(),
  };
  await saveSkipList(skipList);
}

// ─── AI API 调用（原位置） ──────────────────────────────────────

const RATE_LIMIT_MAX_RETRIES = 8; // 429 最多重试 8 次

async function callAI(config, systemPrompt, userPrompt) {
  const url = `${config.baseUrl}/chat/completions`;

  const body = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 1,
    max_tokens: 2048,
  };

  let lastError = null;

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // 429 限速：指数退避 + 随机抖动，避免重试风暴
      if (response.status === 429) {
        const baseSec = Math.min(2 ** attempt, 30); // 1,2,4,8,16,30,30...
        const jitter = Math.random() * baseSec * 0.5; // 0~50% 随机抖动
        await sleep((baseSec + jitter) * 1000);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("API 返回空内容");

      return content;
    } catch (err) {
      lastError = err;
      // 非 429 的网络错误，重试 1 次
      if (attempt === 0) {
        await sleep(2000);
        continue;
      }
      throw err;
    }
  }

  throw lastError ?? new Error("超过最大重试次数");
}

// ─── 任务定义 ────────────────────────────────────────────────

const TASKS = {
  summary: {
    name: "summary",
    cacheFile: "ai-summaries.json",

    buildPrompt(article) {
      return {
        system: `你是一位专业的中文博客内容分析师。请分析给定博客文章，并只返回**严格合法的 JSON**（RFC8259），不得输出任何额外文字或 Markdown 代码块。

请生成以下字段：

1) summary：
一句话总结文章核心内容（50-80字）。
应包含：主题 + 关键动作/方法 + 结论/收益（若文中存在）。

2) abstract：
详细摘要（150-300字）。
要求：
- 客观覆盖文章的背景/问题
- 核心方案或步骤
- 关键技术点（如代码、配置、命令、架构）
- 结论或效果（如有）
- 不粘贴大段代码

3) keyPoints：
3-6条要点列表，用于结构化索引与语义检索。
要求：
- 每条≤30字
- 陈述句
- 信息密度高
- 覆盖：问题/背景、方案、关键技术点、结果/坑点
- 不要与summary重复
- 不要空泛表达（避免"经验分享""技术总结"等）

4) tags：
3-5个标签。
要求：
- 去重
- 尽量具体
- 允许中文或通用英文技术术语
- 避免泛标签（如"技术""随笔"）
- 英文术语采用常见标准写法（如 Next.js、Docker、Kubernetes）

5) readingTime：
整数分钟。
估算规则：
- 中文阅读速度按350字/分钟
- 若代码块较多或技术细节密集，乘以1.3
- 若为叙事或轻量内容，乘以1.0
- 向上取整，最小为1

重要约束：
- 不添加原文不存在的信息
- 不引用外部知识补全
- 忽略 Markdown 噪声（图片引用、代码块标记等）
- 输出必须可直接 JSON.parse 解析

输出格式必须严格如下（字段齐全）：
{"summary":"...","abstract":"...","keyPoints":["...","..."],"tags":["...","..."],"readingTime":5}`,

        user: `文章标题：${article.title}
文章分类：${article.categories.join(", ") || "无"}

文章正文：
${article.content.slice(0, 8000)}`,
      };
    },

    parseResponse(raw) {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = (jsonMatch ? jsonMatch[1] : raw).trim();
      const parsed = JSON.parse(jsonStr);

      if (!parsed.summary || !parsed.abstract || !Array.isArray(parsed.tags)) {
        throw new Error("摘要数据格式不完整");
      }

      const readingTimeRaw = parsed.readingTime;
      const readingTime =
        typeof readingTimeRaw === "number"
          ? readingTimeRaw
          : typeof readingTimeRaw === "string"
            ? parseInt(readingTimeRaw, 10) || undefined
            : undefined;

      return {
        summary: parsed.summary,
        abstract: parsed.abstract,
        keyPoints: cleanStringArray(parsed.keyPoints),
        tags: cleanStringArray(parsed.tags),
        readingTime,
      };
    },
  },

  seo: {
    name: "seo",
    cacheFile: "ai-seo.json",

    buildPrompt(article) {
      return {
        system: `你是一位资深中文 SEO 与内容增长专家。请基于给定博客文章生成 SEO 文案与关键词数据，并只返回**严格合法的 JSON**（RFC8259），不得输出任何额外文字或 Markdown 代码块。

请输出以下字段：

1) metaDescription：
用于网页 <meta name="description"> 的描述（120-160字）。
要求：
- 自然包含 1-2 个核心关键词（不要堆砌）
- 信息结构建议：主题/对象 + 解决的问题/收益 + 关键方法/亮点（若有）
- 不要复读标题（不要以"本文/这篇文章"开头）
- 不要换行，不要引号，不要使用夸张营销词（如"史上最强/必看"）

2) keywords：
5-8 个 SEO 关键词或短语（字符串数组），按重要性从高到低排序。
要求：
- 组合：2-3 个核心短词 + 3-5 个长尾短语（更像用户会搜的表达）
- 避免过泛词（如"技术/教程/经验/分享/博客"）
- 去重，避免同义重复
- 中文优先；通用技术名词可用英文/标准写法（如 Next.js、Cloudflare Workers、Docker）
- 长尾短语可包含"怎么做/报错/排查/对比/最佳实践/配置"等意图词（仅在文章内容支持时使用）

3) ogDescription：
用于 Open Graph / 社交媒体分享的描述（60-100字）。
要求：
- 比 metaDescription 更口语化、更吸引点击
- 强调"读者能得到什么"或"解决什么痛点"
- 不要标题复读，不要换行，不要用引号

重要约束：
- 只能使用文章中出现或可直接概括出的信息；不得凭空补充工具/数据/结论
- 输入可能包含 Markdown、代码块、链接；请忽略格式噪声，聚焦内容
- 输出必须可直接 JSON.parse 解析

输出格式必须严格如下（字段齐全）：
{"metaDescription":"...","keywords":["...","..."],"ogDescription":"..."}`,

        user: `文章标题：${article.title}
文章分类：${article.categories.join(", ") || "无"}

文章正文：
${article.content.slice(0, 8000)}`,
      };
    },

    parseResponse(raw) {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = (jsonMatch ? jsonMatch[1] : raw).trim();
      const parsed = JSON.parse(jsonStr);

      if (
        !parsed.metaDescription ||
        !Array.isArray(parsed.keywords) ||
        !parsed.ogDescription
      ) {
        throw new Error("SEO 数据格式不完整");
      }
      return {
        metaDescription: parsed.metaDescription,
        keywords: cleanStringArray(parsed.keywords),
        ogDescription: parsed.ogDescription,
      };
    },
  },

  "chat-guide": {
    name: "chat-guide",
    cacheFile: "ai-article-chat-guides.json",

    buildPrompt(article) {
      return {
        system: `你是一位擅长为中文博客读者设计“边读边聊”问题的内容编辑。请分析给定文章，并只返回**严格合法的 JSON**（RFC8259），不得输出任何额外文字或 Markdown 代码块。

你的目标不是再做摘要，而是预测普通读者读到这篇文章时，最自然、最想继续追问的内容。

请输出以下字段：

1) openingLine：
一句自然的开场引导语（18-40字）。
要求：
- 语气像作者分身在陪读者一起看这篇文章
- 自然、克制、可信，不要过度活泼，更不要像营销文案
- 不要复述文章标题
- 不要出现“正在看《...》”“文章 AI 对话”“智能助手”等产品化套话
- 不要写成摘要或功能说明
- 避免网络热词和表演感表达，例如“抄作业”“盘盘”“掰扯”“也太稳了”

2) focusQuestions：
3 个可直接点击提问的问题。
要求：
- 必须是读者视角、自然口语、短句
- 优先问文章里真的写到了、且普通人最关心的具体细节
- 如果文章涉及路线、住宿、预算、准备项、设备、参数、步骤、坑点、结论、取舍、适用场景、对比，请优先转成这些问题
- 至少 2 个问题要足够具体，能从原文中直接找到明确答案
- 避免空泛、总结腔、提示词味表达，例如：
  - “这篇文章最值得记住的 3 个重点是什么”
  - “文中提到……背后的原因是什么”
  - “如果我想复用文中的做法……应该从哪一步开始”
- 不要照抄原文长句，不要把 key points 原样改写成问题
- 每条最好不超过 22 个字，最长不超过 30 个字

3) extensionTopics：
2 个顺着本文自然延伸的问题。
要求：
- 仍然使用读者视角
- 要贴近本文，不要只写泛泛的“推荐相关文章”
- 可以引到相邻经历、类似方案、进一步比较，但语气要自然
- 每条最好不超过 24 个字

重要约束：
- 只能基于文章已有内容判断，不要补充外部知识
- 不要添加编号、解释、标题、括号说明
- 输出必须可直接 JSON.parse 解析

输出格式必须严格如下（字段齐全）：
{"openingLine":"...","focusQuestions":["...","...","..."],"extensionTopics":["...","..."]}`,

        user: `文章标题：${article.title}
文章分类：${article.categories.join(", ") || "无"}

文章正文：
${article.content}`,
      };
    },

    parseResponse(raw, article) {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = (jsonMatch ? jsonMatch[1] : raw).trim();
      const parsed = JSON.parse(jsonStr);

      const openingLineSource =
        typeof parsed.openingLine === "string"
          ? parsed.openingLine
          : typeof parsed.intro === "string"
            ? parsed.intro
            : typeof parsed.lead === "string"
              ? parsed.lead
              : "";
      const focusQuestionSource =
        parsed.focusQuestions ?? parsed.questions ?? parsed.quickQuestions ?? parsed.suggestedQuestions;
      const extensionTopicSource =
        parsed.extensionTopics ?? parsed.followUps ?? parsed.relatedQuestions ?? parsed.topics;

      const repairedGuide = buildArticleChatGuideContent(
        {
          title: article?.title ?? "",
          categories: article?.categories ?? [],
        },
        {
          openingLine: normalizeGuideOpeningLine(openingLineSource),
          focusQuestions: normalizeGuideQuestions(focusQuestionSource, 3),
          extensionTopics: normalizeGuideTopics(extensionTopicSource, 2),
        },
      );

      return repairedGuide;
    },
  },
};

// ─── 工具函数 ────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 去重、去空的字符串数组清洗 */
function cleanStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
}

function shouldCountAsSystemFailure(message) {
  const text = String(message ?? "");
  return /fetch failed|API \d+|aborted|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket hang up/i.test(
    text,
  );
}

// ─── 并发处理池 ──────────────────────────────────────────────

/**
 * 并发处理文章队列
 *
 * @param {Array} queue - 待处理文章列表
 * @param {Object} task - 任务定义（summary / seo）
 * @param {Object} cacheManager - 缓存管理器（带写入锁）
 * @param {Object} config - AI API 配置
 * @param {number} concurrency - 最大并发数
 * @param {Object} skipList - 跳过列表（会就地修改并持久化）
 * @returns {{ success: number, failed: number, failures: Array, skippedByError: number }}
 */
async function processQueue(queue, task, cacheManager, config, concurrency, skipList) {
  let success = 0;
  let failed = 0;
  let completed = 0;
  const failures = [];
  let consecutiveFailures = 0;
  let stopped = false;

  const startTime = Date.now();

  // 实时状态行
  function printStatus() {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate =
      completed > 0 ? ((completed / (Date.now() - startTime)) * 1000).toFixed(1) : "0";
    const remaining = completed > 0
      ? Math.round(((queue.length - completed) / completed) * ((Date.now() - startTime) / 1000))
      : "?";

    const pct = Math.round((completed / queue.length) * 100);
    const barWidth = 25;
    const filled = Math.round((completed / queue.length) * barWidth);
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

    process.stdout.write(
      `\r   [${bar}] ${completed}/${queue.length} (${pct}%) | ✅ ${success} ❌ ${failed} | ${elapsed}s | ~${remaining}s left | ${rate}/s   `,
    );
  }

  // 队列索引，每个 worker 原子地取下一个任务
  let nextIndex = 0;

  async function worker() {
    while (!stopped) {
      const idx = nextIndex++;
      if (idx >= queue.length) break;

      const article = queue[idx];

      try {
        const prompt = task.buildPrompt(article);
        const raw = await callAI(config, prompt.system, prompt.user);
        const data = task.parseResponse(raw, article);

        await cacheManager.writeEntry(
          article.slug,
          {
            data,
            contentHash: article.contentHash,
            processedAt: new Date().toISOString(),
          },
          config.model,
        );

        // 处理成功，从跳过列表中移除（如果之前失败过）
        const skipKey = `${task.name}:${article.slug}`;
        if (skipList[skipKey]) {
          delete skipList[skipKey];
          await saveSkipList(skipList);
        }

        success++;
        consecutiveFailures = 0;
      } catch (err) {
        failed++;
        failures.push({ slug: article.slug, error: err.message });

        // 将失败的文章加入跳过列表，下次运行时自动跳过
        await addToSkipList(skipList, task.name, article.slug, err.message);

        // 429 是限速，callAI 内部已充分重试后仍失败，不计入连续失败
        const is429 = err.message?.includes("429");
        const isSystemFailure = shouldCountAsSystemFailure(err.message);
        if (!is429 && isSystemFailure) {
          consecutiveFailures++;
          // 连续失败 10 次可能是 API 级别的问题（key 失效、服务宕机等），暂停处理
          if (consecutiveFailures >= 10) {
            stopped = true;
            console.error(
              `\n\n   ❌ 连续失败 10 次（非限速错误），暂停处理。最后错误: ${err.message}`,
            );
            console.error(
              `   💡 失败的文章已记录到跳过列表，下次运行将自动跳过`,
            );
          }
        } else if (!isSystemFailure) {
          consecutiveFailures = 0;
        }
      }

      completed++;
      printStatus();
    }
  }

  // 启动 N 个 worker 并发处理
  const workers = [];
  const workerCount = Math.min(concurrency, queue.length);
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  // 清除状态行，打印最终结果
  process.stdout.write("\r" + " ".repeat(100) + "\r");

  return { success, failed, failures, elapsed };
}

// ─── 主流程 ──────────────────────────────────────────────────

async function main() {
  const flags = parseArgs();
  await loadEnv();
  const config = getConfig();

  // 加载跳过列表
  let skipList = await loadSkipList();

  if (flags.clearSkip) {
    skipList = {};
    await saveSkipList(skipList);
    console.log("🗑️  已清空跳过列表\n");
  }

  console.log("🤖 AI 文章处理器");
  console.log("━".repeat(50));
  console.log(`   模型: ${config.model}`);
  console.log(`   API:  ${config.baseUrl}`);
  console.log(`   并发: ${flags.concurrency}`);
  if (flags.noSkip) console.log(`   跳过列表: 已忽略 (--no-skip)`);
  console.log("");

  // 1. 扫描文章
  console.log("📂 扫描文章...");
  let articles = await scanArticles();
  console.log(`   找到 ${articles.length} 篇文章`);

  // 2. 过滤
  if (flags.slug) {
    articles = articles.filter((a) => a.slug === flags.slug);
    if (articles.length === 0) {
      console.error(`❌ 未找到文章: ${flags.slug}`);
      process.exit(1);
    }
    console.log(`   指定文章: ${flags.slug}`);
  }

  if (flags.recent) {
    articles = articles.slice(0, flags.recent);
    console.log(`   最近 ${flags.recent} 篇`);
  }

  // 3. 确定要运行的任务
  const taskNames = flags.task ? [flags.task] : ["summary", "seo", "chat-guide"];
  const invalidTask = taskNames.find((t) => !TASKS[t]);
  if (invalidTask) {
    console.error(`❌ 未知任务: ${invalidTask}（可选: summary, seo, chat-guide）`);
    process.exit(1);
  }

  console.log(`   任务: ${taskNames.join(", ")}`);
  console.log("");

  // 4. 逐任务处理
  for (const taskName of taskNames) {
    const task = TASKS[taskName];
    console.log(`📋 任务: ${task.name}`);
    console.log("─".repeat(50));

    const cacheManager = createCacheManager(task.cacheFile);
    const cache = await cacheManager.load();

    // 确定需要处理的文章
    const queue = [];
    let skipped = 0;
    let skippedBySkipList = 0;
    const skippedSlugs = []; // 被跳过列表排除的文章 slug

    for (const article of articles) {
      const cached = cache.articles[article.slug];
      const skipKey = `${taskName}:${article.slug}`;

      // 检查跳过列表（--slug 指定的文章不受跳过列表影响）
      if (!flags.noSkip && !flags.slug && skipList[skipKey]) {
        skippedBySkipList++;
        skippedSlugs.push(article.slug);
        continue;
      }

      if (flags.force) {
        queue.push(article);
      } else if (!cached) {
        queue.push(article);
      } else if (flags.newOnly) {
        skipped++;
      } else if (cached.contentHash !== article.contentHash) {
        queue.push(article);
      } else {
        skipped++;
      }
    }

    console.log(`   跳过: ${skipped} 篇（缓存有效）`);
    if (skippedBySkipList > 0) {
      console.log(`   跳过: ${skippedBySkipList} 篇（之前处理失败，已标记跳过）`);
      console.log(`         使用 --no-skip 可重试这些文章，--clear-skip 可清空跳过列表`);
      if (skippedBySkipList <= 20) {
        for (const slug of skippedSlugs) {
          const info = skipList[`${taskName}:${slug}`];
          console.log(`         - ${slug} (失败 ${info.failCount} 次, ${info.reason.slice(0, 60)})`);
        }
      }
    }
    console.log(`   待处理: ${queue.length} 篇`);

    if (flags.dryRun) {
      if (queue.length > 0) {
        console.log("\n   将处理以下文章:");
        for (const a of queue) {
          const reason = cache.articles[a.slug] ? "内容变更" : "新文章";
          console.log(`   - ${a.slug} (${reason})`);
        }
      }
      console.log("");
      continue;
    }

    if (queue.length === 0) {
      console.log("   ✅ 无需处理\n");
      continue;
    }

    // 并发处理
    console.log("");
    const result = await processQueue(
      queue,
      task,
      cacheManager,
      config,
      flags.concurrency,
      skipList,
    );

    console.log(`   ✅ 成功: ${result.success}  ❌ 失败: ${result.failed}  ⏱️  ${result.elapsed}s`);
    if (result.failures.length > 0) {
      console.log(`   失败文章（已加入跳过列表，下次运行将自动跳过）:`);
      for (const f of result.failures) {
        console.log(`      - ${f.slug}: ${f.error}`);
      }
    }
    console.log("");
  }

  console.log("🏁 处理完成");
}

main().catch((err) => {
  console.error("❌ 致命错误:", err.message);
  process.exit(1);
});
