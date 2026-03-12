# AI 对话数据流 Review 报告

## 目标

基于当前仓库里真实运行的代码和数据，对博客 AI 分身的离线数据构建链路与在线问答链路做一次重新审查，重点回答 4 个问题：

1. 现在到底是怎么工作的。
2. 哪些地方已经做对了。
3. 哪些环节正在造成“证据检索复杂”和“数据失真”。
4. 在当前数据量下，最值得优先升级什么。

审查时间：2026-03-07

## 审查范围

- 聊天入口：[src/app/api/chat/route.ts](../src/app/api/chat/route.ts)
- 证据分析：[src/lib/ai/evidence-analysis.ts](../src/lib/ai/evidence-analysis.ts)
- Prompt 组装：
  - [src/lib/ai/chat-prompt.ts](../src/lib/ai/chat-prompt.ts)
  - [src/lib/chat-prompts/runtime-context.ts](../src/lib/chat-prompts/runtime-context.ts)
  - [src/lib/chat-prompts/core-rules.ts](../src/lib/chat-prompts/core-rules.ts)
- 搜索实现：
  - [packages/search-core/src/index.ts](../packages/search-core/src/index.ts)
  - [src/lib/content/posts.ts](../src/lib/content/posts.ts)
  - [src/lib/content/tweets.ts](../src/lib/content/tweets.ts)
- 离线数据构建：
  - [scripts/build-author-context.mjs](../scripts/build-author-context.mjs)
  - [scripts/build-structured-facts-gemini.mjs](../scripts/build-structured-facts-gemini.mjs)
  - [scripts/generate-profile-report.mjs](../scripts/generate-profile-report.mjs)
- 当前数据产物：
  - [data/author-context.json](../data/author-context.json)
  - [data/structured-facts-aggregated.json](../data/structured-facts-aggregated.json)
  - [data/structured-facts-gemini.json](../data/structured-facts-gemini.json)

## 先说结论

当前系统已经不是“一个 prompt 直接问模型”的初级版本了，而是一个明确的轻量 workflow：

- 离线侧已经有统一作者上下文、结构化事实提取、多模型画像报告。
- 在线侧已经有 `sessionId`、关键词提取、检索复用判定、证据分析、流式回答、尾句修复和可观测日志。

但当前最严重的问题不是“主回答模型不够像你”，而是：

**错误或未校验的结构化事实，已经在离线阶段进入了作者上下文，并在聊天 prompt 里被赋予了过高权重。**

换句话说，当前系统最大风险不是“不会找”，而是“找错了以后还被当成准事实继续传递”。

## 当前真实链路

### 1. 离线数据链路

1. 博客文章：
   - 从 `content/posts/*.md` 读取正文与 frontmatter。
   - 结合 `data/ai-summaries.json` 生成文章摘要与 key points。
   - 产出博客摘要池，并写入 `data/sources/blog-digest.json`。
2. 推文：
   - 优先读取 `data/author-tweets-cache.json`。
   - 回退到 `data/tweets-cache.json`。
3. GitHub / 履历：
   - 从 `foru17/foru17` 的 README / RESUME 拉取并解析。
   - 产出 `data/github-resume.json`。
4. 结构化事实：
   - 优先读取 `data/structured-facts-aggregated.json`。
   - 如果该文件存在，直接作为 `structuredFacts` 进入 `author-context.json`。
5. 统一上下文：
   - [scripts/build-author-context.mjs](../scripts/build-author-context.mjs) 将 profile / posts / tweets / projects / stableFacts / timelineFacts / structuredFacts 聚合为 `data/author-context.json`。
6. About 页面画像：
   - [scripts/generate-profile-report.mjs](../scripts/generate-profile-report.mjs) 读取 `author-context.json`，让不同模型生成第三方视角报告。

### 2. 在线问答链路

1. 前端为每个聊天实例生成 `x-session-id`。
2. 后端按 `sessionId` 维护短期检索上下文缓存。
3. 用户问题进入后：
   - 本地 query 归一化。
   - 判断是否复用上轮检索上下文。
   - 如不复用，则并行做：
     - 本地搜索 posts / tweets
     - AI 关键词提取
4. 基于 posts / tweets 结果，按需调用 `analyzeRetrievedEvidence()` 做一次结构化证据分析。
5. 将“作者基础信息 + 相关文章 + 相关动态 + 证据分析摘要”拼成 system prompt。
6. 主模型流式生成回答。
7. 如结尾疑似被截断，再做一次尾句修复。

## 已经做对的部分

### 1. `sessionId` 已经替代 `IP + UA`

这一点相较更早一版实现是明显进步。当前缓存 key 已优先使用 `x-session-id`，避免了跨读者串线这个高风险问题。

### 2. Prompt 默认值已经切到 `v2`

当前 [src/lib/chat-prompts/config.ts](../src/lib/chat-prompts/config.ts) 默认值已经是 `v2`，说明分层 prompt 体系已经真正进入主路径，而不是只停留在文档。

### 3. `timelineFacts.latestTweets` 现在确实按时间排序

