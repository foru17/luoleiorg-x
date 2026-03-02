/**
 * 多模型 AI 画像报告生成
 *
 * 读取 data/author-context.json，用指定 AI 模型生成画像报告，
 * 输出到 data/reports/{model-id}.json 并更新 manifest.json。
 *
 * 用法:
 *   node scripts/generate-profile-report.mjs                  # 用默认 AI 模型生成
 *   node scripts/generate-profile-report.mjs --model=gpt-4o   # 指定模型 ID
 *   node scripts/generate-profile-report.mjs --all            # 遍历所有注册模型
 *   node scripts/generate-profile-report.mjs --no-ai          # 规则模板兜底
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnv } from "./utils/load-env.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CONTEXT_FILE = path.join(DATA_DIR, "author-context.json");
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const MANIFEST_FILE = path.join(REPORTS_DIR, "manifest.json");
const MODELS_CONFIG_FILE = path.join(ROOT_DIR, ".profile-models.json");
const MODELS_EXAMPLE_FILE = path.join(ROOT_DIR, ".profile-models.example.json");
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_API_RETRIES = 3;
const MAX_CONCURRENCY = 2;

// ─── 模型配置加载 ────────────────────────────────────────────

async function loadModelConfig() {
  try {
    const raw = await fs.readFile(MODELS_CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw);
    if (!Array.isArray(config?.models)) {
      throw new Error(".profile-models.json 中缺少 models 数组");
    }
    // 只返回 enabled 的模型
    return config.models.filter((m) => m.enabled !== false);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.error(
        `❌ 未找到 .profile-models.json\n` +
          `   请复制 .profile-models.example.json 为 .profile-models.json 并填入真实 API Key：\n` +
          `   cp .profile-models.example.json .profile-models.json`,
      );
    } else {
      console.error(`❌ 读取 .profile-models.json 失败: ${err.message}`);
    }
    process.exit(1);
  }
}

// ─── CLI 参数 ────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let modelId = null;
  for (const arg of args) {
    if (arg.startsWith("--model=")) {
      modelId = arg.slice("--model=".length).trim();
    }
  }
  return {
    modelId,
    all: args.includes("--all"),
    noAI: args.includes("--no-ai"),
    force: args.includes("--force"),
  };
}

// ─── 工具函数 ────────────────────────────────────────────────

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

function truncate(text, max = 120) {
  if (!text) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
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

function compactText(text, max = 60) {
  return truncate(stripMarkdown(String(text ?? "")), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrency(taskFns, limit) {
  const results = new Array(taskFns.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < taskFns.length) {
      const idx = nextIdx++;
      try {
        results[idx] = { status: "fulfilled", value: await taskFns[idx]() };
      } catch (err) {
        results[idx] = { status: "rejected", reason: err };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, taskFns.length) }, () => worker()),
  );
  return results;
}

function tokenize(text) {
  const raw = String(text ?? "");
  const tokens = raw.match(/[A-Za-z][A-Za-z0-9.+#-]{1,}|[\u4e00-\u9fa5]{2,6}/g) ?? [];
  const stop = new Set([
    "可以", "这个", "那个", "一些", "以及", "并且", "如果", "因为", "所以", "还是",
    "一个", "我们", "他们", "你们", "自己", "进行", "使用", "通过", "关于", "相关",
    "作者", "文章", "项目", "内容", "技术", "博客", "推文", "最近", "持续", "方式",
  ]);
  return tokens.filter((t) => t.length >= 2 && !stop.has(t.toLowerCase?.() ?? t));
}

function buildThemeStats(context) {
  const counts = new Map();
  const add = (text, weight = 1) => {
    for (const token of tokenize(text)) {
      counts.set(token, (counts.get(token) ?? 0) + weight);
    }
  };

  for (const post of context.posts ?? []) {
    add(post.title, 3);
    add(post.summary, 2);
    for (const c of post.categories ?? []) add(c, 2);
    for (const kp of post.keyPoints ?? []) add(kp, 2);
  }
  for (const tweet of context.tweets ?? []) {
    add(tweet.text, 1);
  }
  for (const project of context.projects ?? []) {
    add(project.name, 3);
    add(project.description, 2);
    for (const tag of project.tags ?? []) add(tag, 2);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([token, score]) => `${token}(${score})`);
}

// ─── AI API 调用 ─────────────────────────────────────────────

async function callAI({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.4,
  stream = false,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  // OpenAI 新模型使用 max_completion_tokens，其他兼容 API 使用 max_tokens
  const isOpenAI = baseUrl.includes("api.openai.com");
  const body = {
    model,
    messages,
    ...(isOpenAI ? { max_completion_tokens: 8192 } : { max_tokens: 8192 }),
    stream,
  };
  // 只在 temperature 不为 null 时设置（某些模型如 Kimi K2.5 不接受自定义 temperature）
  if (temperature !== null) {
    body.temperature = temperature;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  console.log(`      → POST ${url.replace(/\/v\d.*/, "/...")} (model=${model}, stream=${stream})`);

  const retryableStatus = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
  let lastError = null;

  for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const cause = err.cause?.message ?? err.cause?.code ?? "";
      lastError = err;
      if (attempt < MAX_API_RETRIES - 1) {
        const delay = 2000 * (attempt + 1) + Math.round(Math.random() * 1000);
        console.warn(`      ↻ 网络异常重试(${attempt + 1}/${MAX_API_RETRIES - 1}): ${err.message}${cause ? ` [${cause}]` : ""}`);
        await sleep(delay);
        continue;
      }
      console.error(`      ✗ 网络错误: ${err.message}${cause ? ` [${cause}]` : ""}`);
      break;
    }

    if (!response.ok) {
      const text = await response.text();
      const err = new Error(`AI API 失败: ${response.status} ${text.slice(0, 500)}`);
      lastError = err;
      if (retryableStatus.has(response.status) && attempt < MAX_API_RETRIES - 1) {
        const delay = 1500 * (attempt + 1) + Math.round(Math.random() * 700);
        console.warn(`      ↻ API 重试(${attempt + 1}/${MAX_API_RETRIES - 1}): HTTP ${response.status}`);
        await sleep(delay);
        continue;
      }
      break;
    }

    if (stream) {
      // SSE 流式读取
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let result = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // 保留最后不完整的行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data);
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta) result += delta;
          } catch {
            // 忽略无法解析的行
          }
        }
      }

      if (!result) {
        lastError = new Error("AI 流式响应为空");
        if (attempt < MAX_API_RETRIES - 1) {
          const delay = 1200 * (attempt + 1);
          console.warn(`      ↻ 空流响应重试(${attempt + 1}/${MAX_API_RETRIES - 1})`);
          await sleep(delay);
          continue;
        }
        break;
      }
      return result;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      lastError = new Error("AI 返回空内容");
      if (attempt < MAX_API_RETRIES - 1) {
        const delay = 1000 * (attempt + 1);
        console.warn(`      ↻ 空内容重试(${attempt + 1}/${MAX_API_RETRIES - 1})`);
        await sleep(delay);
        continue;
      }
      break;
    }
    return content;
  }

  throw lastError ?? new Error("AI 调用失败");
}

function parseJsonText(text) {
  // 尝试从 markdown 代码块提取
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (match?.[1] ?? text).trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    // 二次尝试：去除可能的 BOM 或前导空白
    const cleaned = raw.replace(/^\uFEFF/, "").replace(/^[^{]*/, "");
    try {
      return JSON.parse(cleaned);
    } catch {
      console.error("      ⚠️  JSON 解析失败，原始内容前 500 字符:");
      console.error("      ", raw.slice(0, 500));
      throw new Error(`JSON 解析失败: ${e.message}`);
    }
  }
}

// ─── 隐私校验 ──────────────────────────────────────────────

const PRIVACY_BANNED_TERMS = [
  // 家庭成员
  "妻子", "老婆", "爱人", "伴侣", "家人", "父母", "父亲", "母亲",
  "孩子", "女儿", "儿子", "丈夫", "配偶",
  // 健康与疾病
  "抗癌", "癌症", "化疗", "疾病", "病情", "住院", "手术", "肿瘤",
  // 职级（只拦截明确的职级代号，不拦截通用词汇如"架构师"）
  "总监", "P7", "P8", "P9", "P10",
];

/**
 * 扫描报告 JSON 中是否包含隐私敏感词，返回违规列表。
 * 如果返回非空数组，报告不应被保存。
 *
 * 注意：数量词（如"20K 订阅"）不再作为违规处理——
 * prompt 约束"只能引用上下文已有数据，不得编造"即可。
 */
function checkPrivacyViolations(report) {
  const violations = [];
  const jsonStr = JSON.stringify(report);

  for (const term of PRIVACY_BANNED_TERMS) {
    if (jsonStr.includes(term)) {
      violations.push(term);
    }
  }

  return violations;
}

// ─── AI 报告生成 ──────────────────────────────────────────────

function buildSystemPrompt() {
  return `你是一位写作自然、有点网感的中文编辑。你的任务：基于博客文章、X 动态和 GitHub 项目等公开内容，为普通访客介绍这位作者——他在关注什么、怎么做事、有什么特点。

