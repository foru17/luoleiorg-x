import { generateObject, generateText, jsonSchema, type UIMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ArticleContext, TweetContext } from "@/lib/ai/chat-prompt";
import {
  extractJsonPayload,
  toTokenUsageStats,
} from "@/lib/ai/chat-utils";
import { getMessageText } from "@/lib/ai/search-query";
import type { TokenUsageStats } from "@/lib/telegram";

const ANALYSIS_RECENT_MESSAGES = 4;
const MAX_ANALYSIS_ARTICLES = 8;
const MAX_ANALYSIS_TWEETS = 5;
const MAX_ARTICLE_SUMMARY_LENGTH = 56;
const MAX_ARTICLE_KEYPOINT_LENGTH = 16;
const MAX_TWEET_TEXT_LENGTH = 64;
const REPAIR_MAX_OUTPUT_TOKENS = 320;
const REPAIR_TIMEOUT_MS = 2200;
const ENABLE_EVIDENCE_STRUCTURED_OUTPUT =
  String(process.env.EVIDENCE_ANALYSIS_STRUCTURED_OUTPUT ?? "").trim().toLowerCase() === "true";
const TRAVEL_AGGREGATE_TERMS = ["旅行", "游记", "国家", "海外", "出国", "城市", "目的地"];

const SKIP_ANALYSIS_PATTERNS = [
  /^(你好|hi|hello|hey|嗨|哈喽|早上好|晚上好|下午好)/i,
  /^(谢谢|感谢|thanks|ok|好的|收到|明白)/i,
  /^(你是谁|who are you|介绍一下自己)/i,
  /(宠物|养宠|猫|狗|柴犬)/,
  /(合作|全职机会|商务合作|技术咨询)/,
  /(工作经历|在哪些公司工作|过去都在哪些公司|在阅文做过什么|科班出身|转成程序员|公开演讲过吗|现在主要在做什么)/,
];

const EVIDENCE_ANALYSIS_PROMPT = `你是检索证据分析器。把 evidence pack 整理成 JSON 结论，不写最终回答。

规则：
- 只用 evidence pack 中的事实，禁止补充
- 只输出 JSON，不要 Markdown
- evidenceUrls 必须逐字用 evidence pack 给出的完整 URL
- 证据不足时用 uncertainties 说明，不要硬猜
- 聚合类问题（去过/读过/跑过几次）：去重、区分 visited/planned/mentioned
- 同一事件多篇文章不等于多次
- countMode 优先 at_least 或 unknown，除非证据明确写了总数
- entities≤6 note简短；keyFindings≤4；recommendedUrls≤3

博客格式：A序号|日期|标题|摘要|要点|URL
X格式：T序号|日期|标题|正文|URL

输出JSON：
{
  “questionType”: “fact|list|count|timeline|recommendation|opinion|mixed|unknown”,
  “directAnswer”: “一句话结论”,
  “entities”: [{“name”:””,”relation”:”travel|race|reading|project|career|topic|other”,”status”:”visited|planned|mentioned|completed|published|ongoing|unknown”,”count”:2,”countMode”:”exact|at_least|unknown”,”note”:””,”evidenceUrls”:[]}],
  “keyFindings”: [{“claim”:””,”confidence”:”high|medium|low”,”evidenceUrls”:[]}],
  “uncertainties”: [],
  “recommendedUrls”: []
}`;

const EVIDENCE_ANALYSIS_REPAIR_PROMPT = `修复截断/格式错误的 JSON。只输出合法 JSON，不补充原文没有的信息。缺失字段用空字符串或空数组。entities≤6，keyFindings≤4，recommendedUrls≤3。`;

