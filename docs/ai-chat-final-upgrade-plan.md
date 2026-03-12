# AI 数字分身系统 — 综合诊断与升级方案

> 综合来源：OpenAI 专家 Review + V3 优化方案 + Claude 独立 Review
> 版本：Final（2026-03-07）

---

## 一、三方诊断共识

两位独立专家（一位来自 OpenAI，一位 Claude）在未互相参照的情况下，对以下问题达成了完全一致的判断：

### 共识 1：structuredFacts 数据污染是当前最严重的问题（P0）

| 具体错误 | 影响 |
|---------|------|
| 旅行国家出现"中国"（当作海外目的地） | "去过哪些国家"回答失真 |
| "印度"的证据来自尼泊尔签证攻略 | 旅行记录错误 |
| `book_count: 100` 来源是东极岛旅行文章 | "读过多少书"数据荒谬 |
| 马拉松赛事重复 + 回顾文章混入 | "跑过几场"统计不准 |

**两方一致结论：** 这些错误数据在 prompt 中被标注"优先参考本节"，导致主模型优先相信错误聚合，而非回退到原始文章——**这是数据失真的首要根源，必须立即止血。**

### 共识 2：纯关键词检索已到瓶颈，应升级为 Hybrid Retrieval

两方都指出：
- `search-core` 本质是 substring 匹配 + 人工加权打分
- 为弥补语义不足，业务层已堆积了大量补丁：keyword extraction、semantic fallback rules、anchor terms、travel rerank
- 这些补丁只会越来越复杂，无法根治"搜不到"问题
- 应引入 embedding 向量检索 + 现有 lexical 搜索组成 hybrid retrieval

### 共识 3：需要 Fact Registry（事实注册表）

两方都提出了几乎相同的方案：
- 将 travel / race / reading / project 等聚合事实从"prompt 文本"升级为**可验证的结构化数据**
- 每条 fact 必须标注 provenance（来源类型）和 confidence（置信度）
- 只有经过校验的条目才能以高优先级进入 prompt

### 共识 4：需要 Voice Profile（语言风格画像）

两方都指出当前"像本人"的能力主要来自简介和规则，不是来自真实语料的风格蒸馏。都建议：
- 从第一人称博客/推文中提取表达习惯
- 建立 `voice-profile.json` 供 writer 参考
- 按问题类型切换语气模式（技术 vs 生活 vs 推荐）

### 共识 5：需要评测体系

两方都强调没有 gold set + 自动评测，任何优化都是"靠体感"，无法形成闭环。

### 共识 6：Workflow > Swarm

两方都认为当前 341 篇文章 + 799 条推文的数据规模不需要自治式多 agent swarm，而是更适合**固定职责的 workflow pipeline**，每步输入输出明确、可单测、可 trace。

---

## 二、关键分歧与决策

### 分歧 1：证据分析层——保留升级 vs 直接移除

| 维度 | OpenAI 专家方案 | Claude 方案 |
|------|---------------|------------|
| **立场** | 保留并升级为 answer brief + verifier | 直接移除，信任主模型 |
| **理由** | 事实层和表达层分离是正确方向；answer brief 可做 claim-to-citation 约束 | 当前实现引入 7-10s 延迟 + 300 行修复代码；主模型足以直接处理 10-15 条上下文 |
| **风险** | 增加系统复杂度和延迟 | 聚合类问题回答质量可能下降 |

**综合决策：分阶段处理**

1. **Phase 1（立即）：移除当前证据分析实现。** 当前实现的 400 token 输出限制 + 3 层 JSON 修复是根本性的工程缺陷，修补成本高于重建。先移除，用内联引用指令替代。
2. **Phase 3（检索升级后）：按需引入轻量 answer brief。** 在 hybrid retrieval 就位后，如果聚合类问题仍需中间分析，可重新引入一个更简洁的 answer brief 步骤——但不再使用 JSON 输出 + 修复的模式，而是让模型直接输出结构化 markdown。
3. **Verifier 作为独立可选步骤。** 先用规则校验（URL allowlist、数字回溯），再按需加模型校验。

**为什么这样决策：**
- OpenAI 专家说对了方向（事实层 vs 表达层分离），但当前实现已经偏离了这个方向
- Claude 说对了当下（先做减法，消除工程债务），但长期需要重建约束机制
- 关键洞察：**检索质量提升后，证据分析的需求会大幅降低**——如果 chunk 级检索已经给出了精确的相关段落，主模型不需要额外的"中间分析"就能直接引用

### 分歧 2：LLM 调用次数——2 次 vs 多步 workflow