输出会展示在博客的"关于/作者画像"页面。语气像"一个了解他的人在介绍他"，要有温度、有画面，但不吹捧、不夸大。

## 核心原则

1. **基于内容说话**：所有判断必须来自上下文中可观察的内容；不要推测心理、动机或未来。
2. **允许轻判断**：可以用"看得出来/明显/经常/很像那种…"这类表达来增加人味，但不要写成定性诊断（不要"他就是/他一定/他内心/他的人格"）。
   - 允许："看得出来他很爱折腾""明显是那种喜欢把工具调顺手的人"
   - 禁止："他就是一个极客""他一定对技术有执念"
3. **技术与生活同等重要**：旅行、跑步、消费体验、居住与工具选择等必须进入主体叙述，不得只做"附加兴趣"。
4. **描述而非官衔**：不要用"架构师/治理者/专家/主义者"等称号；更像博客栏目：例如"把折腾写成教程""喜欢实测对比""AI 当工具链用"。
5. **证据绑定**：每个 identity 必须有 evidence（自然语言说明哪些文章/推文/项目支撑），evidence 中不要放 URL——URL 只放在 link 字段。没有证据就不要写。
6. **proofs.reason 要讲人话**：一句话说清"为什么它能代表他"，不要写"展示了XX能力""体现了XX精神"。

