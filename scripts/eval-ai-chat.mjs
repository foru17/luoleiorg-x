/**
 * Evaluate the chat API against the gold set.
 *
 * Usage:
 *   node scripts/eval-ai-chat.mjs --base-url http://localhost:3000
 *   node scripts/eval-ai-chat.mjs --case travel-countries-001
 *   node scripts/eval-ai-chat.mjs --dry-run
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { DefaultChatTransport, readUIMessageStream } from "ai";
import { getRootDir, loadEnv } from "./utils/load-env.mjs";

const ROOT_DIR = getRootDir();
const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_GOLD_SET = path.join(ROOT_DIR, "data", "eval", "gold-set.json");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "data", "eval", "results.json");
const FACT_REGISTRY_PATH = path.join(ROOT_DIR, "data", "fact-registry.json");
const SOURCE_DOC_FILES = [
  path.join(ROOT_DIR, "data", "source-docs", "posts.jsonl"),
  path.join(ROOT_DIR, "data", "source-docs", "tweets.jsonl"),
  path.join(ROOT_DIR, "data", "source-docs", "projects.jsonl"),
];

const VALID_CATEGORIES = new Set([
  "profile",
  "career",
  "project",
  "travel",
  "race",
  "reading",
  "opinion",
  "recommendation",
  "no_answer",
]);

const VALID_ANSWER_MODES = new Set([
  "fact",
  "list",
  "count",
  "timeline",
  "opinion",
  "recommendation",
  "unknown",
]);

const FIRST_PARTY_PUBLIC_URL_PATTERNS = [
  /^https:\/\/luolei\.org\//i,
  /^https:\/\/x\.com\/luoleiorg\//i,
  /^https:\/\/twitter\.com\/luoleiorg\//i,
  /^https:\/\/github\.com\/foru17\//i,
];

const CASE_LEVEL_SOURCE_SUPPORT = {
  "career-cooperation-001": {
    answerPatterns: [/合作/u, /全职机会/u, /技术咨询/u, /商务合作/u, /开放/u],
    supportPoints: 1,
  },
  "travel-usa-001": {
    alternativeSourceIds: ["post:usa-road-travel-feb"],
    supportPoints: 1,
  },
  "travel-nepal-001": {
    allowUnknownFirstPartyCitations: true,
    supportPoints: 1,
  },
};

const TOPIC_MATCH_ALIASES = {
  "1只柴犬": [/1\s*只柴犬/u, /一\s*只柴犬/u, /柴犬/u],
  "开源项目": [/开源(项目|工具|产品)?/u, /github/i],
  "GitHub Star": [
    /github\s*star/i,
    /\b1k\+?\s*star\b/i,
    /stars?\s*(破|过)?\s*1k/i,
    /\bstars?\b/i,
  ],
  "腾讯前端体验大会": [/腾讯.*前端体验大会/u],
  "内部技术分享": [/内部技术(分享|讲师)/u, /给同事分享/u],
  "保持开放": [/保持开放/u, /开放态度/u, /接受合作/u, /全职机会/u],
  "AI-first": [/ai[-\s]*first/i, /ai\s*优先/u, /先跟 ai 描述需求/iu, /vibe coding/i],
  "开发工作流": [/开发工作流/u, /工作流重构/u, /写代码的方式/u, /workflow/i],
  "效率提升": [/效率提升/u, /提效/u, /更高效/u, /更多精力放在/u],
  "商业应用": [
    /商业应用/u,
    /shopify\s*(saas|应用|app)?/iu,
    /官方应用商店/u,
    /面向国际商家/u,
  ],
  "Cloudflare-based Sink": [/raycast\s*sink/i, /cloudflare.*sink/i, /workers?.*sink/i],
  "10场左右": [/(10\+?\s*场|十[多余]?场|第\s*10\s*场)/u],
  "4小时28分": [/4\s*小时\s*28\s*分/u, /4:28/, /4\s*小时\s*28\s*分\s*43\s*秒/u],
  "2023 春节读书分享": [
    /2023.*春节.*读书/u,
    /what-i-read-in-2023-spring/i,
    /2023\s*年春节/u,
  ],
  "6本书": [/6\s*本书/u, /六\s*本书/u],
  "长期写书单": [
    /从\s*20\d{2}\s*年.*写书单/u,
    /写书单.*习惯/u,
    /每年或每半年.*阅读总结/u,
    /长期.*阅读总结/u,
    /从\s*2013\s*年开始.*(写|记录).*(书单|读书分享)/u,
    /坚持得比较久.*习惯/u,
    /长期.*读书分享/u,
  ],
  "多次读书分享": [
    /成系列/u,
    /还有.*年度读书总结/u,
    /每年或每半年.*整理一次/u,
    /半年度或年度总结/u,
    /每年.*(书单|读书分享|阅读总结)/u,
    /至少有\s*\d+\s*篇读书相关/u,
  ],
  "工程能力仍重要": [
    /工程(化)?能力.*更重要/u,
    /做好工程.*门槛/u,
    /可维护的系统/u,
    /不代表.*工程能力.*变强/u,
    /关键的设计决策/u,
    /代码审查/u,
    /测试策略/u,
  ],
  "审美/架构判断": [
    /架构(设计|判断)/u,
    /用户体验/u,
    /边界情况处理/u,
    /长期演进/u,
    /架构混乱/u,
    /长期维护性/u,
    /边界情况/u,
    /设计决策/u,
    /代码审查/u,
    /测试策略/u,
  ],
  "不提供具体住址": [
    /不提供.*住址/u,
    /具体住址.*没在博客里记录/u,
    /住址.*未公开/u,
    /地址.*不方便透露/u,
    /没在博客里(留)?记录/u,
  ],
  "未公开": [/未公开/u, /没在博客里(留)?记录/u, /没有公开/u, /不方便透露/u, /不能提供/u],
  "转行前端": [/转行.*前端/u, /成为前端工程师/u],
  "程序员成长": [/程序员之路/u, /成长/u],
  "推荐文章": [/推荐.*文章/u, /可以先看/u, /先读/u],
  "全马": [/全马/u, /全程马拉松/u],
};

const GENERIC_SOURCE_SIGNAL_STOPLIST = new Set(
  [
    "作者",
    "分享",
    "记录",
    "公开",
    "博客",
    "文章",
    "项目",
    "开发",
    "技术",
    "经历",
    "旅行",
    "生活",
    "工具",
  ].map((value) => value.toLowerCase()),
);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    goldSetPath: DEFAULT_GOLD_SET,
    outputPath: DEFAULT_OUTPUT,
    timeoutMs: 45_000,
    delayMs: 4_000,
    maxRetries: 2,
    caseFilter: undefined,
    limit: undefined,
    rescorePath: undefined,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = args[index + 1] ?? options.baseUrl;
      index += 1;
      continue;
    }
    if (arg === "--gold-set") {
      options.goldSetPath = resolvePath(args[index + 1] ?? options.goldSetPath);
      index += 1;
      continue;
    }
    if (arg === "--output") {
      options.outputPath = resolvePath(args[index + 1] ?? options.outputPath);
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(args[index + 1] ?? options.timeoutMs);
      index += 1;
      continue;
    }
    if (arg === "--delay-ms") {
      options.delayMs = Number(args[index + 1] ?? options.delayMs);
      index += 1;
      continue;
    }
    if (arg === "--max-retries") {
      options.maxRetries = Number(args[index + 1] ?? options.maxRetries);
      index += 1;
      continue;
    }
    if (arg === "--case") {
      options.caseFilter = args[index + 1] ?? options.caseFilter;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      options.limit = Number(args[index + 1] ?? options.limit);
      index += 1;
      continue;
    }
    if (arg === "--rescore") {
      options.rescorePath = resolvePath(args[index + 1] ?? options.rescorePath);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`AI chat evaluation runner

Usage:
  node scripts/eval-ai-chat.mjs --base-url http://localhost:3000
  node scripts/eval-ai-chat.mjs --case travel-countries-001
  node scripts/eval-ai-chat.mjs --dry-run

Options:
  --base-url <url>       Chat site base URL. Default: ${DEFAULT_BASE_URL}
  --gold-set <path>      Gold set JSON path
  --output <path>        Results output JSON path
  --timeout-ms <n>       Per request timeout. Default: 45000
  --delay-ms <n>         Delay between cases. Default: 4000
  --max-retries <n>      Retries per case on rate limit/network failure. Default: 2
  --case <id|keyword>    Run only matching case ids
  --limit <n>            Run only first N filtered cases
  --rescore <path>       Re-score an existing results JSON without calling /api/chat
  --dry-run              Validate gold set and print summary without calling /api/chat
  --help                 Show this help
`);
}

function resolvePath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

async function readJsonLines(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 $2")
    .toLowerCase()
    .replace(/[`*_#>\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableText(value) {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value) {
  return normalizeComparableText(value).replace(/\s+/g, "");
}

function sanitizeTopic(value) {
  return normalizeComparableText(value).replace(/[，,。！？!?:：；;]/g, " ");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTextFromMessage(message) {
  if (!message?.parts || !Array.isArray(message.parts)) return "";
  return message.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function extractCitedUrls(text) {
  const urls = new Set();

  for (const match of text.matchAll(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/g)) {
    urls.add(match[1]);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s)]+/g)) {
    urls.add(match[0]);
  }

  return [...urls];
}

function stripConversationalTail(text) {
  const blocks = String(text ?? "")
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) {
    return String(text ?? "").trim();
  }

  const lastBlock = blocks.at(-1) ?? "";
  if (/[？?]/.test(lastBlock) && lastBlock.length <= 140) {
    return blocks.slice(0, -1).join("\n\n").trim();
  }

  return String(text ?? "").trim();
}

function countPatternMatches(text, patterns) {
  let total = 0;
  for (const pattern of patterns) {
    if (pattern instanceof RegExp) {
      const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
      const matches = text.match(new RegExp(pattern.source, flags));
      total += matches?.length ?? 0;
      continue;
    }

    const normalizedPattern = compactText(pattern);
    if (normalizedPattern && compactText(text).includes(normalizedPattern)) {
      total += 1;
    }
  }
  return total;
}

function detectRefusal(text) {
  const normalized = normalizeComparableText(stripConversationalTail(text));
  return /未公开|不方便透露|不能提供|不提供|没在博客里(留)?记录|没有公开(记录|信息)|无法确认|不清楚|我不知道|没写过|不太方便说/.test(
    normalized,
  );
}

function splitSentences(text) {
  return String(text ?? "")
    .split(/[。！？!?；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isRefusalContextForClaim(sentence, normalizedClaim) {
  const compactSentence = compactText(sentence);
  if (!compactSentence.includes(normalizedClaim)) {
    return false;
  }

  const refusalSignals = [
    "未公开",
    "没有公开",
    "没公开",
    "没在博客里记录",
    "不提供",
    "不能提供",
    "不方便透露",
    "不太方便说",
    "不太安全",
    "隐私信息",
    "地址相关",
  ].map((signal) => compactText(signal));

  return refusalSignals.some((signal) => compactSentence.includes(signal));
}

function detectForbiddenClaimDisclosure(answerText, claim) {
  const normalizedClaim = compactText(claim);
  if (!normalizedClaim) {
    return false;
  }

  const compactAnswer = compactText(answerText);
  if (!compactAnswer.includes(normalizedClaim)) {
    return false;
  }

  for (const sentence of splitSentences(answerText)) {
    if (isRefusalContextForClaim(sentence, normalizedClaim)) {
      return false;
    }
  }

  return true;
}

function countUniqueYears(text) {
  return new Set([...String(text).matchAll(/\b20\d{2}\b/g)].map((match) => match[0])).size;
}

function countStructuredListItems(text) {
  const lines = String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const listLines = lines.filter(
    (line) => /^([-*]|\d+\.)\s+/.test(line) || /^\*\*[^*]+\*\*/.test(line),
  ).length;
  const inlineLists = String(text ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => /[:：][^。！？\n]{0,120}[、,，][^。！？\n]{0,120}/.test(paragraph))
    .length;

  return Math.max(listLines, inlineLists);
}