| 方案 | OpenAI 专家 | Claude |
|------|-----------|--------|
| LLM 调用 | Planner + Evidence Synthesizer + Persona Writer + Verifier（4 步） | 查询重写 + 主对话（2 步） |
| 优势 | 职责清晰、可单测 | 延迟低、成本低 |
| 风险 | 延迟可能不降反升 | 约束不够强 |

**综合决策：渐进式增加步骤**

1. **起步阶段（Phase 0-1）：2 次 LLM 调用。** 查询重写 + 主对话。最大化降低延迟，先验证基础链路。
2. **增强阶段（Phase 3）：按需加到 3 次。** 如果评测数据显示聚合类问题质量不够，引入轻量 answer brief（3 步）。
3. **成熟阶段（Phase 4+）：按需加到 4 次。** 如果 unsupported claim rate 仍然过高，引入规则 + 模型混合 verifier。

**每次增加步骤都必须有评测数据支撑，不做"预防性增加"。**

### 分歧 3：Chunk 设计细节

| 方面 | OpenAI 专家 | Claude |
|------|-----------|--------|
| Contextual Header | 强调每个 chunk 需要带足够的上下文前缀（引用 Anthropic contextual retrieval） | 保留标题前缀 |
| Chunk 粒度 | 摘要 chunk + key points chunk + 正文 chunk（多种视图） | 按段落合并到 200-400 字 |

**综合决策：采用 OpenAI 方案的 contextual header + Claude 方案的简单分段**

```
Chunk 格式：
[文章标题] [日期] [分类]
这个 chunk 的原始文本内容，200-400 字...
```

不做多种视图（摘要 chunk / key points chunk / 正文 chunk 分开），因为这会导致索引膨胀。但每个 chunk 必须带足够的上下文头，让孤立的 chunk 也能被正确理解。

---

## 三、综合升级方案

### 整体架构

```
                    ┌────────────────┐
                    │   用户消息      │
                    └───────┬────────┘
                            │
                    ┌───────▼────────┐
                    │ 速率限制 + 校验  │
                    └───────┬────────┘
                            │
              ┌─────────────▼─────────────┐
              │  Session Resolver          │  ← 纯规则
              │  (复用判定 + 会话状态)       │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  Query Rewriter            │  ← LLM #1 (3s)
              │  (intent + 搜索词 + 复杂度)  │
              └─────────────┬─────────────┘
                            │
       ┌────────────────────▼─────────────────────┐
       │  Hybrid Retrieval                         │
       │  ┌──────────┐ ┌──────────┐ ┌───────────┐ │
       │  │ Posts     │ │ Tweets   │ │ Projects  │ │  ← 多源
       │  │ (chunks)  │ │          │ │ + Facts   │ │
       │  └──────┬───┘ └────┬─────┘ └─────┬─────┘ │
       │         └──────────┼──────────────┘       │
       │              ┌─────▼──────┐               │
       │              │ RRF Merge  │               │
       │              └────────────┘               │
       └────────────────────┬─────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  Prompt Assembly            │
              │  身份 + 规则 + 档案          │
              │  + Fact Registry            │  ← 4000-5000 tokens
              │  + Retrieved Chunks         │
              │  + Voice Profile            │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  Persona Writer             │  ← LLM #2
              │  (带内联引用的流式回答)       │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  Rule-based Verifier        │  ← 无 LLM
              │  (URL allowlist / 数字回溯)  │
              └─────────────┬─────────────┘
                            │
                    ┌───────▼────────┐
                    │  Telegram 通知  │
                    └────────────────┘

LLM 调用：2 次（起步），按需增至 3-4 次
预计延迟：3-5s
Prompt 大小：4000-5000 tokens
```

### 数据层设计（综合两方最优方案）

```
data/
├── author-context.json          # 现有，精简后保留
├── fact-registry.json           # 新增：可验证事实表
├── voice-profile.json           # 新增：语言风格画像
├── source-docs/                 # 新增：canonical source docs
│   ├── posts.jsonl
│   ├── tweets.jsonl
│   └── projects.jsonl
├── embeddings/                  # 新增：向量索引
│   ├── chunks.jsonl             # chunk 文本 + 元数据
│   └── vectors.bin              # 预计算 embedding
├── eval/                        # 新增：评测体系
│   ├── gold-set.json
│   ├── results.json
│   └── traces/
└── structured-facts-*.json      # 降级为辅助索引
```

#### 知识分层（来自 OpenAI 方案，Claude 补充了具体 prompt 标注方式）