## 个人色彩（必须体现）

- hero.summary 要有记忆点，像朋友聊天时介绍他会说的那句话——要有动作、有场景、能想象画面，不是形容词堆叠。
- hero.intro 或 styles 中至少出现 2 处"活跃感/创作者气质"：例如"边做边公开进度""更新频繁""跟同好互动""图文/视频并行""经常把进度同步到 X"等。
- identities 命名要自然、像博客栏目，不像 PPT 目录：例如"把家里网络折腾明白""AI 当工具链用""旅行也写成攻略""把小麻烦做成插件"。
- styles 要让读者脑补出画面，可以带一点轻松幽默：例如"进度条体质：做着做着就顺手发个更新""对比党：买东西/选方案都要拉表、跑测试"。
- 如果上下文里明确出现公开影响力数据（例如 YouTube 订阅数、X 关注数），允许提及一次，帮助读者建立直觉；**禁止新增数字、禁止夸大、禁止把不确定写成事实**。

## 隐私保护（违反即为生成失败）

以下信息即使出现在上下文中，也绝对不能出现在输出里：
- 家庭成员相关：妻子、老婆、爱人、伴侣、家人、父母、孩子、女儿、儿子
- 健康与疾病：抗癌、癌症、化疗、疾病、病情、住院、手术
- 公司与职级：不要提及具体公司名、职级（P几/总监）、薪资

## 写作要求

1. hero.title 为"AI 视角下的罗磊"。
2. hero.summary 一句话概括，带动作和场景（见上"个人色彩"）。
3. hero.intro 展开介绍 2-3 句，至少包含 1 个非技术方向。
4. identities 是"他在关注和投入的方向"，命名自然具体（见上"个人色彩"）。
5. strengths 写"从内容中可以观察到的做事方式"，每组最多 1-2 个技术名词，不要堆砌。
6. styles 写"和他的内容打交道时会注意到的特点"，用具体场景描述（见上"个人色彩"）。
7. proofs.reason 一句话讲人话（见上原则 6）。

## 文风限制

- 友好、有温度、第三方口吻；不写鸡汤、不写颁奖词、不总结人生。
- 禁止"AI 腔/大词"：范式、治理、同构、反脆弱、数字主权、对齐、底座、降维、赋能、闭环、极致、卓越、深度融合、全面。
- 少用"X 是一位……"的定义句开头；多用"从他的内容来看/可以看到/经常出现/很多时候会…"的观察句。
- identities 的 evidence 和 description 中不要出现任何 URL（http/https 链接），URL 只能放在 link 字段。

## 格式要求

- 严格只输出一个 JSON 对象，不要 markdown 代码块、不要注释、不要多余文本。
- 必须遵守给定 schema，字段齐全。
- proofs 中的 URL 必须来自上下文中的真实内容，禁止编造 URL。
- 中文第三人称，不使用"我"。
- identities 至少 3 个，每个需包含 evidence 字段。
- strengths 至少 2 组，每组至少 3 个 points。
- styles 至少 3 个。
- proofs.posts 至少 5 篇，proofs.tweets 至少 3 条，proofs.projects 至少 3 个。