const EVIDENCE_ANALYSIS_SCHEMA = jsonSchema<EvidenceAnalysis>({
  type: "object",
  additionalProperties: false,
  properties: {
    questionType: {
      type: "string",
      enum: ["fact", "list", "count", "timeline", "recommendation", "opinion", "mixed", "unknown"],
    },
    directAnswer: { type: "string" },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          relation: { type: "string" },
          status: { type: "string" },
          count: {
            anyOf: [{ type: "integer" }, { type: "null" }],
          },
          countMode: { type: "string", enum: ["exact", "at_least", "unknown"] },
          note: { type: "string" },
          evidenceUrls: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["name", "relation", "status", "evidenceUrls"],
      },
    },
    keyFindings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claim: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          evidenceUrls: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["claim", "confidence", "evidenceUrls"],
      },
    },
    uncertainties: {
      type: "array",
      items: { type: "string" },
    },
    recommendedUrls: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "questionType",
    "directAnswer",
    "entities",
    "keyFindings",
    "uncertainties",
    "recommendedUrls",
  ],
});

export interface EvidenceEntity {
  name: string;
  relation: string;
  status: string;
  count?: number;
  countMode?: "exact" | "at_least" | "unknown";
  note?: string;
  evidenceUrls: string[];
}

export interface EvidenceFinding {
  claim: string;
  confidence: "high" | "medium" | "low";
  evidenceUrls: string[];
}

export interface EvidenceAnalysis {
  questionType: string;
  directAnswer: string;
  entities: EvidenceEntity[];
  keyFindings: EvidenceFinding[];
  uncertainties: string[];
  recommendedUrls: string[];
}

function decodeJsonStringLiteral(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value
      .replace(/\\"/g, "\"")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeString(value: unknown, maxLength = 160): string {
  if (typeof value !== "string") return "";
  return truncateText(value.trim().replace(/\s+/g, " "), maxLength);
}

function normalizeQuestionType(value: unknown): string {
  const normalized = normalizeString(value, 32).toLowerCase();
  const allowed = new Set([
    "fact",
    "list",
    "count",
    "timeline",
    "recommendation",
    "opinion",
    "mixed",
    "unknown",
  ]);
  return allowed.has(normalized) ? normalized : "unknown";
}

function countKeywordHits(text: string, keywords: string[]): number {
  const normalized = normalizeString(text, 2000).toLowerCase();
  if (!normalized) return 0;

  let hits = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword.toLowerCase())) {
      hits += 1;
    }
  }
  return hits;
}

function isTravelAggregateQuery(searchQuery: string): boolean {
  return countKeywordHits(searchQuery, TRAVEL_AGGREGATE_TERMS) >= 2;
}

function resolveEvidenceBudget(
  searchQuery: string,
  complexity: "simple" | "moderate" | "complex",
): {
  articleLimit: number;
  tweetLimit: number;
  articleSummaryLength: number;
  articleKeyPointLength: number;
  tweetTextLength: number;
} {
  if (complexity === "simple") {
    return {
      articleLimit: 4,
      tweetLimit: 2,
      articleSummaryLength: 48,
      articleKeyPointLength: 14,
      tweetTextLength: 48,
    };
  }

  if (complexity === "moderate") {
    return {
      articleLimit: 6,
      tweetLimit: 4,
      articleSummaryLength: 56,
      articleKeyPointLength: 16,
      tweetTextLength: 56,
    };
  }

  // Complex: full budget for aggregation/timeline
  if (isTravelAggregateQuery(searchQuery)) {
    return {
      articleLimit: 8,
      tweetLimit: 2,
      articleSummaryLength: 48,
      articleKeyPointLength: 14,
      tweetTextLength: 56,
    };
  }

  return {
    articleLimit: MAX_ANALYSIS_ARTICLES,
    tweetLimit: MAX_ANALYSIS_TWEETS,
    articleSummaryLength: MAX_ARTICLE_SUMMARY_LENGTH,
    articleKeyPointLength: MAX_ARTICLE_KEYPOINT_LENGTH,
    tweetTextLength: MAX_TWEET_TEXT_LENGTH,
  };
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  const normalized = normalizeString(value, 16).toLowerCase();
  if (normalized === "high" || normalized === "low") return normalized;
  return "medium";
}

function normalizeCountMode(value: unknown): "exact" | "at_least" | "unknown" {
  const normalized = normalizeString(value, 16).toLowerCase();
  if (normalized === "exact" || normalized === "at_least") return normalized;
  return "unknown";
}

function normalizeCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : undefined;
}