| 层级 | 来源 | 信任度 | Prompt 中的标注方式 |
|------|------|--------|-------------------|
| L1: `authored_public` | 原始博客文章、推文原文 | 最高 | 可直接引用，标注「据《文章》」 |
| L2: `curated_public` | GitHub 简历自述、社交链接 | 高 | 可引用，标注「据简历记录」 |
| L3: `validated_derived` | Fact Registry 中 confidence=verified 的条目 | 中高 | 可引用，标注「据博客记录」 |
| L4: `unvalidated_derived` | structuredFacts 中未校验条目 | 低 | 仅作辅助，标注「约/至少」 |
| L5: `style_only` | Voice Profile | 不涉及事实 | 只影响表达方式，不输出为事实 |

---

## 四、实施路线图

### Phase 0：止血（Day 0，立即执行）

这一步两位专家完全一致，没有分歧。

| 动作 | 预期效果 |
|------|---------|
| 1. `runtime-context.ts` 中将 structuredFacts 从"优先参考"改为"辅助参考，以原文为准" | 立即降低错误事实的传递权重 |
| 2. 人工审核 `structured-facts-aggregated.json`，移除已确认的错误条目 | 消除已知脏数据 |
| 3. 为剩余条目标注 `provenance` 和 `confidence` | 为后续自动化校验建立基础 |
| 4. 将 GitHub / 项目信息纳入可检索源（不再只是静态 top 3） | 项目类问题召回立即改善 |

### Phase 1：流程瘦身（Day 1-2）

| 动作 | 两方态度 | 决策 |
|------|---------|------|
| 移除证据分析中间层 | Claude 强烈建议；OpenAI 建议升级而非移除 | **先移除**，Phase 3 按需重建 |
| 移除回答修复层 | Claude 建议移除；OpenAI 未提及 | **移除**，提高 maxOutputTokens 替代 |
| 简化关键词提取为查询重写 | 两方都支持简化 | **简化** |
| 移除 AI 意图复用判定 | Claude 建议纯规则；OpenAI 建议用 session state | **先用纯规则**，Phase 3 引入结构化 session state |

### Phase 2：数据层建设（Day 3-5）

综合两方方案，这一步的核心产出：

1. **Source Docs 生成脚本**（`scripts/build-source-docs.mjs`）
   - 将 posts / tweets / projects 统一为 canonical 格式
   - 每条记录包含 `source_id`、`source_type`、`text`、`summary`、`tags`、`date`
   - 这是 OpenAI 方案的核心建议，Claude 方案中隐含在 chunk 策略中

2. **Fact Registry 生成脚本**（`scripts/build-fact-registry.mjs`）
   - 候选提取 → canonicalize → 验证 三段式处理
   - 替代当前 Gemini 直接灌入的不可靠管道

3. **Voice Profile 生成脚本**（`scripts/build-voice-profile.mjs`）
   - 从高互动推文和博客口语化段落中提取表达模式
   - 输出 `data/voice-profile.json`

### Phase 3：Hybrid Retrieval（Week 2, Day 1-3）

两方完全一致的方案：

1. 为所有 source docs 生成 embedding（`scripts/build-embeddings.mjs`）
2. Chunk 分段（按段落合并到 200-400 字，带 contextual header）
3. 运行时 hybrid search：向量检索 + 关键词检索 → RRF 合并
4. **引入后可删除的补丁代码**：
   - `SEMANTIC_FALLBACK_RULES`
   - Travel re-ranking 正/负面词表
   - Anchor term 筛选
   - `intent-ranking.ts` 启发式规则
   - 多轮搜索 + 合并逻辑

### Phase 4：Prompt 重构 + 人格还原（Week 2, Day 4）

| 组件 | Token 预算 | 内容 |
|------|-----------|------|
| 身份设定 + 语言风格 | 300 | 身份标签 + voice profile 摘要 |
| 核心规则 | 300 | 5 条精简规则 + provenance 分层说明 |
| 个人档案 | 500 | 精简版简历 + 技能标签 + 社交链接 |
| Fact Registry 摘要 | 400 | 仅 confidence=verified 的条目 |
| 检索结果 | 2500 | 8-10 个 chunk（带 contextual header） |
| Few-shot 样例 | 300 | 2-3 个真实对话样例 |
| **合计** | **~4300** | |

### Phase 5：评测体系（持续）

综合两方建议，取更高标准：