当前 [scripts/build-author-context.mjs](../scripts/build-author-context.mjs) 的 `latestTweets` 是从全量 tweets 中按日期倒序取最近项，不再是早期那种“先按高互动截断，再伪装成近期动态”的设计。

### 4. 证据分析层的方向是正确的

[src/lib/ai/evidence-analysis.ts](../src/lib/ai/evidence-analysis.ts) 做了三件正确的事：

- 限制模型只能基于本轮 evidence pack 输出。
- 让中间层先产出结构化结果，而不是直接写最终答案。
- 做了 JSON 修复 / salvage / 超时兜底。

这说明你的系统已经具备“事实层”和“表达层”分离的雏形。

### 5. 当前数据规模很适合做更严格的 workflow

当前 `author-context.json` 中大约是：

- 341 篇文章
- 799 条推文
- 3 个项目条目

这不是一个需要“自治 swarm”才能处理的规模，反而非常适合做：

- 更严格的事实分层
- 更稳的 hybrid retrieval
- 更强的引用校验
- 更快的回归评测

## 关键问题

### P0. `structuredFacts` 已经混入明显错误事实，而且聊天 prompt 还在优先使用它

这是当前最严重的问题。

#### 代码路径

- `structured-facts-aggregated.json` 一旦存在，就会在 [scripts/build-author-context.mjs](../scripts/build-author-context.mjs) 中直接进入 `structuredFacts`
- [src/lib/chat-prompts/runtime-context.ts](../src/lib/chat-prompts/runtime-context.ts) 又把这部分写入聊天 prompt，并明确写了“优先参考本节”

#### 当前数据里的实际错误

从 [data/structured-facts-aggregated.json](../data/structured-facts-aggregated.json) 可以直接看到多类错误：

- 旅行国家里出现了“中国”
- 旅行国家里出现了“印度”，证据却来自“尼泊尔签证攻略”
- 阅读总数 `100` 的来源居然是一篇东极岛旅行文章
- 马拉松赛事存在多条重复、年份级日期和回顾文章混入
- `2014上海国际马拉松` 的结果甚至出现了“未提及”

对应的逐文章原始提取结果也能在 [data/structured-facts-gemini.json](../data/structured-facts-gemini.json) 里看到，例如：

- `to-the-east-end-of-china-dongji-island-journey-log` 被抽出了 `book_count: 100`
- `zhuhai-marathon-2023` 被抽出了 2014-2018 多场历史马拉松结果
- `shenzhen-marathon-2016` 被错误标成 `is_travel_post: true`

#### 影响

这会直接造成三类回答失真：

- “去过哪些国家 / 去过几次”
- “跑过哪些马拉松 / 最好成绩是什么”
- “读过多少书 / 最近书单”

而且因为 prompt 明确要求优先参考这部分，主模型会更愿意相信这些错误聚合，而不是谨慎回到原文。

#### 结论

**在 `structuredFacts` 进入聊天前，必须加 provenance 和验证层；在验证完成前，这部分不应该再被当成高优先级事实源。**

### P0. 聊天检索主链路没有项目索引，也没有单独的事实索引

当前在线检索只搜两类数据：

- 博客文章
- 推文

代码上可以看到 [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) 只构建了 `searchRelatedArticles()` 和 `searchRelatedTweets()` 两条路径；GitHub / 项目事实没有 query-time retrieval，只是被静态塞进 author bio。

#### 影响

这会造成：

- 项目类问题召回不完整
- 技术栈 / 履历 / 开源项目回答过度依赖“静态 top 3 项目”
- “你做过 Shopify app 吗”“你有哪些 Raycast 插件”“你在哪家公司做过什么”这类问题缺少专门 evidence pack

#### 结论

**GitHub / 履历应该从“静态背景信息”升级为“可检索事实源”。**

### P0. 当前搜索核心仍然是稀疏 lexical scoring，不是 hybrid retrieval

[packages/search-core/src/index.ts](../packages/search-core/src/index.ts) 目前本质是：

- 拼接 title / excerpt / content / categories / keyPoints
- 做 substring 包含匹配
- 人工加权打分

这套方法对“实体词明确”的问题还可以，但对下面几类问题天然弱：

- 同义改写
- 意图较隐晦的问法
- 需要多条弱信号聚合的问题
- 需要跨 source 拼接的项目/经历问题

#### 影响

当前你为了补 lexical search 的短板，已经在 route 里加了很多：

- keyword extraction
- semantic fallback rules
- anchor terms
- travel rerank

这些补丁是有用的，但会越来越复杂，而且会越来越像“修一堆 query 特判”。

#### 结论

**当前系统已经到了该上 hybrid retrieval 的阶段，不然 retrieval complexity 只会继续堆在业务逻辑里。**

### P1. 证据分析结果目前只是 prompt 里的文字摘要，还不是强约束的 answer brief

当前 [src/lib/ai/evidence-analysis.ts](../src/lib/ai/evidence-analysis.ts) 可以产出结构化 JSON，但在 [src/app/api/chat/route.ts](../src/app/api/chat/route.ts) 里，这份结果最终被转换成一段 Markdown 文本追加回 system prompt。

这意味着：