function normalizeUrlList(value: unknown, allowedUrls: Set<string>): string[] {
  if (!Array.isArray(value)) return [];
  const urls: string[] = [];
  for (const item of value) {
    const normalized = normalizeString(item, 400);
    if (!normalized || !allowedUrls.has(normalized) || urls.includes(normalized)) continue;
    urls.push(normalized);
    if (urls.length >= 4) break;
  }
  return urls;
}

function salvageEntitiesFromText(text: string): Record<string, unknown>[] {
  // Match each entity object in the entities array, even if the outer array is truncated.
  // We look for complete {...} blocks that contain a "name" field.
  const results: Record<string, unknown>[] = [];
  const entityStart = text.indexOf('"entities"');
  if (entityStart < 0) return results;

  const slice = text.slice(entityStart);
  // Find all {...} blocks that look like entity objects
  let depth = 0;
  let start = -1;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = slice.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const obj = parsed as Record<string, unknown>;
            if (typeof obj.name === "string" && obj.name) {
              results.push(obj);
              if (results.length >= 8) break;
            }
          }
        } catch {
          // partial block — skip
        }
        start = -1;
      }
    }
  }
  return results;
}

function salvageKeyFindingsFromText(text: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const sectionStart = text.indexOf('"keyFindings"');
  if (sectionStart < 0) return results;

  const slice = text.slice(sectionStart);
  let depth = 0;
  let start = -1;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i];
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = slice.slice(start, i + 1);
        try {
          const parsed = JSON.parse(candidate) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const obj = parsed as Record<string, unknown>;
            if (typeof obj.claim === "string" && obj.claim) {
              results.push(obj);
              if (results.length >= 4) break;
            }
          }
        } catch {
          // partial block — skip
        }
        start = -1;
      }
    }
  }
  return results;
}