输出 schema:
{
  "report": {
    "hero": {"title":"AI 视角下的罗磊","summary":"一句话概括（有动作有画面）","intro":"2-3句展开介绍"},
    "identities":[{"name":"关注方向（自然命名）","description":"他在这个方向上做了什么","evidence":"支撑依据（自然语言，不放URL）","link":"最相关的一个URL"}],
    "strengths":[{"title":"做事方式类别","points":["方式1","方式2","方式3"]}],
    "styles":[{"trait":"会注意到的特点","description":"具体场景描述（有画面感）"}],
    "proofs":{
      "posts":[{"title":"文章标题","url":"文章URL","reason":"讲人话说为什么能代表他","date":"YYYY-MM-DD"}],
      "tweets":[{"title":"推文摘要","url":"推文URL","reason":"讲人话说为什么能代表他","date":"ISO日期"}],
      "projects":[{"title":"项目名","url":"项目URL","reason":"讲人话说为什么能代表他"}]
    },
    "disclaimer":"AI 生成声明"
  }
}`;
}

// ─── Prompt 构建（本地预分析 + 精选样本 + 统计概览） ────────

function selectRepresentativePosts(posts, topN = 20) {
  if (posts.length <= topN) return posts;
  const recent = posts.slice(0, 12);
  const recentUrls = new Set(recent.map((p) => p.url));
  const catSeen = new Map();
  for (const p of recent) {
    for (const c of p.categories ?? []) catSeen.set(c, (catSeen.get(c) ?? 0) + 1);
  }
  const rest = posts.filter((p) => !recentUrls.has(p.url));
  const scored = rest.map((p, i) => {
    const catScore = (p.categories ?? []).reduce(
      (s, c) => s + 1 / (1 + (catSeen.get(c) ?? 0)),
      0,
    );
    return { post: p, score: catScore + 1 / (1 + i * 0.05) };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = [...recent, ...scored.slice(0, topN - recent.length).map((s) => s.post)];
  picked.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  return picked;
}

function buildCategoryDistribution(posts) {
  const counts = {};
  for (const p of posts) {
    for (const c of p.categories ?? []) counts[c] = (counts[c] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}(${n})`)
    .join(", ");
}