- writer 仍然可以偏离结构化 claims
- 最终输出没有 claim-to-citation 的强约束
- 无法做真正的 unsupported-claim check

#### 结论

**现在的 evidence analysis 更像“加强版提示词”，还不是“强约束的中间状态”。**

### P1. 缺少 provenance 分层，模型无法区分“原始事实”“派生事实”“风格总结”

当前 `author-context.json` 里混合了多种性质完全不同的数据：

- 原始内容摘要：posts / tweets
- 自述型公开资料：GitHub resume / profile / highlights
- 派生统计：stableFacts / timelineFacts
- 模型抽取结果：structuredFacts

在聊天 prompt 中，这些信息大多以同样的语气出现，模型很难正确理解它们的置信度差异。

#### 影响

会出现两种典型偏差：

1. 模型把“模型抽取的聚合结果”当成和“原始文章”同等级的事实。
2. 模型把“自我介绍里的长期标签”当成对每个具体问题都适用的强证据。

#### 结论

**必须把知识分成不同信任层级，并在数据结构里显式写出 provenance / confidence。**

### P1. 缺少真正的问答质量评测集

当前仓库已有测试主要集中在：

- query normalization
- prompt intent ranking

但没有覆盖最关键的问题：

- 回答是否命中正确 source
- 是否有 unsupported claims
- 对数量 / 时间 /履历问题是否答对
- 是否像本人

#### 影响

现在任何改动都很难形成稳定闭环：

- 改 prompt，靠主观感觉
- 改检索，靠几轮手测
- 换模型，也缺少可比较指标

#### 结论

**没有 gold set 和 trace-based eval，后面的架构升级很难稳。**

### P2. 人格还主要来自“简介”和“规则”，不是来自真实语料风格蒸馏

当前“像你本人”的来源主要是：

- core identity
- author bio
- 文章与推文摘要
- writer prompt 的第一人称要求

这能让回答“知道你是谁”，但还不足以让回答“真的像你怎么说话”。

缺的不是更多事实，而是更稳定的 voice profile，例如：

- 常用表达方式
- 句式节奏
- 技术话题和生活话题切换时的语气
- 是否会自嘲、会不会用 emoji、会不会给结论后补个人态度

#### 结论

**要提升“个人特性还原度”，应新增 voice profile，而不是继续把事实 prompt 写得更长。**

### P2. About 页多模型画像和聊天链路仍然是两套系统

当前 `/about` 的多模型画像其实很有价值，但在线聊天并没有利用“多模型共识”这件事。

值得利用的不是第三方画像里的具体事实，而是：

- 多模型共同稳定识别出的长期标签
- 多模型共同提到的表达气质
- 多模型都引用到的代表作

#### 结论

**About 页报告更适合反哺“persona/voice profile”，不适合直接反哺事实层。**

## 对之前结论的修正

相较 2026-03-06 那轮中间 review，这次基于最新代码需要明确修正 3 点：

1. `sessionId` 问题已经修了，不再是当前主风险。
2. prompt 默认版本已经是 `v2`，不再是当前主风险。
3. `latestTweets` 现在按时间排序，已经比早期方案更合理。

因此当前最高优先级应从“缓存串线 / prompt 未生效”切换为：

- 结构化事实污染
- 检索源分层不完整
- retrieval 与 answer brief 之间缺少强约束

## 总体判断

### 现在最应该做的，不是继续堆 prompt

更长的 prompt 只能暂时掩盖问题，无法真正解决：

- 错误事实进入系统
- retrieval 只靠 lexical hit
- writer 阶段没有硬约束

### 现在也不应该直接上自治 agent swarm

你这个场景的数据量和任务边界非常清晰，更适合：

- 固定职责 workflow
- 明确输入输出 JSON
- 可追踪 trace
- 可回放评测

也就是：

- planner
- retrieval router
- evidence synthesizer
- persona writer
- verifier

而不是“让一群 agent 自己商量怎么回答”。

## 建议优先级

1. 先把未校验 `structuredFacts` 降级为辅助索引，停止继续污染主回答。
2. 把 GitHub / 项目事实正式纳入 query-time retrieval。
3. 把 evidence analysis 升级成真正的 `answer_brief`，不要只回写成 prompt 文本。
4. 为 posts / tweets / projects 建立 hybrid retrieval。
5. 增加 fact registry 和 voice profile。
6. 建立最小评测集，开始做 trace-based regression。

## 参考的业界实践

- Anthropic, *Building effective agents*  
  https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, *Introducing contextual retrieval*  
  https://www.anthropic.com/engineering/contextual-retrieval
- OpenAI Cookbook, *Eval driven system design*  
  https://cookbook.openai.com/examples/evaluation/eval_driven_system_design
- OpenAI Cookbook, *Graders for reinforcement fine-tuning / trace grading ideas*  
  https://cookbook.openai.com/examples/reinforcement_fine_tuning/graders

## 状态

- [x] 现状链路重新审查完成
- [x] 关键问题分级完成
- [x] 升级方向确认：workflow over swarm / fact-first / eval-first
- [ ] 进入架构与流程升级实施
