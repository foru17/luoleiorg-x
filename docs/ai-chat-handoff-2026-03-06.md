# AI Chat / 作者画像工作交接（2026-03-06）

## 目标

把今天围绕博客 AI 对话与作者画像能力的分析、代码改动、调试结论和未解决问题整理成一份可继续接手的交接文档。

这份文档的重点不是重复产品愿景，而是回答 4 个实际问题：

1. 今天到底做了什么。
2. 代码现在改到了哪里。
3. 为什么线上回答还是不稳定。
4. 下一位专家应该先看什么、先解决什么。

## 背景共识

今天已经明确了几条产品口径，后续实现需要继续遵守：

- 博客、X、简历、GitHub 中已经公开发布的信息，都视为可引用的公开资料，不做“隐私拦截”。
- 主要知识源是博客和 X；GitHub / 简历是补充事实源，不承担主叙事。
- 优先目标不是“更保守”，而是“更真实、更自然、更有证据”。
- 不希望靠业务层不断 hardcode “去过几次 / 跑过几场 / 读过几本” 这类统计规则补洞。
- 更偏向在检索后再让 AI 做一次专门的 evidence analysis，再由最终回答模型自然表达。

## 今天完成的工作

### 1. 完成当前链路 review，并沉淀两份基础文档

已新增：

- `docs/ai-chat-review-report.md`
- `docs/ai-chat-v3-optimization.md`

这两份文档分别覆盖：

- 当前作者画像与聊天链路的 review 结论
- 面向 workflow / 多 agent 方向的 V3 优化方案

其中已经明确：

- 当前问题的核心不在于“prompt 再写长一点”
- 应该把链路拆成 planner / retrieval / evidence analysis / writer / verifier 这类固定职责步骤
- query-time evidence analysis 是这次最关键的补强点

### 2. 聊天链路中接入了“检索后二次证据分析”

已新增文件：

- `src/lib/ai/evidence-analysis.ts`

主要能力：

- 把当前检索到的博客 / X 内容整理成 evidence pack
- 让 AI 只做“证据归纳”，而不是直接写最终回答
- 输出结构化结果：
  - `questionType`
  - `directAnswer`
  - `entities`
  - `keyFindings`
  - `uncertainties`
  - `recommendedUrls`
- 提供 JSON 修复、截断 JSON salvage、提示词压缩预算等兜底逻辑
- 对“旅行盘点类问题”做了更小的 evidence budget，降低 prompt 体积

### 3. 主聊天 API 已串起 evidence-analysis 工作流

已修改：

- `src/app/api/chat/route.ts`

当前主链路已经变成：

1. 接收消息
2. 关键词提取
3. 检索博客 / 推文
4. 调用 `analyzeRetrievedEvidence`
5. 如果分析成功，把 `## 检索证据分析摘要` 拼到最终 system prompt
6. 再让主回答模型自然写回答

也就是说，现在已经不是单纯“检索结果直接喂给主回答模型”。

### 4. 增加了更细的调试日志

已在聊天链路中加入按 `requestId` 归档的 debug 日志，覆盖：

- `request.received`
- `keyword-extraction.result`
- `search.summary`
- `evidence-analysis.result`
- `prompt.summary`
- `chat-model.finish`
- `request.completed`

当前日志可以看到：

- 关键词提取是否 fallback
- evidence analysis 是否真的成功
- evidence analysis 的 `parseStatus`
- 原始返回文本长度、部分 `rawText`
- 最终 prompt 是否包含 evidence-analysis section

### 5. 补充了 Telegram 通知里的模型与耗时信息

已修改：

- `src/lib/telegram.ts`

新增可观测字段：

- `evidenceModel`
- `evidenceAnalysis` token usage
- `evidenceAnalysisMs`

后续更容易区分：

- 主回答慢
- 关键词提取慢
- 证据分析慢

### 6. 对旅行盘点类 query 做了检索层优化

已在 `src/app/api/chat/route.ts` 中加入：

- 旅行问题关键词提取 prompt 调整
- travel-aware rerank
- 对签证、攻略、机场、拒签等噪声词的负向处理

目标是减少“你去过哪些国家？”这类问题被签证攻略、机场事故、读后感文章带偏。

## 当前代码状态

### 已新增 / 重点变更文件

- `docs/ai-chat-review-report.md`
- `docs/ai-chat-v3-optimization.md`
- `src/lib/ai/evidence-analysis.ts`
- `src/app/api/chat/route.ts`
- `src/lib/telegram.ts`

### 当前工作区还有其他改动

当前仓库不是干净工作区。除了本次聊天相关改动外，还存在其他未提交修改，例如：