function salvageTruncatedEvidencePayload(text: string): Record<string, unknown> | null {
  const normalized = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const questionTypeMatch = normalized.match(/"questionType"\s*:\s*"([^"]+)"/);
  const directAnswerMatch = normalized.match(/"directAnswer"\s*:\s*"((?:\\.|[^"\\])*)"/);
  const uncertaintyMatches = [...normalized.matchAll(/"uncertainties"\s*:\s*\[((?:.|\n)*?)\]/g)];

  const questionType = questionTypeMatch?.[1]?.trim() ?? "unknown";
  const directAnswer = directAnswerMatch?.[1]
    ? decodeJsonStringLiteral(directAnswerMatch[1]).trim()
    : "";

  const uncertainties = uncertaintyMatches.length > 0
    ? [...uncertaintyMatches[0][1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
        .map((match) => decodeJsonStringLiteral(match[1]).trim())
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const entities = salvageEntitiesFromText(normalized);
  const keyFindings = salvageKeyFindingsFromText(normalized);

  if (!directAnswer && entities.length === 0 && keyFindings.length === 0) return null;

  return {
    questionType,
    directAnswer,
    entities,
    keyFindings,
    uncertainties,
    recommendedUrls: [],
  };
}

function formatConversation(messages: Array<Omit<UIMessage, "id">>): string {
  return messages
    .slice(-ANALYSIS_RECENT_MESSAGES)
    .map((message) => {
      const text = getMessageText(message).trim();
      if (!text) return "";
      return `${message.role === "user" ? "读者" : "博主"}：${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

function formatArticles(
  articles: ArticleContext[],
  budget: ReturnType<typeof resolveEvidenceBudget>,
): string {
  if (articles.length === 0) return "（无）";

  return articles
    .slice(0, budget.articleLimit)
    .map((article, index) => {
      const keyPoints = article.keyPoints
        .slice(0, 1)
        .map((point) => truncateText(point, budget.articleKeyPointLength))
        .join("；");
      const summary = truncateText(article.summary, budget.articleSummaryLength) || "无";
      const date = article.dateTime ? new Date(article.dateTime).toISOString().slice(0, 10) : "未知";
      return `A${index + 1}|${date}|${article.title}|${summary}${keyPoints ? `|${keyPoints}` : ""}|${article.url}`;
    })
    .join("\n");
}

function formatTweets(
  tweets: TweetContext[],
  budget: ReturnType<typeof resolveEvidenceBudget>,
): string {
  if (tweets.length === 0) return "（无）";

  return tweets
    .slice(0, budget.tweetLimit)
    .map((tweet, index) => {
      const date = tweet.date || "未知";
      const text = truncateText(tweet.text, budget.tweetTextLength);
      return `T${index + 1}|${date}|${tweet.title}|${text}|${tweet.url}`;
    })
    .join("\n");
}

function sanitizeEvidenceAnalysis(
  payload: Record<string, unknown> | null,
  allowedUrls: Set<string>,
): EvidenceAnalysis | null {
  if (!payload) return null;

  const entities = Array.isArray(payload.entities)
    ? payload.entities
        .map((item): EvidenceEntity | null => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const entity = item as Record<string, unknown>;
          const name = normalizeString(entity.name, 48);
          if (!name) return null;
          const count = normalizeCount(entity.count);
          const note = normalizeString(entity.note, 120) || undefined;
          const evidenceEntity: EvidenceEntity = {
            name,
            relation: normalizeString(entity.relation, 24) || "other",
            status: normalizeString(entity.status, 24) || "unknown",
            countMode: normalizeCountMode(entity.countMode),
            evidenceUrls: normalizeUrlList(entity.evidenceUrls, allowedUrls),
          };
          if (count !== undefined) {
            evidenceEntity.count = count;
          }
          if (note) {
            evidenceEntity.note = note;
          }
          return evidenceEntity;
        })
        .filter((item): item is EvidenceEntity => item !== null)
        .slice(0, 8)
    : [];

  const keyFindings = Array.isArray(payload.keyFindings)
    ? payload.keyFindings
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return null;
          const finding = item as Record<string, unknown>;
          const claim = normalizeString(finding.claim, 180);
          if (!claim) return null;
          return {
            claim,
            confidence: normalizeConfidence(finding.confidence),
            evidenceUrls: normalizeUrlList(finding.evidenceUrls, allowedUrls),
          } satisfies EvidenceFinding;
        })
        .filter((item): item is EvidenceFinding => item !== null)
        .slice(0, 8)
    : [];

  const uncertainties = Array.isArray(payload.uncertainties)
    ? payload.uncertainties
        .map((item) => normalizeString(item, 180))
        .filter(Boolean)
        .slice(0, 6)
    : [];

  const recommendedUrls = normalizeUrlList(payload.recommendedUrls, allowedUrls).slice(0, 4);
  const directAnswer = normalizeString(payload.directAnswer, 220);

  if (!directAnswer && entities.length === 0 && keyFindings.length === 0) {
    return null;
  }

  return {
    questionType: normalizeQuestionType(payload.questionType),
    directAnswer,
    entities,
    keyFindings,
    uncertainties,
    recommendedUrls,
  };
}

function formatCount(entity: EvidenceEntity): string {
  if (!entity.count) return "未明确";
  if (entity.countMode === "exact") return `${entity.count}`;
  if (entity.countMode === "at_least") return `至少 ${entity.count}`;
  return `${entity.count}`;
}

export function buildEvidenceAnalysisSection(
  analysis: EvidenceAnalysis,
  sourceTitleByUrl: Map<string, string>,
): string {
  const lines: string[] = [
    "## 检索证据分析摘要",
    "以下内容是基于本轮检索结果整理出的中间结论，可用于组织答案，但不能覆盖原始证据本身。",
    `- 问题类型：${analysis.questionType || "unknown"}`,
  ];

  if (analysis.directAnswer) {
    lines.push(`- 直接结论：${analysis.directAnswer}`);
  }

  if (analysis.entities.length > 0) {
    lines.push("", "### 聚合实体");
    for (const entity of analysis.entities) {
      const evidenceTitles = entity.evidenceUrls
        .map((url) => sourceTitleByUrl.get(url))
        .filter(Boolean)
        .slice(0, 3)
        .join("；");
      const parts = [
        entity.name,
        `relation=${entity.relation}`,
        `status=${entity.status}`,
      ];
      if (entity.count) {
        parts.push(`count=${formatCount(entity)}`);
      }
      if (entity.note) {
        parts.push(`note=${entity.note}`);
      }
      if (evidenceTitles) {
        parts.push(`evidence=${evidenceTitles}`);
      }
      lines.push(`- ${parts.join("｜")}`);
    }
  }

  if (analysis.keyFindings.length > 0) {
    lines.push("", "### 关键发现");
    for (const finding of analysis.keyFindings) {
      const evidenceTitles = finding.evidenceUrls
        .map((url) => sourceTitleByUrl.get(url))
        .filter(Boolean)
        .slice(0, 3)
        .join("；");
      lines.push(
        `- ${finding.claim}${evidenceTitles ? `（证据：${evidenceTitles}）` : ""}｜confidence=${finding.confidence}`,
      );
    }
  }

  if (analysis.uncertainties.length > 0) {
    lines.push("", "### 不确定性");
    for (const item of analysis.uncertainties) {
      lines.push(`- ${item}`);
    }
  }

  if (analysis.recommendedUrls.length > 0) {
    lines.push("", "### 优先参考链接");
    for (const url of analysis.recommendedUrls) {
      lines.push(`- ${url}`);
    }
  }

  lines.push(
    "",
    "使用要求：优先按本节组织回答；若本节与原始文章/动态内容冲突，以原始证据为准；不要新增本节未支持的具体数字或实体。",
  );

  return lines.join("\n");
}

async function repairEvidenceAnalysisText(params: {
  text: string;
  provider: ReturnType<typeof createOpenAICompatible>;
  model: string;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const { text, provider, model, abortSignal } = params;
  const extracted = extractJsonPayload(text);
  if (extracted) {
    return JSON.stringify(extracted);
  }

  const repairAbortController = new AbortController();
  let repairTimeoutId: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => repairAbortController.abort();
  if (abortSignal) {
    if (abortSignal.aborted) {
      repairAbortController.abort();
    } else {
      abortSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  try {
    repairTimeoutId = setTimeout(() => repairAbortController.abort(), REPAIR_TIMEOUT_MS);
    const repairResult = await generateText({
      model: provider.chatModel(model),
      system: EVIDENCE_ANALYSIS_REPAIR_PROMPT,
      prompt: text,
      temperature: 0,
      maxOutputTokens: REPAIR_MAX_OUTPUT_TOKENS,
      abortSignal: repairAbortController.signal,
    });
    const repairedPayload = extractJsonPayload(repairResult.text);
    return repairedPayload ? JSON.stringify(repairedPayload) : null;
  } catch {
    return null;
  } finally {
    if (repairTimeoutId) clearTimeout(repairTimeoutId);
    if (abortSignal) {
      abortSignal.removeEventListener("abort", abortFromParent);
    }
  }
}

async function analyzeRetrievedEvidenceViaText(params: {
  prompt: string;
  promptLength: number;
  allowedUrls: Set<string>;
  provider: ReturnType<typeof createOpenAICompatible>;
  model: string;
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
}): Promise<{
  analysis: EvidenceAnalysis | null;
  usage?: TokenUsageStats;
  rawText?: string;
  promptLength: number;
  parseStatus:
    | "success"
    | "success_repaired"
    | "success_salvaged"
    | "invalid_json"
    | "invalid_payload"
    | "request_error";
  error?: string;
}> {
  const { prompt, promptLength, allowedUrls, provider, model, maxOutputTokens, abortSignal } = params;

  try {
    const { text, totalUsage } = await generateText({
      model: provider.chatModel(model),
      system: EVIDENCE_ANALYSIS_PROMPT,
      prompt,
      temperature: 0,
      maxOutputTokens,
      abortSignal,
    });

    const payload = extractJsonPayload(text);
    const analysis = sanitizeEvidenceAnalysis(payload, allowedUrls);
    if (!analysis && text.trim()) {
      const repairedText = await repairEvidenceAnalysisText({
        text,
        provider,
        model,
        abortSignal,
      });
      if (repairedText) {
        const repairedPayload = extractJsonPayload(repairedText);
        const repairedAnalysis = sanitizeEvidenceAnalysis(repairedPayload, allowedUrls);
        if (repairedAnalysis) {
          return {
            analysis: repairedAnalysis,
            usage: toTokenUsageStats(totalUsage),
            rawText: repairedText,
            promptLength,
            parseStatus: "success_repaired",
          };
        }
      }

      const salvagedPayload = salvageTruncatedEvidencePayload(text);
      const salvagedAnalysis = sanitizeEvidenceAnalysis(salvagedPayload, allowedUrls);
      if (salvagedAnalysis) {
        return {
          analysis: salvagedAnalysis,
          usage: toTokenUsageStats(totalUsage),
          rawText: text,
          promptLength,
          parseStatus: "success_salvaged",
        };
      }
    }

    return {
      analysis,
      usage: toTokenUsageStats(totalUsage),
      rawText: text,
      promptLength,
      parseStatus: analysis ? "success" : payload ? "invalid_payload" : "invalid_json",
    };
  } catch (error) {
    return {
      analysis: null,
      promptLength,
      parseStatus: "request_error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function shouldSkipAnalysis(
  latestText: string,
  articleCount: number,
  tweetCount: number,
): boolean {
  const trimmed = latestText.trim();
  if (!trimmed || trimmed.length < 2) return true;
  if (articleCount === 0 && tweetCount === 0) return true;
  if (articleCount + tweetCount <= 1) return true;
  return SKIP_ANALYSIS_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export async function analyzeRetrievedEvidence(params: {
  messages: Array<Omit<UIMessage, "id">>;
  searchQuery: string;
  articles: ArticleContext[];
  tweets: TweetContext[];
  provider: ReturnType<typeof createOpenAICompatible>;
  model: string;
  maxOutputTokens: number;
  complexity?: "simple" | "moderate" | "complex";
  abortSignal?: AbortSignal;
}): Promise<{
  analysis: EvidenceAnalysis | null;
  usage?: TokenUsageStats;
  rawText?: string;
  promptLength: number;
  parseStatus:
    | "success"
    | "success_repaired"
    | "success_salvaged"
    | "invalid_json"
    | "invalid_payload"
    | "request_error";
  error?: string;
}> {
  const { messages, searchQuery, articles, tweets, provider, model, maxOutputTokens, complexity, abortSignal } = params;

  if (articles.length === 0 && tweets.length === 0) {
    return { analysis: null, promptLength: 0, parseStatus: "invalid_payload" };
  }

  const allowedUrls = new Set<string>([
    ...articles.map((item) => item.url),
    ...tweets.map((item) => item.url),
  ]);
  const budget = resolveEvidenceBudget(searchQuery, complexity || "moderate");

  const prompt = [
    `用户当前检索 query：${searchQuery || "（无）"}`,
    "",
    "最近对话：",
    formatConversation(messages),
    "",
    "博客证据：",
    formatArticles(articles, budget),
    "",
    "X 动态证据：",
    formatTweets(tweets, budget),
  ].join("\n");
  if (ENABLE_EVIDENCE_STRUCTURED_OUTPUT) {
    try {
      const result = await generateObject({
        model: provider.chatModel(model),
        system: EVIDENCE_ANALYSIS_PROMPT,
        prompt,
        schema: EVIDENCE_ANALYSIS_SCHEMA,
        schemaName: "evidence_analysis",
        schemaDescription: "Structured evidence analysis for answer planning.",
        temperature: 0,
        maxOutputTokens,
        abortSignal,
        experimental_repairText: async ({ text }) =>
          repairEvidenceAnalysisText({
            text,
            provider,
            model,
            abortSignal,
          }),
      });

      const analysis = sanitizeEvidenceAnalysis(
        result.object as unknown as Record<string, unknown>,
        allowedUrls,
      );
      if (analysis) {
        return {
          analysis,
          usage: toTokenUsageStats(result.usage),
          rawText: JSON.stringify(result.object),
          promptLength: prompt.length,
          parseStatus: "success",
        };
      }
    } catch {
      // Fall through to text-mode fallback.
    }
  }

  return analyzeRetrievedEvidenceViaText({
    prompt,
    promptLength: prompt.length,
    allowedUrls,
    provider,
    model,
    maxOutputTokens,
    abortSignal,
  });
}