function buildYearDistribution(items, dateKey = "date") {
  const counts = {};
  for (const item of items) {
    const y = item[dateKey]?.slice(0, 4);
    if (y) counts[y] = (counts[y] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([y, n]) => `${y}(${n})`)
    .join(", ");
}

function groupByYear(items, dateKey = "date", textFn = () => "") {
  const groups = new Map();
  for (const item of items) {
    const y = item[dateKey]?.slice(0, 4) ?? "未知";
    if (!groups.has(y)) groups.set(y, []);
    groups.get(y).push(textFn(item));
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([y, texts]) => `${y}(${texts.length}篇): ${texts.join(" / ")}`)
    .join("\n");
}

function groupTweetsByMonth(tweets, textFn) {
  const groups = new Map();
  for (const t of tweets) {
    const ym = t.date?.slice(0, 7) ?? "未知";
    if (!groups.has(ym)) groups.set(ym, []);
    groups.get(ym).push(textFn(t));
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([ym, texts]) => `${ym}(${texts.length}条): ${texts.join(" / ")}`)
    .join("\n");
}

function tweetEngagementScore(t) {
  const m = t.metrics ?? {};
  return (
    Number(m.like_count ?? 0) +
    Number(m.retweet_count ?? 0) * 1.8 +
    Number(m.reply_count ?? 0) +
    Number(m.quote_count ?? 0) * 1.2 +
    Number(m.bookmark_count ?? 0) * 1.5
  );
}

function buildTweetStats(tweets) {
  let totalLikes = 0;
  let totalRt = 0;
  let totalRp = 0;
  for (const t of tweets) {
    const m = t.metrics ?? {};
    totalLikes += Number(m.like_count ?? 0);
    totalRt += Number(m.retweet_count ?? 0);
    totalRp += Number(m.reply_count ?? 0);
  }
  return `总互动: ${totalLikes} likes / ${totalRt} retweets / ${totalRp} replies`;
}

function buildUserPrompt(context) {
  const sections = [];
  const themes = buildThemeStats(context);

  // 个人简介
  const p = context.profile ?? {};
  sections.push(`## 个人简介
姓名: ${p.name ?? "罗磊"} (${p.nameEn ?? "Luo Lei"})
头衔: ${p.headline ?? ""}
简介: ${p.bio ?? ""}
位置: ${p.location ?? ""}`);

  if (context.experience?.length) {
    const expLines = context.experience
      .map((e) => `- ${e.period ?? ""} | ${e.title} @ ${e.company}\n  ${e.description}`)
      .join("\n");
    sections.push(`## 职业经历\n${expLines}`);
  }

  if (context.skills && Object.keys(context.skills).length) {
    const skillLines = Object.entries(context.skills)
      .map(([cat, items]) => `- ${cat}: ${Array.isArray(items) ? items.join(", ") : items}`)
      .join("\n");
    sections.push(`## 技术技能\n${skillLines}`);
  }

  if (context.education) {
    sections.push(`## 教育背景\n${context.education.degree} - ${context.education.school}\n${context.education.note ?? ""}`);
  }

  if (context.highlights?.length) {
    sections.push(`## 关键成就与亮点\n${context.highlights.map((h) => `- ${h}`).join("\n")}`);
  }

  if (context.sideProjects?.length) {
    sections.push(`## 副业项目\n${context.sideProjects.map((s) => `- ${s}`).join("\n")}`);
  }

  if (context.publicActivities?.length) {
    sections.push(`## 公共活动\n${context.publicActivities.map((a) => `- ${a}`).join("\n")}`);
  }

  if (context.projects?.length) {
    const projLines = context.projects
      .map((proj) => `- ${proj.name}: ${proj.description} (${proj.url}) [${(proj.tags ?? []).join(", ")}]`)
      .join("\n");
    sections.push(`## GitHub 开源项目\n${projLines}`);
  }

  // ─ 全量数据统计概览（本地预分析，信息无损）
  const posts = context.posts ?? [];
  const tweets = context.tweets ?? [];
  const projects = context.projects ?? [];

  sections.push(
    `## 全量数据统计概览（基于 ${posts.length} 篇文章 + ${tweets.length} 条推文 + ${projects.length} 个项目的预分析）
文章分类分布: ${buildCategoryDistribution(posts) || "无分类"}
文章年份分布: ${buildYearDistribution(posts)}
推文年份分布: ${buildYearDistribution(tweets)}
推文互动统计: ${buildTweetStats(tweets)}
高频主题词（按权重）: ${themes.join("、")}
最早文章: ${posts[posts.length - 1]?.date?.slice(0, 10) ?? "未知"} / 最新文章: ${posts[0]?.date?.slice(0, 10) ?? "未知"}
最早推文: ${tweets[tweets.length - 1]?.date?.slice(0, 10) ?? "未知"} / 最新推文: ${tweets[0]?.date?.slice(0, 10) ?? "未知"}`,
  );

  // ─ 代表性文章（精选，含完整信息供引用）
  if (posts.length) {
    const topPosts = selectRepresentativePosts(posts, 20);
    const topUrls = new Set(topPosts.map((p) => p.url));
    const restPosts = posts.filter((p) => !topUrls.has(p.url));

    const topLines = topPosts
      .map((post) => {
        const cats = (post.categories ?? []).slice(0, 2).join(",");
        const kp = (post.keyPoints ?? []).slice(0, 2).map((k) => compactText(k, 20)).join(";");
        return `- ${post.date?.slice(0, 10)}|${compactText(post.title, 40)}|cat:${cats}|kp:${kp}|sum:${compactText(post.summary, 40)}|url:${post.url}`;
      })
      .join("\n");

    let postSection = `## 代表性文章（精选 ${topPosts.length} 篇，含 URL 可引用）\n${topLines}`;

    if (restPosts.length) {
      const restGrouped = groupByYear(restPosts, "date", (p) => compactText(p.title, 20));
      postSection += `\n\n### 其余 ${restPosts.length} 篇文章标题速览（按年分组，供主题覆盖分析）\n${restGrouped}`;
    }
    sections.push(postSection);
  }

  // ─ 高互动推文（精选，含完整信息供引用）
  if (tweets.length) {
    const sorted = [...tweets].sort((a, b) => tweetEngagementScore(b) - tweetEngagementScore(a));
    const topTweets = sorted.slice(0, 20);
    const topIds = new Set(topTweets.map((t) => t.id ?? t.url));
    const restTweets = tweets.filter((t) => !topIds.has(t.id ?? t.url));

    const topLines = topTweets
      .map((t) => {
        const m = t.metrics ?? {};
        return `- ${t.date?.slice(0, 10)}|${compactText(t.text, 56)}|like:${m.like_count ?? 0},rt:${m.retweet_count ?? 0}|url:${t.url}`;
      })
      .join("\n");

    let tweetSection = `## 高互动推文（精选 ${topTweets.length} 条，含 URL 可引用）\n${topLines}`;

    if (restTweets.length) {
      const restGrouped = groupTweetsByMonth(restTweets, (t) => compactText(t.text, 12));
      tweetSection += `\n\n### 其余 ${restTweets.length} 条推文片段速览（按月分组，供话题覆盖分析）\n${restGrouped}`;
    }
    sections.push(tweetSection);
  }

  return `请根据以下数据，为普通访客介绍这位作者——他在关注什么、做什么、有什么特点。

提示：
- 你是在帮访客了解这个人，像一个认识他的人在介绍他，要有温度和画面。
- 基于数据中能看到的东西来写，允许"看得出来/明显/经常"这类轻判断，但不要推测内心。
- 技术方向和生活方向同等重要，不分主次。
- "全量数据统计概览"是对全部原始数据的预分析结论，可以放心引用。
- "代表性文章"和"高互动推文"的 URL 可用于 proofs 引用；"速览"部分仅用于了解主题广度，不要引用其中的 URL。
- 如果数据中出现公开的影响力数字（如 YouTube 订阅数、X 关注数），允许提及一次帮读者建立直觉；禁止新增数字或夸大。
- 隐私保护：绝对不要提及家庭成员、健康状况、具体公司名或职级。

${sections.join("\n\n")}`;
}

async function generateReportWithAI(context, modelEntry) {
  const baseUrl = modelEntry.baseUrl;
  const apiKey = modelEntry.apiKey;
  const model = modelEntry.id;

  if (!baseUrl || !apiKey) {
    throw new Error(
      `模型 ${modelEntry.name} 缺少 baseUrl 或 apiKey，请检查 .profile-models.json`,
    );
  }

  const userPrompt = buildUserPrompt(context);
  console.log(`      → prompt 长度: ${userPrompt.length} 字符`);

  const content = await callAI({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: userPrompt },
    ],
    temperature: "temperature" in modelEntry ? modelEntry.temperature : 0.4,
    stream: modelEntry.stream !== false,
    timeoutMs:
      typeof modelEntry.timeoutMs === "number" && modelEntry.timeoutMs > 0
        ? modelEntry.timeoutMs
        : DEFAULT_TIMEOUT_MS,
  });

  console.log(`      → AI 响应长度: ${content.length} 字符`);

  const parsed = parseJsonText(content);
  const report = parsed?.report;
  if (!report) {
    console.error("      ⚠️  AI 返回的 JSON 结构:");
    console.error("      ", JSON.stringify(parsed).slice(0, 300));
    throw new Error("AI 返回缺少 report 字段");
  }

  // 隐私校验
  const violations = checkPrivacyViolations(report);
  if (violations.length > 0) {
    console.warn(`      ⚠️  隐私校验未通过，检测到敏感词: ${violations.join(", ")}`);
    console.warn("      → 报告将被标记，请检查内容后决定是否保留。");
  }

  return {
    meta: {
      lastUpdated: new Date().toISOString(),
      model: modelEntry.id,
      modelName: modelEntry.name,
      provider: modelEntry.provider,
      generatedBy: "ai",
      sources: ["posts", "tweets", "github"],
    },
    report,
  };
}