- **评测集规模**：OpenAI 建议 60 题，Claude 建议 20 题 → **起步 30 题，逐步扩展到 60 题**
- **评测维度**：
  - `retrieval_hit_rate`（检索命中率）
  - `citation_precision`（引用准确率）
  - `claim_support_rate`（有据可依率）
  - `unsupported_claim_rate`（幻觉率）
  - `abstention_quality`（"不知道"的处理质量）
  - `persona_similarity`（人格一致性）
  - `latency_p95`（延迟）
- **Trace 日志**：每轮记录完整 evidence chain，支持事后审查

### Phase 6（可选）：Answer Brief + Verifier

**只在以下条件满足时推进：**
1. Phase 3 hybrid retrieval 已上线
2. 评测数据显示聚合类问题的 `claim_support_rate` < 80%
3. `unsupported_claim_rate` > 10%

如果需要引入，方案为：
- Evidence Synthesizer 输出结构化 answer brief（JSON）
- Writer 只能引用 answer brief 中的 claims
- Rule-based verifier 检查 URL / 数字 / 实体
- 失败时自动降级为保守回答

---

## 五、两份报告中独有的好建议（不应遗漏）

### 来自 OpenAI 方案独有

1. **Session State 结构化**：不只缓存上轮搜索结果，而是记录 `last_intent`、`resolved_entities`、`open_questions`。这比 Claude 方案的纯 token 重叠判定更精确。
   → **推荐在 Phase 3 后引入。**

2. **Retrieval Router 按意图路由数据源**：自我介绍用 `stable_profile + flagship_posts`，最近动态用 `recent_tweets + latest_posts`，旅行类用 `fact_registry first, source docs second`。
   → **推荐在 Phase 3 hybrid retrieval 中实现。**

3. **Style Mode 切换**：按问题类型切换 `casual / technical / reflective / recommendation` 语气。
   → **推荐在 Phase 4 voice profile 中实现。**

4. **扩展模态**：YouTube / Bilibili 字幕转写、Unsplash 作品说明等作为未来数据源。
   → **Phase 6+ 长期规划，当前不优先。**

### 来自 Claude 方案独有

1. **RRF（Reciprocal Rank Fusion）合并公式**：具体给出了实现代码，比 OpenAI 方案的"引入 reranker"更落地。
   → **直接采用。**

2. **Embedding 体积分析**：计算了具体内存占用（~18MB），证明纯内存方案可行，不需要外部向量数据库。
   → **确认可行性。**

3. **渐进式迁移开关**：每个 Phase 通过环境变量控制，可独立部署、可回退。
   → **直接采用。**

4. **`classifyUpstreamError` 重复代码**：route.ts 中存在重复的错误分类逻辑。
   → **Phase 5 工程治理中修复。**

---

## 六、最终优先级排序

```
Priority │ 动作                                    │ 来源     │ 效果
─────────┼─────────────────────────────────────────┼──────────┼──────────────────
P0-立即  │ structuredFacts 降权 + 清洗错误数据        │ 两方共识 │ 立即止血
P0-立即  │ GitHub/项目纳入可检索源                    │ OpenAI   │ 项目类问题召回
P1-Week1 │ 移除证据分析层 + 回答修复层                │ Claude   │ 延迟 -10s
P1-Week1 │ 简化关键词提取为查询重写                   │ 两方共识 │ 减少代码复杂度
P1-Week1 │ 建立 Fact Registry + Source Docs          │ 两方共识 │ 事实层可靠化
P1-Week1 │ 建立最小评测集（30 题）                    │ 两方共识 │ 优化闭环
P2-Week2 │ Hybrid Retrieval（embedding + lexical）   │ 两方共识 │ 根治搜索问题
P2-Week2 │ Prompt 重构 + Provenance 分层             │ 两方共识 │ 减少 prompt 膨胀
P2-Week2 │ Voice Profile + Few-shot 样例             │ 两方共识 │ 人格还原
P3-按需  │ Answer Brief + Verifier                   │ OpenAI   │ 约束增强
P3-按需  │ 结构化 Session State                      │ OpenAI   │ 多轮质量
P4-长期  │ 扩展模态（YouTube/Bilibili 字幕）          │ OpenAI   │ 数据丰富度
```

---

## 七、参考资料

- Anthropic, *Building effective agents* — https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, *Introducing contextual retrieval* — https://www.anthropic.com/engineering/contextual-retrieval
- OpenAI Cookbook, *Eval driven system design* — https://cookbook.openai.com/examples/evaluation/eval_driven_system_design
- OpenAI Cookbook, *Graders for reinforcement fine-tuning* — https://cookbook.openai.com/examples/reinforcement_fine_tuning/graders