- `scripts/build-author-context.mjs`
- `scripts/generate-profile-report.mjs`
- `src/lib/chat-prompts/runtime-context.ts`
- `src/lib/chat-prompts/legacy-v1.ts`
- `data/author-context.json`
- `data/sources/*.json`

下一位接手时不要直接整仓回滚，需要按文件甄别。

## 今天调试得到的关键结论

### 结论 1：现在的核心问题不是“最终回答模型不会答”，而是前置 evidence-analysis 经常没真正生效

从多轮日志看，最终回答经常退回旧行为，直接原因是：

- `evidence-analysis.result` 失败
- `prompt.summary.hasEvidenceAnalysisSection = false`

一旦 evidence-analysis 没成功，最终 system prompt 里就没有结构化证据摘要，主回答模型只能继续靠原始检索结果和旧 prompt 自己发挥，所以回答仍然会模糊。

### 结论 2：当前最主要的失败类型是超时 / abort，不只是 JSON 解析失败

真实日志里多次出现：

- `keyword-extraction.result`：`fallback_error`
- `evidence-analysis.result`：`request_error`
- 错误内容：`The operation was aborted`

这说明当前问题的主因不是“模型总是乱输出 JSON”，而是子步骤请求经常没在超时窗口内完成。

当前超时配置：

- 关键词提取：`3500ms`
- 证据分析：`12000ms`

在 kimi 路径下，这两个子步骤已经多次触发 abort。

### 结论 3：即使 evidence-analysis 返回了有价值内容，也会因为 JSON 不完整而丢失

日志里出现过：

- `parseStatus = invalid_json`

但 `rawText` 其实已经包含了很有用的半结构化结果，例如：

- `directAnswer`
- `entities`
- `count`
- `countMode`
- `evidenceUrls`

问题在于：

- 返回文本被包在 fenced json 里
- 或者被截断
- 或者 provider/SDK 不支持期望的 structured output 方式

结果是 analysis 明明“几乎成功”，但主链路仍把它当失败处理。

### 结论 4：关键词提取一旦超时，fallback query 会明显劣化检索质量

典型日志：

- 用户问题：`你去过哪些国家？`
- fallback query：`国家 去过`

这会导致检索结果混入明显噪声，例如：

- `国家大剧院...`
- `地心引力:我们、科技、国家、未来`

于是后面的 evidence-analysis 和主回答都会建立在错误召回上。

### 结论 5：旅行问题的“检索层脏召回”已经部分缓解，但还没有彻底解决

现在已经加了：

- travel-aware rerank
- 旅行 query 关键词提示
- 负向词处理

但从实际日志和回答看，仍然会出现：

- 把签证文章混入“去过哪些国家”
- 把地区 / 城市 / 国家混写
- 明明检索里已有美国、日本等证据，但最终回答仍退缩到只说菲律宾、韩国

说明问题不只在检索，也在 evidence-analysis 和最终 prompt 注入成功率。

### 结论 6：当前“不要和主回答模型共用”的建议，本质是流程隔离，不是单纯换模型

代码里当前配置是：

- `AI_KEYWORD_MODEL = process.env.AI_KEYWORD_MODEL || model`
- `AI_EVIDENCE_MODEL = process.env.AI_EVIDENCE_MODEL || keywordModel`

也就是说，如果环境变量没配：

- 主回答
- 关键词提取
- 证据分析

会全部共用同一个模型。

原本提出“不要和主回答模型共用”，意思是：

- 子步骤最好独立配置，避免共享一套慢请求路径或同一类长输出模型行为

但今天用户已经明确：

- `kimi` 是当前所有可用模型里最快的
- `kimi` 可以并发

因此下一步不应把“换子模型”当成唯一解，而应优先处理：

- prompt 体积
- 子步骤超时预算
- evidence pack 压缩
- 失败回退策略

## 当前仍未解决的问题

### P0. evidence-analysis 经常超时，导致主链路退回旧行为

现象：

- `request_error`
- `The operation was aborted`
- `hasEvidenceAnalysisSection = false`

影响：

- 结构化证据摘要没有进入最终 prompt
- 回答又回到“模糊、自我保守、靠主模型猜”的状态

当前状态：

- 已加日志
- 已加 prompt budget
- 但没有真正解决

### P0. keyword extraction 超时时，fallback query 仍然过弱

现象：

- `fallback_error`
- fallback query 退化成 `国家 去过`

影响：

- 召回被严重污染
- evidence-analysis 即使成功也会建立在错误 evidence 上

当前状态：

- 已发现问题
- 还没改 fallback 策略

### P0. 会话缓存仍然是 `IP + UA`，显式 `sessionId` 还没落地