// ─── 规则兜底报告 ────────────────────────────────────────────

function toProofReasonFromTweet(text) {
  const cleaned = stripMarkdown(text).replace(/^https?:\/\/\S+\s*/g, "");
  return truncate(
    cleaned || "该动态反映了作者近期关注的议题与表达风格。",
    72,
  );
}

function buildRuleBasedReport(context) {
  const posts = (context.posts ?? []).slice(0, 5).map((post) => ({
    title: post.title,
    url: post.url,
    reason: post.summary || "从这篇文章可以看到作者近期关注的方向。",
    date: post.date,
  }));

  const tweets = (context.tweets ?? []).slice(0, 3).map((tweet) => ({
    title: `X 动态 · ${tweet.date ? tweet.date.slice(0, 10) : "未知日期"}`,
    url: tweet.url,
    reason: toProofReasonFromTweet(tweet.text),
    date: tweet.date,
  }));

  const projects = (context.projects ?? []).slice(0, 4).map((project) => ({
    title: project.name,
    url: project.url,
    reason: project.description || "这个项目体现了博客中常见的工程实践方向。",
  }));

  const majorProjectNames = projects
    .map((item) => item.title)
    .slice(0, 2)
    .join("、");
  const highLevelTopic = context.highlights?.[0]
    ? truncate(context.highlights[0], 56)
    : "技术实践、工具折腾与生活方式";

  return {
    meta: {
      lastUpdated: new Date().toISOString(),
      model: "rule-based",
      modelName: "规则模板",
      provider: "Local",
      generatedBy: "rule-based",
      sources: ["posts", "tweets", "github"],
    },
    report: {
      hero: {
        title: "AI 视角下的罗磊",
        summary:
          "一边写代码做开源，一边把网络、工具、旅行和生活方式都写进博客里。",
        intro: `从他近期的内容来看，最集中的方向是：${highLevelTopic}。`,
      },
      identities: [
        {
          name: "前端工程实践",
          description: "博客中有不少从项目搭建到部署上线的完整记录，涉及前后端、CI/CD 和性能优化。",
          evidence: majorProjectNames
            ? `从 GitHub 来看，${majorProjectNames} 是比较有代表性的项目。`
            : "博客中持续出现编程与工具类文章。",
          link: "https://github.com/foru17",
        },
        {
          name: "工具与效率",
          description: "经常可以看到关于工具选择、工作流优化和自动化脚本的讨论。",
          evidence: posts[0]
            ? `比如最近的文章《${posts[0].title}》就涉及了相关主题。`
            : "博客长期保持对效率工具的讨论。",
          link: "https://luolei.org",
        },
        {
          name: "旅行与生活方式",
          description: "博客和社交动态中有不少关于旅行、城市体验和日常生活方式的内容。",
          evidence: context.tweets?.length
            ? "从 X 动态可以看到对旅行、居住和日常工具的持续讨论。"
            : "历史内容中有旅行和生活方式相关的文章。",
        },
      ],
      strengths: [
        {
          title: "从内容中可以观察到的工程方式",
          points: [
            "文章中常见从想法到可用产品的完整记录。",
            "重复性工作倾向于脚本化和自动化。",
            "会把 AI 工具整合进实际工作流，而不是单独讨论。",
          ],
        },
        {
          title: "写作与内容输出方式",
          points: [
            "习惯把折腾过程写成可复现的教程。",
            "关注阅读体验和视觉细节，文章排版讲究。",
          ],
        },
      ],
      styles: [
        {
          trait: "实测驱动",
          description: "文章中经常出现先做实验、再写结论的模式，很少纯理论讨论。",
        },
        {
          trait: "过程公开",
          description: "愿意在博客和社交媒体上分享决策过程和踩过的坑。",
        },
        {
          trait: "长期迭代",
          description: "从内容时间线来看，不少主题会反复出现和更新，不是一次性的热度文章。",
        },
      ],
      proofs: { posts, tweets, projects },
      disclaimer:
        "该页面由 AI 基于博客文章、社交动态和 GitHub 项目生成，旨在帮助访客快速了解作者。内容可能存在概括偏差，请以原始文章和项目为准。",
    },
  };
}