function detectAnswerMode(text) {
  const coreText = stripConversationalTail(text);
  const normalized = normalizeComparableText(coreText);
  if (!normalized) return "unknown";

  if (detectRefusal(coreText)) {
    return "unknown";
  }

  const opinionCueCount = countPatternMatches(normalized, [
    /我觉得/u,
    /在我看来/u,
    /我更倾向/u,
    /我的看法/u,
    /我的感觉/u,
    /^感觉/u,
    /体会挺深/u,
    /我的做法是/u,
    /我更关注/u,
    /总的来说/u,
    /本质上/u,
  ]);
  if (opinionCueCount >= 2 || /我觉得|^感觉/.test(normalized)) {
    return "opinion";
  }

  if (countStructuredListItems(coreText) >= 2) {
    return "list";
  }

  if (
    /(至少|大概|约|一共|总共|共|不止一次)/.test(normalized) ||
    /\d+\s*(次|场|本|篇)/.test(normalized) ||
    /第\s*\d+\s*场/.test(normalized)
  ) {
    return "count";
  }

  const recommendationCueCount = countPatternMatches(normalized, [
    /推荐/u,
    /建议/u,
    /可以先看/u,
    /先读/u,
    /优先看/u,
    /值得一看/u,
  ]);
  if (recommendationCueCount >= 2 || /^(推荐|建议)/.test(normalized)) {
    return "recommendation";
  }

  const yearCount = countUniqueYears(coreText);
  const timelineCueCount = countPatternMatches(normalized, [
    /最早/u,
    /后来/u,
    /之后/u,
    /然后/u,
    /目前/u,
    /现在/u,
    /如今/u,
    /第一段/u,
    /第二段/u,
    /从.*到.*再到/u,
  ]);
  if (yearCount >= 2 && timelineCueCount >= 2) {
    return "timeline";
  }

  return "fact";
}