当前实现仍是：

- `getSessionCacheKey(req, ip)` -> `ip + user-agent`

影响：

- 多个读者可能共享错误的 search context
- 尤其是“追问式对话”会有串线风险

这件事之前已经讨论过，也确认需要改成显式 `sessionId`，但今天没有实现完成。

### P1. evidence-analysis 的结构化输出兼容性仍不稳定

现象：

- kimi 路径下出现 AI SDK warning：
  - `responseFormat` 不支持
  - 仅 `structuredOutputs` 支持 JSON schema

当前处理：

- `EVIDENCE_ANALYSIS_STRUCTURED_OUTPUT` 改成 env gating，默认关闭
- 走 text-mode + repair/salvage

问题是：

- text-mode 成功率仍不够高
- structured output 在 kimi 上暂时不能作为主方案

### P1. 目前还看不到“失败请求的完整原始响应”，因为很多请求在 abort 前根本没正文

今天用户希望把 `evidence-analysis.result` 的完整返回打印出来。

当前状态是：

- 如果模型有返回正文，日志里已经能打印 `rawText`
- 但很多 case 是请求在超时前就被 abort，根本没有 `rawText`

所以现在不是“日志漏打”，而是“上游没有可打印内容”。

### P1. 复杂聚合问题仍缺少稳定的评测集

当前已经暴露出的典型问题：

- 去过哪些国家
- 去过日本几次
- 跑过几场马拉松
- 读过几本书

这些都属于：

- list
- count
- aggregate
- timeline/disambiguation

但目前没有固定 benchmark 去验证每次改动是否真的变好。

## 今天没做、但已经明确的方向

### 1. 不继续把业务逻辑硬编码下沉到代码里

今天已经明确否掉了这种路径：

- 针对“国家 / 日本几次 / 书 / 马拉松”分别写专门统计规则

原因：

- 泛化太差
- 问题类型会越来越多
- 代码会越来越脆

### 2. 继续坚持 query-time AI evidence analysis

今天形成的共识是：

1. 先尽量把博客 / 推文证据召回出来
2. 再用 AI 对 evidence pack 做一次专门归纳
3. 最后再让主回答模型自然表达

这是当前最符合产品目标的路线。

### 3. GitHub 仍然是补充源，不是主战场

今天也确认了：

- GitHub 仓库里除了简历和少量项目信息，内容密度不如博客和推文
- 因此下一步应继续优先优化 blog + X 链路

## 建议下一位专家优先处理的顺序

### 第一步：解决 evidence-analysis 超时，而不是先改最终 prompt

建议优先看：

- `src/lib/ai/evidence-analysis.ts`
- `src/app/api/chat/route.ts`

优先方向：

1. 继续缩小 evidence pack
2. 按问题类型动态裁剪 tweets / articles 数量
3. 考虑把 evidence analysis 拆成更小的两段
4. 明确哪些 case 可以直接跳过 tweets
5. 重新评估超时阈值与并发策略

### 第二步：修 keyword extraction 的 fallback 退化

至少需要避免：

- `国家 去过`

这类过于字面的 fallback query。

更合理的方向是：

- 根据用户原问题做本地语义 fallback
- 例如旅行聚合类直接退到 `旅行 游记 海外 出国`
- 不依赖模型成功才得到可用 query

### 第三步：落实显式 `sessionId`

需要把缓存键从：

- `IP + UA`

改成：

- 前端显式传入的 `sessionId`

这件事和准确性直接相关，优先级高。

### 第四步：建立一组固定评测题

建议至少覆盖：

- list
- count
- timeline
- recent update
- project intro
- no-answer / insufficient-evidence

否则后面每次优化都只能靠体感。

## 当前验证状态

- `pnpm typecheck`：已于 2026-03-06 本地执行，通过
- `pnpm lint`：本轮未重新执行
- `pnpm build`：本轮未重新执行

## 相关文件索引

### 文档

- `docs/ai-chat-review-report.md`
- `docs/ai-chat-v3-optimization.md`
- `docs/ai-chat-handoff-2026-03-06.md`

### 代码

- `src/app/api/chat/route.ts`
- `src/lib/ai/evidence-analysis.ts`
- `src/lib/telegram.ts`

## 给下一位专家的简版结论

一句话总结今天的结果：

- 方向已经从“硬编码补规则”转到了“检索后 AI 二次分析”，这个方向是对的；但当前主阻塞点不是 prompt 不够长，而是 evidence-analysis 和 keyword extraction 经常超时，导致这条新链路没有稳定进入最终回答。

---

创建时间: 2026-03-06
最后更新: 2026-03-06