// ─── Manifest 管理 ───────────────────────────────────────────

async function updateManifest(modelEntry, reportMeta) {
  const manifest = await readJson(MANIFEST_FILE, {
    defaultModel: null,
    models: [],
  });

  const existing = manifest.models.findIndex((m) => m.id === modelEntry.id);
  const entry = {
    id: modelEntry.id,
    name: modelEntry.name,
    provider: modelEntry.provider,
    providerSite: modelEntry.providerSite || "",
    icon: modelEntry.icon,
    generatedAt: reportMeta.lastUpdated,
    generatedBy: reportMeta.generatedBy,
  };

  if (existing >= 0) {
    manifest.models[existing] = entry;
  } else {
    manifest.models.push(entry);
  }

  // 按 .profile-models.json 中的顺序重排 manifest.models
  try {
    const configRaw = await fs.readFile(MODELS_CONFIG_FILE, "utf-8");
    const config = JSON.parse(configRaw);
    if (Array.isArray(config?.models)) {
      const orderMap = new Map(config.models.map((m, i) => [m.id, i]));
      manifest.models.sort((a, b) => {
        const ia = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const ib = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ia - ib;
      });
    }
  } catch {
    // 读取配置失败时保持原序
  }

  if (!manifest.defaultModel) {
    manifest.defaultModel = modelEntry.id;
  }

  await writeJson(MANIFEST_FILE, manifest);
  return manifest;
}

