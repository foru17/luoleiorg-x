# AI 数字分身对话系统 — 架构升级规划

> 基于 `docs/ai-chat-review-report.md` 的诊断结论
> 版本：v4（2026-03-07）
> 原则：**数据先行 → 减法瘦身 → 检索增强 → 风格还原**

---

## 目录

0. [Phase 0: 数据治理（紧急）](#0-phase-0-数据治理)
1. [设计原则](#1-设计原则)
2. [Phase 1: 流程瘦身（1-2 天）](#2-phase-1-流程瘦身)
3. [Phase 2: 检索升级（2-3 天）](#3-phase-2-检索升级)
4. [Phase 3: Prompt 重构（1-2 天）](#4-phase-3-prompt-重构)
5. [Phase 4: 人格还原增强（1 天）](#5-phase-4-人格还原增强)
6. [Phase 5: 工程治理（持续）](#6-phase-5-工程治理)
7. [Phase 6: 评测体系（持续）](#7-phase-6-评测体系)
8. [架构对比](#8-架构对比)
9. [风险与回退策略](#9-风险与回退策略)
10. [效果度量](#10-效果度量)

---

## 0. Phase 0: 数据治理

> **最高优先级**。当前 `structuredFacts` 中存在明确的错误数据，且在 prompt 中被赋予了"优先参考"权重——这是数据失真的首要根源。

### 0.1 问题现状

`data/structured-facts-aggregated.json` 中存在以下已确认的错误：
- 旅行国家列表中出现"中国"（作为海外目的地）
- 旅行国家中出现"印度"，但证据来自尼泊尔签证攻略
- 阅读总数 `100` 的来源是一篇东极岛旅行文章（`book_count: 100` 误提取）
- 马拉松赛事存在多条重复、年份级日期和回顾文章混入
- `2014上海国际马拉松` 的结果出现了"未提及"

根本原因：Gemini 逐文章提取 → 聚合管道没有验证层 → 错误事实直接进入 `author-context.json` → prompt 中标注"优先参考本节"

### 0.2 立即执行：降级 structuredFacts 的 prompt 权重

**动作：** 修改 `runtime-context.ts` 中 `buildStructuredFactsSection()` 的引导语：

```diff
- "以下数据由离线脚本从博客全量内容提取，回答旅行目的地、马拉松场次、读书情况等问题时，优先参考本节。"
+ "以下数据由离线脚本从博客内容自动提取，可能存在遗漏或误标。回答时应以检索到的原始文章为准，本节仅作辅助参考。如果本节与原文冲突，以原文为准。"
```

### 0.3 清洗现有数据

**动作：** 对 `structured-facts-aggregated.json` 进行人工审核和修正：

1. **旅行国家**：移除"中国"、验证"印度"（如果只出现在签证攻略中则移除）
2. **阅读统计**：删除错误的 `book_count: 100`，从年度读书总结文章中重新提取
3. **马拉松记录**：去重、修正日期格式、移除回顾文章中的历史数据重复
4. 对每个条目标注 provenance：`source: "rule_extracted" | "gemini_extracted" | "manual_verified"`

### 0.4 建立事实注册表（Fact Registry）

在 `data/` 下新增 `fact-registry.json`，结构：

```typescript
interface FactEntry {
  id: string;                    // "travel:japan", "race:2024-zhuhai"
  category: "travel" | "race" | "reading" | "project" | "career";
  claim: string;                 // "去过日本，至少 4 次"
  confidence: "verified" | "likely" | "uncertain";
  provenance: "blog_post" | "tweet" | "github" | "manual" | "model_extracted";
  evidenceUrls: string[];
  lastVerifiedAt: string;        // ISO date
}
```

**规则：**
- `confidence: "verified"` 的条目可以在 prompt 中作为确定事实使用
- `confidence: "likely"` 的条目需要加"据博客记录"前缀
- `confidence: "uncertain"` 的条目不进入 prompt，仅作为内部索引

### 0.5 Provenance 分层

在 prompt 中为不同来源的信息标注信任等级：

```
知识来源说明（按可信度从高到低）：
1. 原始文章/推文内容 → 可直接引用
2. GitHub 简历/自述 → 可引用，标注"据简历记录"
3. 结构化事实索引（已人工校验） → 可引用，标注"据博客记录"
4. 自动提取的统计数据 → 仅作参考，标注"约/至少"
```

---

## 1. 设计原则

1. **数据质量第一**：错误的数据进入 prompt 比没有数据更有害——宁可少说，不可乱说
2. **单模型优先**：一次请求最多 2 次 LLM 调用（查询重写 + 主对话），而非当前的 5 次
3. **检索为王**：把精力从"修复 LLM 分析输出"转移到"提高检索质量"
4. **信任主模型**：GPT-4 / Claude 3.5 级别的模型完全有能力直接从 10-15 条结构化上下文中提取答案，不需要中间分析层
5. **引用即校验**：要求主模型内联标注引用来源，让用户可直接验证，替代前置证据分析
6. **最小 Prompt**：系统提示词目标 4000-5000 tokens（当前估计 8000-12000），聚焦在"身份 + 规则 + 当前证据"

---

## 2. Phase 1: 流程瘦身

> 目标：从 5 次 LLM 调用降到 2 次，端到端延迟从 10-15s 降到 3-5s

### 2.1 移除证据分析中间层

**动作：**
- 删除 `analyzeRetrievedEvidence()` 调用
- 删除 `buildEvidenceAnalysisSection()` 及其 prompt
- 删除 JSON salvage/repair 逻辑（`salvageEntitiesFromText`、`salvageKeyFindingsFromText`、`salvageTruncatedEvidencePayload`、`repairEvidenceAnalysisText`）
- 删除 `evidence-analysis.ts` 中约 600 行代码（保留类型定义和 `formatArticles`/`formatTweets` 如果其他地方需要）

**替代方案：**
- 在主模型的系统提示词中加入"内联引用"指令：
  ```
  回答时引用来源，格式：「据《文章标题》记录，...」或「在 X 动态中提到，...」
  如果信息来自结构化事实索引，标注「据博客记录」
  无法确认的信息，说明「博客中暂未找到相关记录」
  ```
- 将当前证据分析 prompt 中有价值的"聚合指令"（区分 visited/planned/mentioned，countMode 逻辑）移入主模型系统提示词的规则段

**预期收益：**
- 消除 7-10s 延迟
- 消除一次 LLM 调用及其 token 成本
- 消除 300+ 行 JSON 修复代码
- 消除截断导致的信息丢失

### 2.2 移除回答修复层

**动作：**
- 删除 `repairIncompleteResponseTail()` 调用
- 删除 `RESPONSE_REPAIR_PROMPT`
- 删除 `shouldRepairResponseTail()`、`normalizeRepairedTail()`、`endsWithCompleteSentence()`

**理由：**
- 如果主模型频繁输出不完整的句子，问题在于 `maxOutputTokens: 2000` 不够或 prompt 太长
- 正确的修复方式是优化 prompt 使其更短，或将 maxOutputTokens 提高到 2500-3000
- 2.5s 超时 + 80 token 的补全几乎不可能比直接提高 maxOutputTokens 更好

**预期收益：**
- 消除 2.5s 延迟
- 消除一次 LLM 调用

### 2.3 简化关键词提取为查询重写

**动作：**
- 将 `extractSearchKeywords()` 改名为 `rewriteSearchQuery()`
- 简化 prompt：从当前的"提取 primaryTerms + relatedTerms + complexity"改为直接输出"重写后的搜索查询 + complexity"
- 移除 `buildKeywordQueryFromModelOutput()`（不再需要拆分 primary/related）
- 移除多轮搜索逻辑（只用重写后的 query 搜索一次）

**新的查询重写 prompt（示例）：**
```
你是搜索查询重写器。根据对话上下文，输出一行 JSON：
{"query": "空格分隔的搜索词", "complexity": "simple|moderate|complex"}

规则：
- query 只包含主题实体词，3-8 个词
- 不要输出功能词（写过、去过、多少）
- 旅行经历类问题用：旅行 游记 + 具体地名
- 马拉松类问题用：马拉松 跑步 赛事
```

**预期收益：**
- 保持查询理解能力
- 移除 primaryQuery 的二次搜索
- 简化代码约 150 行

### 2.4 保留但简化会话缓存复用

**动作：**
- 移除 `isSameSearchIntent()` 的 AI 调用
- 改用纯规则判定：如果 token 重叠 >= 60% 且无新实体词 → 复用
- 这样就消除了 1.5s 的意图判定延迟

**新判定逻辑：**
```typescript
const shouldReuse =
  cachedContext &&
  userTurnCount > 1 &&
  isLikelyFollowUp(latestText) &&
  hasSearchQueryOverlap(query, cachedContext.query, 0.6) &&
  !hasNewSignificantTokens(query, cachedContext.query);
```

**预期收益：**
- 消除一次 LLM 调用
- 减少 1.5s 延迟
- 极少量的误判（从 SAME 误判为 SHIFT）可通过 fallback 搜索补偿

### Phase 1 后的流程

```
用户消息 → 速率限制 → 会话缓存检查（纯规则）
         → 查询重写（AI，3s 超时）  ← 仅 1 次 LLM 调用
         → 搜索（一次）
         → 系统提示词拼装（身份 + 规则 + 结构化事实 + 搜索结果）
         → 流式回答生成（带内联引用）← 1 次 LLM 调用
         → Telegram 通知
```

**LLM 调用：5 → 2**
**预计延迟：10-15s → 3-5s**

---

## 3. Phase 2: 检索升级

> 目标：从纯关键词检索升级为语义检索，根治"搜不到"问题

### 3.1 方案选择

考虑到这是个人博客项目（~400 篇文章 + ~1000 条推文），不需要重型向量数据库。推荐方案：

**方案 A（推荐）：构建时生成 Embedding + 运行时内存检索**

```
构建时：
  文章/推文 → 分 Chunk → 调用 Embedding API → 保存为 JSON
  ↓
运行时：
  用户查询 → Embedding → 与预计算向量做余弦相似度 → Top-K
```

技术选择：
- Embedding 模型：`text-embedding-3-small`（OpenAI）或 `bge-m3`（本地/API）
- 向量存储：直接作为 JSON 文件（`/data/embeddings.json`），运行时加载到内存
- Chunk 策略：文章按段落分 chunk（每 chunk 约 200-400 字），保留元数据（标题、URL、日期、分类）

**方案 B（备选）：使用 Cloudflare Vectorize**

如果部署在 Cloudflare Workers 上，可以直接用 Vectorize。但增加了外部依赖。

### 3.2 Chunk 策略

```typescript
interface Chunk {
  id: string;            // "post:slug:chunk-3" 或 "tweet:id"
  text: string;          // 200-400 字的文本片段
  embedding: number[];   // 1536 维向量（text-embedding-3-small）
  metadata: {
    sourceType: "article" | "tweet";
    title: string;
    url: string;
    date: string;
    categories: string[];
    position: number;    // chunk 在文章中的位置
  };
}
```

文章分 chunk 规则：
1. 按 `\n\n`（空行）分段
2. 相邻段落合并到 200-400 字
3. 每个 chunk 保留文章标题作为前缀（提升检索精确度）
4. 推文不分 chunk（单条即为一个 chunk）

### 3.3 混合检索

运行时同时执行两种检索，合并结果：

```
查询 → ┬→ 向量检索（语义匹配） → Top-10
       └→ 关键词检索（精确匹配） → Top-10
                          ↓
                    RRF 合并排序
                          ↓
                      Top-K 结果
```

使用 **Reciprocal Rank Fusion (RRF)** 合并：
```typescript
function rrfScore(ranks: number[], k = 60): number {
  return ranks.reduce((sum, rank) => sum + 1 / (k + rank), 0);
}
```

### 3.4 构建流程变更

在 `scripts/` 下新增 `build-embeddings.mjs`：

```bash
# 构建命令
node scripts/build-embeddings.mjs

# 输出
# data/embeddings.json (~5-10MB for 400 articles + 1000 tweets)
# data/embeddings-meta.json (hash-based change tracking)
```

增量更新：只对新增/修改的文章重新计算 embedding。

### 3.5 移除的复杂度

引入向量检索后，以下代码可以删除：
- `SEMANTIC_FALLBACK_RULES`（硬编码的正则 → 搜索词映射）
- Travel re-ranking（正/负面词表 + 手动加权）
- Anchor term 筛选逻辑
- Intent ranking 的启发式规则（`intent-ranking.ts` 的大部分）
- 多轮搜索 + 合并逻辑

---

## 4. Phase 3: Prompt 重构

> 目标：系统提示词从 8000-12000 tokens 压缩到 4000-5000 tokens，聚焦在"身份 + 规则 + 当前证据"

### 4.1 新的 Prompt 结构

```
┌─────────────────────────────────────────┐
│ 1. 身份设定（200 tokens）               │
│    - 你是罗磊的 AI 分身                 │
│    - 核心身份标签                        │
│    - 语言风格描述                        │
├─────────────────────────────────────────┤
│ 2. 核心规则（300 tokens）               │
│    - 只引用可见信息                      │
│    - 内联引用格式                        │
│    - 不确定时承认                        │
│    - 数字不编造                          │
├─────────────────────────────────────────┤
│ 3. 个人档案（600-800 tokens）           │  ← 静态，精简版
│    - 简历摘要（3-5 行）                 │
│    - 技能标签（一行）                    │
│    - 社交链接                           │
├─────────────────────────────────────────┤
│ 4. 结构化事实索引（400-600 tokens）     │  ← 静态
│    - 旅行目的地列表                      │
│    - 马拉松记录                          │
│    - 阅读记录索引                        │
├─────────────────────────────────────────┤
│ 5. 检索结果（2000-3000 tokens）         │  ← 动态，按查询变化
│    - Chunk 级文本片段                    │
│    - 每个 chunk: 标题 + URL + 文本      │
│    - 最多 8-10 个 chunks                │
├─────────────────────────────────────────┤
│ 6. 风格样例（200-300 tokens）           │  ← 新增
│    - 2-3 个真实对话样例                  │
└─────────────────────────────────────────┘
```

### 4.2 身份设定精简

当前的 `buildCoreIdentity` 和 `buildAuthorBio` 合计包含：完整工作经历、所有技能详情、亮点列表、项目列表、公开活动等。

**精简方向：**
- 工作经历只保留最近 3 段 + 总年限
- 技能只保留一行标签（不按类别展开）
- 亮点只保留 3 个最有代表性的
- 项目只保留 2 个
- 公开活动移除（不常被问到，需要时通过搜索获取）

### 4.3 核心规则精简

当前 `core-rules.ts` 有 10+ 条规则，部分重复或过于细化。合并为 5 条：

```
1. 信息来源：只使用本消息中可见的信息（个人档案、结构化事实、检索结果）
2. 引用方式：引用文章时用「据《标题》」格式，引用推文用「在 X 上提到」
3. 数字纪律：具体数字必须来自明确来源，否则用「至少 N」或「博客中暂未统计」
4. 不知道：如果检索结果中没有相关信息，坦率说明，可引导用户查看博客
5. 链接格式：只输出 Markdown 格式链接 [标题](URL)，URL 必须来自检索结果
```

### 4.4 检索结果格式优化

当前格式（文章级，带序号）：
```
1. 《文章标题》 | URL
   摘要：140 字截断
   要点：28 字 × 3
```

**新格式（Chunk 级，更紧凑）：**
```
[1] 《文章标题》(2024-03-15) URL
这篇文章的相关段落内容，200-400 字，包含用户查询相关的具体信息...

[2] 《另一篇》(2024-01-20) URL
另一段相关内容...
```

优势：
- 直接给出相关文本片段，而非截断的摘要
- 主模型可以直接引用具体内容，而非依赖二手摘要
- 减少"失真链"长度：原文 → chunk（基本无损）→ 模型回答（一步）

---

## 5. Phase 4: 人格还原增强

> 目标：让对话"像罗磊本人在说话"，而非"AI 在背诵罗磊的简历"

### 5.1 语言风格描述

在身份设定中加入语言风格描述（从博客和推文中提取特征）：

```
语言风格：
- 中文为主，技术术语使用英文原词
- 语气直接、实在，不说客套话
- 乐于分享经验和踩坑记录
- 评价事物有自己的立场，不做面面俱到
- 长文章逻辑清晰、有小标题分段；短回答简洁利落
```

### 5.2 Few-shot 对话样例

从博客评论区、X 回复、或手动编写 2-3 个典型问答样例：

```
样例 1:
用户：你用什么技术栈？
罗磊：主力是 TypeScript + Next.js，前后端一把梭。部署在 Cloudflare 上，域名、CDN、Workers 都用他家的。
博客用 Markdown 写，搜索自己做的全文检索。之前折腾过 Docker + K8s 的 homelab，
现在更倾向于能跑在 edge 的方案，维护成本低。

样例 2:
用户：你跑过马拉松吗？
罗磊：跑过。据我博客记录，完成了至少 8 场全马。最近一场是 2024 年的 [XXX马拉松](URL)，
成绩 4 小时 28 分。我不是追求速度的选手，更享受完赛的过程。
```

### 5.3 构建风格样例库

在 `scripts/build-author-context.mjs` 中新增步骤：
1. 从推文中提取 5-10 条高互动、有代表性的回复
2. 从博客中提取 3-5 段口语化的段落（通常在文章开头或总结部分）
3. 存入 `author-context.json` 的 `styleSamples` 字段
4. 运行时随机选取 2-3 个注入 prompt

---

## 6. Phase 5: 工程治理

### 6.1 拆分 route.ts

将 1486 行的 `route.ts` 拆分为：

```
src/app/api/chat/
├── route.ts              # 200 行：请求入口、参数校验、流式响应
├── chat-pipeline.ts      # 300 行：核心流程编排
├── search-context.ts     # 150 行：会话缓存、搜索上下文管理
├── query-rewrite.ts      # 100 行：查询重写（原关键词提取）
├── error-handling.ts     # 80 行：错误分类、用户消息
└── debug-logger.ts       # 80 行：调试日志
```

### 6.2 消除重复代码

- 统一 `truncateText` / `normalizeString` 到 `src/lib/utils/text.ts`
- 统一 `toTokenUsageStats` 到 `src/lib/ai/token-usage.ts`
- 统一 `extractJsonPayload` 到 `src/lib/utils/json.ts`

### 6.3 配置收敛

当前有 30+ 个环境变量和常量散落在不同文件中。收敛到一个配置文件：

```typescript
// src/lib/ai/chat-config.ts
export const chatConfig = {
  search: {
    articleLimit: 10,
    tweetLimit: 6,
    chunkLimit: 10,          // 新增：chunk 级检索数量
    reuseOverlapThreshold: 0.6,
  },
  llm: {
    queryRewriteTimeout: 3000,
    queryRewriteMaxTokens: 64,
    chatMaxTokens: 2500,
    chatTemperature: 0.35,
  },
  session: {
    cacheTtlMs: 10 * 60 * 1000,
    maxCacheSize: 400,
    maxFollowUpLength: 48,
  },
} as const;
```

---

## 7. Phase 6: 评测体系

> 目标：建立可重复的回归评测，让每次改动都有数据支撑

### 7.1 最小评测集（Gold Set）

在 `data/eval/` 下创建 `gold-set.json`：

```typescript
interface EvalCase {
  id: string;
  category: "fact" | "aggregate" | "timeline" | "recommend" | "followup" | "boundary" | "persona";
  question: string;
  expectedSources: string[];         // 预期应引用的文章 URL
  expectedClaims: string[];          // 预期应包含的关键事实
  unexpectedClaims: string[];        // 不应出现的错误事实
  followUpQuestion?: string;         // 多轮追问
  notes?: string;
}
```

初始 20 题覆盖：
- 6 题事实查询（技术栈、简历、社交账号）
- 4 题聚合统计（国家、马拉松、读书）
- 3 题时间线（最近动态、最新文章）
- 2 题推荐（旅行文章、技术文章）
- 2 题多轮追问
- 2 题边界（政治、不相关话题）
- 1 题人格测试

### 7.2 自动评测脚本

新增 `scripts/eval-chat.mjs`：

```bash
node scripts/eval-chat.mjs --base-url http://localhost:3000 --output data/eval/results.json
```

评测维度：
1. **Source Hit Rate**：回答中引用的 URL 是否在 `expectedSources` 中
2. **Claim Coverage**：`expectedClaims` 中的事实是否被回答覆盖
3. **Hallucination Rate**：`unexpectedClaims` 中的错误事实是否出现在回答中
4. **Latency**：端到端响应时间

### 7.3 Trace 日志

每次请求记录完整 trace 用于事后分析：

```typescript
interface ChatTrace {
  requestId: string;
  timestamp: string;
  query: string;
  rewrittenQuery: string;
  searchResults: { title: string; url: string; score: number }[];
  promptTokenCount: number;
  responseText: string;
  citedUrls: string[];
  latencyMs: number;
}
```

存储到 `data/eval/traces/` 目录，按日期归档。

---

## 8. 架构对比

### 当前架构（v3）

```
                     ┌──────────────────┐
                     │   用户消息        │
                     └──────┬───────────┘
                            │
                     ┌──────▼───────────┐
                     │  速率限制 + 校验   │
                     └──────┬───────────┘
                            │
               ┌────────────▼────────────┐
               │  会话缓存检查            │
               │  (AI 意图复用判定 1.5s)  │  ← LLM #1
               └────────────┬────────────┘
                            │
               ┌────────────▼────────────┐
               │  AI 关键词提取 (3.5s)    │  ← LLM #2
               └────────────┬────────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │  多轮搜索（local + keyword + primary   │
        │  + fallback) + anchor + re-ranking     │
        └───────────────────┬───────────────────┘
                            │
               ┌────────────▼────────────┐
               │  AI 证据分析 (7s)        │  ← LLM #3
               │  + JSON repair (2.8s)    │
               └────────────┬────────────┘
                            │
               ┌────────────▼────────────┐
               │  Prompt 拼装             │
               │  (8000-12000 tokens)     │
               └────────────┬────────────┘
                            │
               ┌────────────▼────────────┐
               │  流式回答生成            │  ← LLM #4
               └────────────┬────────────┘
                            │
               ┌────────────▼────────────┐
               │  回答修复 (2.5s)         │  ← LLM #5
               └────────────┬────────────┘
                            │
                     ┌──────▼───────────┐
                     │   Telegram 通知   │
                     └──────────────────┘

LLM 调用：5 次
预计延迟：10-18s
Prompt 大小：8000-12000 tokens
```

### 目标架构（v4）

```
                     ┌──────────────────┐
                     │   用户消息        │
                     └──────┬───────────┘
                            │
                     ┌──────▼───────────┐
                     │  速率限制 + 校验   │
                     └──────┬───────────┘
                            │
               ┌────────────▼────────────┐
               │  会话缓存检查（纯规则）   │  ← 无 LLM
               └────────────┬────────────┘
                            │
               ┌────────────▼────────────┐
               │  查询重写 (3s)           │  ← LLM #1
               └────────────┬────────────┘
                            │
        ┌───────────────────▼───────────────────┐
        │  混合检索（向量 + 关键词 → RRF 合并）   │
        │  一次搜索，返回 Chunk 级结果            │
        └───────────────────┬───────────────────┘
                            │
               ┌────────────▼────────────┐
               │  Prompt 拼装             │
               │  (4000-5000 tokens)      │
               │  身份 + 规则 + 档案       │
               │  + 事实索引 + chunks      │
               │  + 风格样例              │
               └────────────┬────────────┘
                            │
               ┌────────────▼────────────┐
               │  流式回答生成            │  ← LLM #2
               │  (带内联引用)            │
               └────────────┬────────────┘
                            │
                     ┌──────▼───────────┐
                     │   Telegram 通知   │
                     └──────────────────┘

LLM 调用：2 次
预计延迟：3-5s
Prompt 大小：4000-5000 tokens
```

---

## 9. 风险与回退策略

### 8.1 移除证据分析层的风险

**风险：** 复杂聚合类问题（"去过哪些国家""跑过几场马拉松"）的回答质量可能下降。

**缓解：**
- 结构化事实索引已经预计算了这些答案（旅行目的地列表、马拉松记录、阅读统计），直接在 prompt 中以高信噪比呈现
- 主模型的 prompt 中加入聚合指令：对于"哪些/几个"类问题，优先参考结构化事实索引
- 如果效果仍不理想，可在后续单独对这类查询做 prompt 分支，而非对所有查询都走证据分析

### 8.2 移除 AI 意图判定的风险

**风险：** 话题切换时可能误复用缓存。

**缓解：**
- 提高 token 重叠阈值到 60%（当前 40%）
- 新实体词检测逻辑保留
- 误复用最多导致"用上一轮的搜索结果"，而非完全错误——主模型仍会基于新问题重新组织答案

### 8.3 向量检索的引入风险

**风险：** Embedding JSON 文件大小、运行时内存占用。

**缓解：**
- 400 篇文章 × 平均 5 chunks × 1536 维 × 4 bytes ≈ 12MB，完全可以内存加载
- 可用 `float16` 或量化到 8-bit 进一步压缩到 ~6MB
- 推文不分 chunk，1000 条 × 1536 维 ≈ 6MB
- 总计 ~18MB 内存占用，对 Node.js 进程无压力

### 8.4 渐进式迁移

每个 Phase 独立可部署、可回退：
- Phase 1（流程瘦身）可通过环境变量开关控制
- Phase 2（检索升级）可与旧检索并行运行，A/B 对比
- Phase 3-4（Prompt/人格）纯 prompt 层变更，随时可切回

---

## 10. 效果度量

### 9.1 定量指标

| 指标 | 当前基线 | Phase 1 目标 | Phase 2 目标 |
|------|---------|------------|------------|
| 端到端延迟（P50） | ~8s | ~4s | ~3s |
| 端到端延迟（P99） | ~18s | ~6s | ~5s |
| LLM 调用次数 | 5 | 2 | 2 |
| 每次请求 token 成本 | ~4000 out | ~2200 out | ~2200 out |
| Prompt 大小 | ~10000 tok | ~6000 tok | ~5000 tok |

### 9.2 定性评估

准备 20 个测试问题覆盖以下类别，在每个 Phase 后进行对比评估：

| 类别 | 示例问题 |
|------|---------|
| 事实查询 | "你用什么技术栈？" |
| 聚合统计 | "你去过哪些国家？" |
| 时间线 | "你最近在做什么？" |
| 推荐 | "推荐几篇关于旅行的文章" |
| 深入追问 | "你在日本最喜欢哪个城市？为什么？" |
| 边界测试 | "你对 XX 政治事件怎么看？"（应拒绝） |
| 人格测试 | "介绍一下你自己" |
| 多轮对话 | "你跑过马拉松吗？" → "最近一场是什么时候？" |

评估维度：
1. **事实准确性**：回答中的事实是否与博客/推文内容一致（0-5 分）
2. **引用质量**：是否标注了来源，来源是否正确（0-5 分）
3. **人格一致性**：回答风格是否像博主本人（0-5 分）
4. **优雅降级**：不知道时是否合理处理（0-5 分）

---

## 11. 实施顺序

```
Day 0（立即）: Phase 0（数据治理）
├── 降级 structuredFacts 的 prompt 权重
├── 人工审核并修正 structured-facts-aggregated.json
├── 移除已确认的错误条目
└── 为剩余条目标注 provenance

Week 1:
├── Day 1-2: Phase 1（流程瘦身）
│   ├── 移除证据分析层
│   ├── 移除回答修复层
│   ├── 简化关键词提取 → 查询重写
│   └── 简化会话缓存判定
│
├── Day 3: Phase 3（Prompt 重构）
│   ├── 精简系统提示词
│   ├── 加入内联引用指令
│   ├── Provenance 分层标注
│   └── 精简个人档案
│
└── Day 4-5: Phase 6（评测体系） + 测试
    ├── 建立 20 题 Gold Set
    ├── 编写评测脚本
    ├── 基线评测（Phase 1 前后对比）
    └── Prompt 微调

Week 2:
├── Day 1-3: Phase 2（检索升级）
│   ├── 构建 Embedding 脚本
│   ├── Chunk 分段逻辑
│   ├── 混合检索实现
│   └── RRF 排序
│
├── Day 4: Phase 4（人格还原）
│   ├── 语言风格描述
│   └── Few-shot 样例
│
└── Day 5: Phase 5（工程治理）
    ├── 拆分 route.ts
    └── 配置收敛
```

---

## 附录：关键文件变更清单

| 文件 | Phase | 变更类型 |
|------|-------|---------|
| `src/app/api/chat/route.ts` | 1, 5 | 大幅重构、拆分 |
| `src/lib/ai/evidence-analysis.ts` | 1 | 删除大部分代码 |
| `src/lib/ai/search-query.ts` | 1 | 简化 |
| `src/lib/chat-prompts/core-rules.ts` | 3 | 重写 |
| `src/lib/chat-prompts/runtime-context.ts` | 3 | 重写 |
| `src/lib/chat-prompts/intent-ranking.ts` | 2 | 删除或大幅简化 |
| `scripts/build-embeddings.mjs` | 2 | 新增 |
| `scripts/build-author-context.mjs` | 4 | 新增风格样例提取 |
| `data/embeddings.json` | 2 | 新增 |
| `src/lib/ai/chat-config.ts` | 5 | 新增 |