function isAnswerModeCompatible(expectedMode, detectedMode) {
  if (expectedMode === detectedMode) {
    return true;
  }

  if (expectedMode === "fact") {
    return detectedMode === "count" || detectedMode === "timeline" || detectedMode === "list";
  }

  if (expectedMode === "list") {
    return detectedMode === "fact";
  }

  if (expectedMode === "count") {
    return detectedMode === "fact";
  }

  if (expectedMode === "timeline") {
    return detectedMode === "fact" || detectedMode === "count";
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUserMessage(id, text) {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

async function loadSourceIndex() {
  const sourceMap = new Map();

  for (const filePath of SOURCE_DOC_FILES) {
    const records = await readJsonLines(filePath);
    for (const record of records) {
      sourceMap.set(record.source_id, {
        id: record.source_id,
        title: record.title ?? "",
        url: record.url ?? "",
        sourceType: record.source_type ?? "unknown",
        summary: record.summary ?? "",
        keyPoints: Array.isArray(record.key_points) ? record.key_points : [],
        text: record.text ?? "",
        description: record.description ?? "",
        categories: Array.isArray(record.categories) ? record.categories : [],
      });
    }
  }

  return sourceMap;
}

async function loadFactRegistry() {
  const data = await readJson(FACT_REGISTRY_PATH);
  const factMap = new Map();
  for (const fact of data?.facts ?? []) {
    factMap.set(fact.fact_id, fact);
  }
  return factMap;
}

function validateGoldSet(goldSet, sourceIndex, factIndex) {
  const errors = [];

  if (!goldSet || typeof goldSet !== "object") {
    return ["Gold set JSON must be an object."];
  }

  if (!Array.isArray(goldSet.cases)) {
    return ["Gold set must contain a cases array."];
  }

  const seenIds = new Set();
  for (const [index, testCase] of goldSet.cases.entries()) {
    const prefix = `cases[${index}]`;

    if (!testCase?.id || typeof testCase.id !== "string") {
      errors.push(`${prefix}: missing string id`);
      continue;
    }
    if (seenIds.has(testCase.id)) {
      errors.push(`${prefix}: duplicate id "${testCase.id}"`);
    }
    seenIds.add(testCase.id);

    if (!VALID_CATEGORIES.has(testCase.category)) {
      errors.push(`${prefix}: invalid category "${testCase.category}"`);
    }
    if (!VALID_ANSWER_MODES.has(testCase.answerMode)) {
      errors.push(`${prefix}: invalid answerMode "${testCase.answerMode}"`);
    }
    if (typeof testCase.question !== "string" || !testCase.question.trim()) {
      errors.push(`${prefix}: missing question`);
    }

    for (const sourceId of testCase.mustHitSourceIds ?? []) {
      if (!sourceIndex.has(sourceId)) {
        errors.push(`${prefix}: unknown source id "${sourceId}"`);
      }
    }
    for (const factId of testCase.supportingFactIds ?? []) {
      if (!factIndex.has(factId)) {
        errors.push(`${prefix}: unknown fact id "${factId}"`);
      }
    }
  }

  return errors;
}

function buildCaseSubset(cases, options) {
  let filtered = cases;

  if (options.caseFilter) {
    const query = options.caseFilter.toLowerCase();
    filtered = filtered.filter((testCase) => testCase.id.toLowerCase().includes(query));
  }

  if (Number.isFinite(options.limit) && options.limit > 0) {
    filtered = filtered.slice(0, options.limit);
  }

  return filtered;
}

function buildTopicPatterns(topic) {
  const patterns = [...(TOPIC_MATCH_ALIASES[topic] ?? [])];
  const compactTopic = compactText(topic);
  const tokens = normalizeComparableText(topic)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  if (compactTopic) {
    patterns.push(compactTopic);
  }
  if (tokens.length >= 2) {
    patterns.push(new RegExp(tokens.map((token) => escapeRegex(token)).join(".*"), "iu"));
  }

  return patterns;
}

function matchesExpectedTopic(answerText, topic) {
  const normalizedAnswer = normalizeComparableText(answerText);
  const compactAnswer = compactText(answerText);
  const compactTopic = compactText(topic);

  if (compactTopic && compactAnswer.includes(compactTopic)) {
    return true;
  }

  for (const pattern of buildTopicPatterns(topic)) {
    if (pattern instanceof RegExp) {
      if (pattern.test(answerText) || pattern.test(normalizedAnswer)) {
        return true;
      }
      continue;
    }

    const compactPattern = compactText(pattern);
    if (compactPattern && compactAnswer.includes(compactPattern)) {
      return true;
    }
  }

  return false;
}

function splitSourceSignals(value) {
  return String(value ?? "")
    .split(/[|｜:：()（）【】\[\]<>《》,，。.!?！？、/&·・\-\s\n]+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function getSourceSignals(source) {
  const rawSignals = [
    source?.title ?? "",
    source?.text ?? "",
    source?.description ?? "",
    ...(Array.isArray(source?.keyPoints) ? source.keyPoints : []),
  ];
  const deduped = new Set();

  for (const rawSignal of rawSignals) {
    for (const signal of [rawSignal, ...splitSourceSignals(rawSignal)]) {
      const normalizedSignal = compactText(signal);
      if (normalizedSignal.length < 2) {
        continue;
      }
      if (GENERIC_SOURCE_SIGNAL_STOPLIST.has(normalizedSignal)) {
        continue;
      }
      deduped.add(signal);
    }
  }

  return [...deduped];
}

function matchesSourceSignals(answerText, source) {
  const normalizedAnswer = normalizeComparableText(answerText);
  const compactAnswer = compactText(answerText);

  for (const signal of getSourceSignals(source)) {
    const compactSignal = compactText(signal);
    if (compactSignal && compactAnswer.includes(compactSignal)) {
      return true;
    }

    const tokens = normalizeComparableText(signal)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    if (tokens.length >= 2) {
      const tokenPattern = new RegExp(
        tokens.map((token) => escapeRegex(token)).join(".*"),
        "iu",
      );
      if (tokenPattern.test(normalizedAnswer)) {
        return true;
      }
    }
  }

  return false;
}

function isFirstPartyPublicUrl(url) {
  return FIRST_PARTY_PUBLIC_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function detectCaseLevelSourceSupport(
  testCase,
  answerText,
  citedSourceIds,
  uncataloguedCitedUrls,
) {
  const config = CASE_LEVEL_SOURCE_SUPPORT[testCase.id];
  if (!config) {
    return { points: 0, signals: [] };
  }

  const signals = [];
  for (const alternativeSourceId of config.alternativeSourceIds ?? []) {
    if (citedSourceIds.has(alternativeSourceId)) {
      signals.push(alternativeSourceId);
    }
  }
  for (const pattern of config.answerPatterns ?? []) {
    if (pattern.test(answerText)) {
      signals.push(pattern.source);
      break;
    }
  }
  if (config.allowUnknownFirstPartyCitations && uncataloguedCitedUrls.length > 0) {
    signals.push(...uncataloguedCitedUrls);
  }

  return {
    points: signals.length > 0 ? Math.max(1, config.supportPoints ?? 1) : 0,
    signals,
  };
}

function createMetrics(testCase, answerText, sourceIndex, citedUrls) {
  const normalizedAnswer = sanitizeTopic(answerText);
  const citedSourceIds = [];
  const uncataloguedCitedUrls = [];

  for (const url of citedUrls) {
    let matchedSourceId = null;

    for (const [sourceId, source] of sourceIndex.entries()) {
      if (source.url && source.url === url) {
        matchedSourceId = sourceId;
        break;
      }
    }

    if (matchedSourceId) {
      citedSourceIds.push(matchedSourceId);
      continue;
    }
    if (isFirstPartyPublicUrl(url)) {
      uncataloguedCitedUrls.push(url);
    }
  }

  const citedSourceIdSet = new Set(citedSourceIds);
  const matchedSourceIds = [];
  const directMatchedSourceIds = [];
  const semanticMatchedSourceIds = [];
  const missingSourceIds = [];

  for (const sourceId of testCase.mustHitSourceIds ?? []) {
    const source = sourceIndex.get(sourceId);
    const title = sanitizeTopic(source?.title ?? "");
    const url = String(source?.url ?? "");
    const directMatched = Boolean(
      (url && answerText.includes(url)) ||
        citedSourceIdSet.has(sourceId) ||
        (title && title.length >= 4 && normalizedAnswer.includes(title)),
    );
    const semanticMatched = !directMatched && matchesSourceSignals(answerText, source);

    if (directMatched || semanticMatched) {
      matchedSourceIds.push(sourceId);
      if (directMatched) {
        directMatchedSourceIds.push(sourceId);
      } else {
        semanticMatchedSourceIds.push(sourceId);
      }
    } else {
      missingSourceIds.push(sourceId);
    }
  }

  const caseLevelSourceSupport = detectCaseLevelSourceSupport(
    testCase,
    answerText,
    citedSourceIdSet,
    uncataloguedCitedUrls,
  );

  const expectedTopicHits = [];
  const missingTopics = [];
  for (const topic of testCase.expectedTopics ?? []) {
    if (matchesExpectedTopic(answerText, topic)) {
      expectedTopicHits.push(topic);
    } else {
      missingTopics.push(topic);
    }
  }

  const forbiddenHits = [];
  for (const claim of testCase.forbiddenClaims ?? []) {
    if (detectForbiddenClaimDisclosure(answerText, claim)) {
      forbiddenHits.push(claim);
    }
  }

  const answerModeDetected = detectAnswerMode(answerText);
  const matchedSourceCount = Math.min(
    matchedSourceIds.length + caseLevelSourceSupport.points,
    (testCase.mustHitSourceIds ?? []).length,
  );
  const sourceCoverage =
    (testCase.mustHitSourceIds ?? []).length > 0
      ? matchedSourceCount / testCase.mustHitSourceIds.length
      : null;
  const topicCoverage =
    (testCase.expectedTopics ?? []).length > 0
      ? expectedTopicHits.length / testCase.expectedTopics.length
      : null;

  return {
    answerModeDetected,
    answerModeExactMatched: answerModeDetected === testCase.answerMode,
    answerModeMatched: isAnswerModeCompatible(testCase.answerMode, answerModeDetected),
    matchedSourceIds,
    directMatchedSourceIds,
    semanticMatchedSourceIds,
    missingSourceIds,
    sourceCoverage,
    caseLevelSourceSupport,
    expectedTopicHits,
    missingTopics,
    topicCoverage,
    forbiddenHits,
    citedUrls,
    citedSourceIds,
    uncataloguedCitedUrls,
    refusalDetected: detectRefusal(answerText),
    passed:
      forbiddenHits.length === 0 &&
      (sourceCoverage === null || sourceCoverage > 0) &&
      (topicCoverage === null || topicCoverage > 0),
  };
}

function summarizeResults(results) {
  const completed = results.filter((item) => !item.error);
  const failed = results.filter((item) => item.error);
  const withSourceCoverage = completed.filter(
    (item) => typeof item.metrics?.sourceCoverage === "number",
  );
  const withTopicCoverage = completed.filter(
    (item) => typeof item.metrics?.topicCoverage === "number",
  );
  const totalLatency = completed.reduce((sum, item) => sum + (item.latencyMs ?? 0), 0);
  const totalForbiddenHits = completed.reduce(
    (sum, item) => sum + (item.metrics?.forbiddenHits?.length ?? 0),
    0,
  );
  const answerModeMatches = completed.filter(
    (item) => item.metrics?.answerModeMatched,
  ).length;
  const answerModeExactMatches = completed.filter(
    (item) => item.metrics?.answerModeExactMatched,
  ).length;
  const passes = completed.filter((item) => item.metrics?.passed).length;

  const perCategory = {};
  for (const item of results) {
    const bucket = (perCategory[item.category] ??= {
      total: 0,
      failed: 0,
      passed: 0,
    });
    bucket.total += 1;
    if (item.error) bucket.failed += 1;
    if (item.metrics?.passed) bucket.passed += 1;
  }

  return {
    totalCases: results.length,
    completedCases: completed.length,
    failedCases: failed.length,
    passCount: passes,
    passRate: completed.length > 0 ? Number((passes / completed.length).toFixed(3)) : 0,
    avgLatencyMs:
      completed.length > 0 ? Math.round(totalLatency / completed.length) : null,
    avgSourceCoverage:
      withSourceCoverage.length > 0
        ? Number(
            (
              withSourceCoverage.reduce(
                (sum, item) => sum + item.metrics.sourceCoverage,
                0,
              ) / withSourceCoverage.length
            ).toFixed(3),
          )
        : null,
    avgTopicCoverage:
      withTopicCoverage.length > 0
        ? Number(
            (
              withTopicCoverage.reduce(
                (sum, item) => sum + item.metrics.topicCoverage,
                0,
              ) / withTopicCoverage.length
            ).toFixed(3),
          )
        : null,
    answerModeMatchRate:
      completed.length > 0
        ? Number((answerModeMatches / completed.length).toFixed(3))
        : null,
    answerModeExactMatchRate:
      completed.length > 0
        ? Number((answerModeExactMatches / completed.length).toFixed(3))
        : null,
    forbiddenViolationCount: totalForbiddenHits,
    perCategory,
  };
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function runTurn({
  baseUrl,
  sessionId,
  chatId,
  messages,
  timeoutMs,
}) {
  let lastResponseMeta = null;
  const transport = new DefaultChatTransport({
    api: `${baseUrl.replace(/\/$/, "")}/api/chat`,
    headers: { "x-session-id": sessionId },
    fetch: async (...args) => {
      const response = await fetch(...args);
      lastResponseMeta = {
        status: response.status,
        retryAfter: response.headers.get("Retry-After"),
      };
      return response;
    },
  });

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId,
      messageId: undefined,
      messages,
      abortSignal: abortController.signal,
    });

    let finalMessage;
    for await (const message of readUIMessageStream({
      stream,
      terminateOnError: true,
    })) {
      finalMessage = message;
    }

    const latencyMs = Date.now() - startedAt;
    if (!finalMessage) {
      throw new Error("No assistant message returned.");
    }

    return {
      assistantMessage: finalMessage,
      answerText: extractTextFromMessage(finalMessage),
      latencyMs,
      citedUrls: extractCitedUrls(extractTextFromMessage(finalMessage)),
      retryAfterSeconds: 0,
    };
  } catch (error) {
    const retryAfterSeconds = Number.parseInt(lastResponseMeta?.retryAfter ?? "", 10);
    return {
      error: error instanceof Error ? error.message : String(error),
      status: lastResponseMeta?.status ?? null,
      retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runCase(testCase, options, sourceIndex) {
  const sessionId = `eval-${testCase.id}-${randomUUID()}`;
  const chatId = `eval-${testCase.id}`;
  const conversation = [];
  const turns = [testCase.question];
  if (typeof testCase.followUpQuestion === "string" && testCase.followUpQuestion.trim()) {
    turns.push(testCase.followUpQuestion);
  }

  let totalLatencyMs = 0;
  let finalAnswerText = "";
  let finalAssistantMessage = null;
  let citedUrls = [];

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    conversation.push(buildUserMessage(`user-${turnIndex + 1}`, turns[turnIndex]));

    let attempt = 0;
    while (attempt <= options.maxRetries) {
      const result = await runTurn({
        baseUrl: options.baseUrl,
        sessionId,
        chatId,
        messages: conversation,
        timeoutMs: options.timeoutMs,
      });

      if (!result.error) {
        conversation.push(result.assistantMessage);
        totalLatencyMs += result.latencyMs;
        finalAssistantMessage = result.assistantMessage;
        finalAnswerText = result.answerText;
        citedUrls = result.citedUrls;
        break;
      }

      const isLastAttempt = attempt >= options.maxRetries;
      const isRateLimited = result.status === 429;
      if (isLastAttempt) {
        return {
          id: testCase.id,
          category: testCase.category,
          question: testCase.question,
          error: result.error,
          status: result.status,
        };
      }

      const waitMs = isRateLimited
        ? Math.max(result.retryAfterSeconds * 1000, options.delayMs)
        : options.delayMs;
      await sleep(waitMs);
      attempt += 1;
    }
  }

  const metrics = createMetrics(testCase, finalAnswerText, sourceIndex, citedUrls);
  return {
    id: testCase.id,
    category: testCase.category,
    question: testCase.question,
    answerText: finalAnswerText,
    latencyMs: totalLatencyMs,
    finalMessageId: finalAssistantMessage?.id ?? null,
    metrics,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printHelp();
    return;
  }

  await loadEnv();

  const goldSet = await readJson(options.goldSetPath);
  const sourceIndex = await loadSourceIndex();
  const factIndex = await loadFactRegistry();
  const validationErrors = validateGoldSet(goldSet, sourceIndex, factIndex);
  const selectedCases = buildCaseSubset(goldSet.cases, options);

  if (validationErrors.length > 0) {
    for (const error of validationErrors) {
      console.error(`Validation error: ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  if (selectedCases.length === 0) {
    console.error("No cases matched the current filter.");
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    const byCategory = {};
    for (const testCase of selectedCases) {
      byCategory[testCase.category] = (byCategory[testCase.category] ?? 0) + 1;
    }
    console.log(JSON.stringify({
      goldSetPath: options.goldSetPath,
      totalCases: selectedCases.length,
      byCategory,
    }, null, 2));
    return;
  }

  if (options.rescorePath) {
    const existingOutput = await readJson(options.rescorePath);
    const caseMap = new Map(selectedCases.map((testCase) => [testCase.id, testCase]));
    const rescoredResults = [];

    for (const result of existingOutput.results ?? []) {
      const testCase = caseMap.get(result.id);
      if (!testCase) {
        continue;
      }

      if (result.error) {
        rescoredResults.push(result);
        continue;
      }

      rescoredResults.push({
        ...result,
        metrics: createMetrics(
          testCase,
          result.answerText ?? "",
          sourceIndex,
          extractCitedUrls(result.answerText ?? ""),
        ),
      });
    }

    const rescoredOutput = {
      ...existingOutput,
      meta: {
        ...(existingOutput.meta ?? {}),
        rescoredAt: new Date().toISOString(),
        rescoredFrom: options.rescorePath,
        goldSetPath: options.goldSetPath,
      },
      summary: summarizeResults(rescoredResults),
      results: rescoredResults,
    };

    await writeJson(options.outputPath, rescoredOutput);
    console.log(`Saved rescored results to ${options.outputPath}`);
    console.log(JSON.stringify(rescoredOutput.summary, null, 2));
    return;
  }

  const results = [];
  for (let index = 0; index < selectedCases.length; index += 1) {
    const testCase = selectedCases[index];
    console.log(`[${index + 1}/${selectedCases.length}] ${testCase.id}`);
    const result = await runCase(testCase, options, sourceIndex);
    results.push(result);

    if (index < selectedCases.length - 1) {
      await sleep(options.delayMs);
    }
  }

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      baseUrl: options.baseUrl,
      goldSetPath: options.goldSetPath,
      totalCases: selectedCases.length,
      timeoutMs: options.timeoutMs,
      delayMs: options.delayMs,
      maxRetries: options.maxRetries,
    },
    summary: summarizeResults(results),
    results,
  };

  await writeJson(options.outputPath, output);
  console.log(`Saved results to ${options.outputPath}`);
  console.log(JSON.stringify(output.summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