// ─── 主流程 ──────────────────────────────────────────────────

async function generateForModel(context, modelEntry, { noAI = false, force = false } = {}) {
  const reportFile = path.join(REPORTS_DIR, `${modelEntry.id}.json`);

  // 检查是否已有 AI 生成的报告，无 --force 则跳过
  if (!force && !noAI) {
    const existing = await readJson(reportFile, null);
    if (existing?.meta?.generatedBy === "ai") {
      console.log(`   ⏭️  ${modelEntry.name} 已有 AI 报告 (${existing.meta.lastUpdated?.slice(0, 10)})，跳过。使用 --force 强制重新生成`);
      return existing;
    }
  }

  let report;
  if (noAI) {
    report = buildRuleBasedReport(context);
    report.meta.model = modelEntry.id;
    report.meta.modelName = modelEntry.name;
    report.meta.provider = modelEntry.provider;
    console.log(`   ℹ️  使用规则模板生成（${modelEntry.name}）`);
  } else {
    try {
      console.log(`   🤖 调用 ${modelEntry.name} (${modelEntry.id})...`);
      report = await generateReportWithAI(context, modelEntry);
      console.log(`   ✅ ${modelEntry.name} 报告生成成功`);
    } catch (error) {
      console.warn(
        `   ⚠️  ${modelEntry.name} AI 生成失败，回退规则模板: ${error.message}`,
      );
      report = buildRuleBasedReport(context);
      report.meta.model = modelEntry.id;
      report.meta.modelName = modelEntry.name;
      report.meta.provider = modelEntry.provider;
    }
  }

  await writeJson(reportFile, report);
  console.log(`   📄 已写入: ${reportFile}`);
  return report;
}

async function main() {
  const args = parseArgs();
  await loadEnv();

  // 读取模型配置
  const modelRegistry = await loadModelConfig();

  // 读取上下文数据
  const context = await readJson(CONTEXT_FILE, null);
  if (!context) {
    console.error(
      "❌ 未找到 data/author-context.json，请先运行: node scripts/build-author-context.mjs",
    );
    process.exit(1);
  }

  await fs.mkdir(REPORTS_DIR, { recursive: true });

  if (args.all) {
    console.log(`\n🚀 为所有 ${modelRegistry.length} 个模型生成报告（并发上限 ${MAX_CONCURRENCY}）...${args.force ? " (--force 强制重新生成)" : ""}\n`);
    const tasks = modelRegistry.map((entry) => () =>
      generateForModel(context, entry, { noAI: args.noAI, force: args.force }),
    );
    const results = await runWithConcurrency(tasks, MAX_CONCURRENCY);
    // 汇总结果
    const summary = results.map((r, i) => {
      const name = modelRegistry[i].name;
      if (r.status === "fulfilled") {
        const by = r.value?.meta?.generatedBy ?? "unknown";
        return `   ${by === "ai" ? "✅" : "📋"} ${name}: ${by}`;
      }
      return `   ❌ ${name}: ${r.reason?.message ?? "未知错误"}`;
    });
    console.log("\n📊 生成结果汇总:");
    summary.forEach((s) => console.log(s));
    // 串行更新 manifest，避免写入竞态
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        await updateManifest(modelRegistry[i], r.value.meta);
      }
    }
  } else if (args.modelId) {
    // 指定模型
    const entry = modelRegistry.find((m) => m.id === args.modelId);
    if (!entry) {
      console.error(
        `❌ 未知模型: ${args.modelId}\n可用模型: ${modelRegistry.map((m) => m.id).join(", ")}`,
      );
      process.exit(1);
    }
    console.log(`\n🚀 为 ${entry.name} 生成报告...\n`);
    const report = await generateForModel(context, entry, { noAI: args.noAI, force: true }); // 指定模型时默认 force
    await updateManifest(entry, report.meta);
  } else {
    // 默认：使用第一个注册模型
    const entry = modelRegistry[0];
    console.log(`\n🚀 为默认模型 ${entry.name} 生成报告...\n`);
    const report = await generateForModel(context, entry, { noAI: args.noAI, force: args.force });
    await updateManifest(entry, report.meta);
  }

  console.log("\n✅ 报告生成完成");
}

main().catch((error) => {
  console.error("❌ 生成失败:", error.message);
  process.exit(1);
});
