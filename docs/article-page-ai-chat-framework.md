# 文章页 AI 对话增强方案

## 目标

在文章详情页引入“文章上下文感知”的 AI 对话能力：

1. 用户在大屏阅读文章时，页面右下角自动出现该文章专属 AI 对话框。
2. AI 先围绕当前文章帮助用户理解“核心观点、关键细节、作者意图、适用场景”。
3. 对话可自然延伸到“相关文章、相关项目、相似经历、进一步阅读建议”等主题。
4. 通过离线预生成和轻量缓存，避免首次打开时的重复分析与高延迟。

## 背景

当前仓库已经具备三项关键基础能力：

- 全局聊天框与会话状态：`src/components/ai-chat-box.tsx`、`src/components/ai-chat-provider.tsx`
- 文章级 AI 结构化数据：`data/ai-summaries.json`、`src/lib/content/ai-data.ts`
- 基于检索的聊天 API：`src/app/api/chat/route.ts`

这意味着新功能不应新建一套“第二聊天系统”，而应在现有聊天链路上增加 **article scope** 能力，让文章页可以为全局聊天框注入更强的当前上下文。

## 设计原则

### 1. 文章上下文优先，站点全局知识兜底

回答当前文章问题时，优先使用当前文章的结构化信息与正文片段；只有当用户话题明显跳出文章时，才扩展到全站检索结果。

### 2. 预生成优先于运行时推导

与现有 AI 摘要/SEO 体系保持一致，尽量在离线阶段生成文章对话所需数据，避免用户打开文章时才请求 LLM 分析。

### 3. UI 自动出现，但交互不强打扰

自动弹出只发生在大屏场景，且必须具备：

- 首次阅读延时触发
- 单篇文章去重
- 用户关闭后的本地冷却期

### 4. 事实层、引导层、表达层分离

- 事实层：文章摘要、key points、标题、分类、相关文章、正文片段
- 引导层：建议提问、推荐追问、延伸主题
- 表达层：聊天框开场白、欢迎文案、自动首条消息

### 5. 尽量复用现有 `/api/chat`

不复制检索、限流、流式输出、引用保护等逻辑，只增加文章感知参数和更细的 prompt/runtime context 分支。

## 目标体验

### 桌面端阅读流

1. 用户进入文章页。
2. 页面判断为大屏且满足触发条件。
3. 右下角自动浮出一个收起态 AI 卡片，文案类似：
   - “我可以结合这篇文章继续展开讲”
   - 展示 3 个与当前文章强相关的快捷问题
4. 用户点击任一快捷问题，直接发起首轮对话。
5. AI 首轮回答默认围绕当前文章解释，再给出 2 个延伸方向：
   - 深入理解本文
   - 看相关文章 / 相邻主题

### 非打扰策略

- 移动端不自动弹出，只保留手动入口
- 同一篇文章用户手动关闭后，24 小时内不再自动弹出
- 用户已主动打开过全局聊天框时，不再重复自动弹

## 整体架构

```mermaid
flowchart TD
  A[Markdown Post] --> B[离线 AI 处理脚本]
  B --> C[data/ai-summaries.json]
  B --> D[data/article-chat-guides.json]

  E[文章页 RSC]
  C --> E
  D --> E

  E --> F[Article Chat Bootstrap]
  F --> G[AIChatProvider]
  G --> H[AIChatBox]

  H --> I[/api/chat]
  E --> J[article context payload]
  J --> I

  I --> K[当前文章上下文构建]
  I --> L[全站检索兜底]
  K --> M[Prompt 拼装]
  L --> M
  M --> N[流式回答]
```

## 分层方案

### 1. 数据层

新增离线产物：

- `data/article-chat-guides.json`

建议结构：

```ts
interface ArticleChatGuide {
  slug: string;
  title: string;
  contentHash: string;
  processedAt: string;
  articleSummary: string;
  articleAbstract: string;
  keyPoints: string[];
  focusQuestions: string[];
  extensionTopics: string[];
  relatedSlugs: string[];
  openingLine: string;
  desktopAutoOpen: {
    enabled: boolean;
    delayMs: number;
  };
}

interface ArticleChatGuideFile {
  meta: {
    lastUpdated: string;
    model: string;
    totalProcessed: number;
  };
  articles: Record<string, ArticleChatGuide>;
}
```

字段说明：

- `focusQuestions`: 针对本文的高质量引导问题，3-5 条
- `extensionTopics`: 可继续发散的主题，2-4 条
- `relatedSlugs`: 可直接复用现有站内搜索/推荐逻辑
- `openingLine`: 自动弹层开场语，避免所有文章都用同一模板

### guide 数据生成策略

采用 **AI-first + 静态缓存 + 通用兜底**：

1. AI 生成层
   - 输入 `title`、`categories`、`content`
   - 由 LLM 直接产出 `openingLine`、`focusQuestions`、`extensionTopics`
   - 目标是让模型从“读者最自然会怎么问”出发，而不是按分类模板拼句子
   - 通过 `contentHash` 做增量缓存，只在文章变更后重跑
2. 构建合并层
   - `generate-article-chat-guides.mjs` 合并 `ai-summaries.json`、AI chat guide 缓存和 `relatedSlugs`
   - 输出运行时使用的 `data/article-chat-guides.json`
3. fallback 层
   - 仅当 AI guide 缓存缺失或过期时，使用一组统一的通用问题兜底
   - fallback 不再按 travel / tech / lifestyle 等分类硬编码不同句式

这样可以保证线上仍是静态读取，不增加阅读时延迟，同时把“问题长什么样”的判断交还给模型。

### 2. 页面层

文章页服务端除现有 `post`、`aiSummary`、`aiSeo` 外，再读取：

- `articleChatGuide`

新增一个轻量 bootstrap 组件，例如：

- `src/components/article-chat-bootstrap.tsx`

职责：

- 判断是否为文章页
- 判断是否为桌面宽度（如 `min-width: 1280px`）
- 判断是否已触发/已关闭/已互动
- 将当前文章 guide 注入全局聊天上下文
- 到达延时阈值后触发右下角自动浮出

这里建议保持：

- **文章数据在服务端读取**
- **自动弹出策略在客户端执行**

符合现有 RSC / client boundary 的分工。

### 3. 会话上下文层

扩展 `AIChatProvider`，从“只管理 open/close”升级为“管理聊天 UI 状态 + 可选页面上下文”。

建议新增状态：

```ts
interface ChatEntryContext {
  scope: "global" | "article";
  slug?: string;
  title?: string;
  summary?: string;
  keyPoints?: string[];
  openingLine?: string;
  focusQuestions?: string[];
  relatedSlugs?: string[];
}
```

Provider 需要新增能力：

- `setEntryContext(context)`
- `markAutoOpened(slug)`
- `dismissAutoOpen(slug)`
- `hasUserInteracted`

这样首页手动入口与文章页自动入口仍走同一套聊天框，但来源不同：

- 首页：`scope = global`
- 文章页：`scope = article`

### 4. API 层

不建议新增 `article-chat` 独立接口，建议直接扩展 `src/app/api/chat/route.ts` 的输入。

请求体新增可选字段：

```ts
interface ChatArticleContextPayload {
  slug: string;
  title: string;
  summary?: string;
  keyPoints?: string[];
  relatedSlugs?: string[];
}
```

请求示意：

```json
{
  "messages": [...],
  "context": {
    "scope": "article",
    "article": {
      "slug": "some-post",
      "title": "文章标题",
      "summary": "一句话摘要",
      "keyPoints": ["要点1", "要点2"],
      "relatedSlugs": ["post-a", "post-b"]
    }
  }
}
```

### API 新增处理逻辑

1. 如果 `scope=article`：
   - 先加载当前文章详情
   - 构建 article-specific context
   - 将当前文章作为最高优先级 evidence
2. 对用户问题做一个轻量路由判断：
   - `article_understanding`
   - `article_detail`
   - `article_extension`
   - `global_shift`
3. 当问题仍围绕当前文章时：
   - 不需要先全站搜索
   - 直接基于当前文章摘要、keyPoints、正文节选回答
4. 当问题明显跳出本文时：
   - 再进入现有全站检索链路
   - 但保留当前文章作为背景锚点

### 关键收益

- 首轮围绕本文的问题可减少一次不必要的全站检索
- Prompt 更聚焦，回答更像“文章导读”
- 避免用户问“这篇文章在讲什么/为什么这么做”时被全站语料稀释

### 5. Prompt 层

建议在 `buildSystemPrompt` 之前增加 article runtime context 分支。

新增一段高优先级上下文：

```text
## 当前阅读文章（L0 current_article）
- 标题：...
- URL：...
- 摘要：...
- 要点：...
- 回答原则：
  - 若用户问题明显指向“这篇文章”，优先只基于当前文章回答
  - 可解释文章背景、方案、结论、取舍、适用场景
  - 若用户追问延伸主题，可结合相关文章补充
  - 若文章未写到该细节，明确说明“这篇文章里没有展开”
```

来源优先级建议调整为：

- `L0 当前文章`
- `L1 相关文章 / 相关动态`
- `L2 项目 / 关于页 / 人工校验事实`
- `L5 文风约束`

这样可以保证“文章页对话”与“首页全局问答”在回答倾向上明显不同。

### 6. 引导词生成框架

引导词不应只是“换个说法的标题”，而应覆盖三类认知任务：

### A. 理解文章

帮助用户吃透本文内容：

- 这篇文章的核心结论是什么？
- 文中方案和常见做法有什么区别？
- 如果我只看 3 个重点，应该记住什么？

### B. 追问细节

帮助用户继续拆开讲：

- 这里为什么选这个技术方案？
- 文中提到的坑点具体怎么规避？
- 这套做法更适合什么场景？

### C. 延伸关联

把用户带到站内更深层内容：

- 这篇文章和你之前哪篇内容可以一起看？
- 如果我对这个主题继续深入，推荐从哪几篇开始？
- 这个思路后来有没有演化成项目或新实践？

### 生成规则

每篇文章保留：

- 3 条 `focusQuestions`
- 2 条 `extensionTopics`
- 1 条 `openingLine`

避免一次给太多问题，减少选择负担。

## 自动弹出策略

### 触发条件

仅当以下条件同时满足时自动浮出：

- 当前路由是文章页
- 视口宽度达到桌面阈值
- 页面停留超过 `6-12s`
- 阅读进度达到 `12%-20%` 之一
- 当前会话未主动打开/关闭聊天框
- 本地未命中该文章的冷却记录

### 交互形态

建议不是直接弹完整聊天框，而是两段式：

1. `teaser card`
   - 位于右下角
   - 显示开场语 + 2-3 个问题按钮
2. 用户点击后再展开完整 `AIChatBox`

原因：

- 比直接覆盖式 modal 更轻
- 更符合“阅读伴随式工具”
- 与首页主动打开的全屏对话体验形成区分

### 状态持久化

本地存储建议：

```ts
interface ArticleChatLocalState {
  dismissedAtBySlug: Record<string, number>;
  autoOpenedAtBySlug: Record<string, number>;
}
```

规则：

- 用户关闭 teaser：24 小时内不再提示
- 用户已经发起对话：该文章本次 session 不再提示

## 性能与缓存

### 1. 预生成缓存

`article-chat-guides.json` 与现有 `ai-summaries.json` 一样，走：

- 内容 hash 增量更新
- Git 提交缓存结果
- 运行时静态加载

### 2. 请求去重

首轮点选快捷问题时，可附带：

- `x-session-id`
- `article.slug`

在现有 session cache 基础上增加 article 维度，可减少同文章相邻追问时的重复检索。

### 3. 轻量正文注入

不要把文章全文直接塞进 prompt。建议离线预存：

- `abstract`
- `keyPoints`
- `top headings`
- `first N chars clean text`

必要时再按段落抽取 2-3 个相关片段。

这样能控制 prompt 体积，避免文章过长时推高延迟。

## 推荐的实现拆分

### Phase 1: 最小可用版本

- 新增 `article-chat-guides.json`
- 文章页注入 `articleChatGuide`
- 桌面端 teaser 自动浮出
- 点选快捷问题后走现有 `/api/chat`
- prompt 加入 `L0 当前文章`

### Phase 2: 深化理解

- 加入文章问题类型路由
- 首轮 article question 绕过全站搜索
- 支持“本文要点总结 / 细节展开 / 相关文章推荐”三种 answer mode

### Phase 3: 延伸主题增强

- 引入 article-to-article graph
- 将 `relatedSlugs` 升级为有向主题关联
- 回答中支持更稳定的“下一篇读什么”

## 关键类型建议

```ts
interface ChatRequestContext {
  scope: "global" | "article";
  article?: {
    slug: string;
    title: string;
    summary?: string;
    keyPoints?: string[];
    relatedSlugs?: string[];
  };
}

interface ArticleIntentDecision {
  mode: "article_understanding" | "article_detail" | "article_extension" | "global_shift";
  shouldSearchSiteWide: boolean;
}
```

## 风险与约束

### 1. 自动弹出过于打扰

解决：

- 只在桌面端
- 只出 teaser，不直接弹大面板
- 延时 + 进度双条件
- 提供冷却期

### 2. 当前文章上下文过重，导致回答啰嗦

解决：

- 只传摘要、要点、少量段落
- 把“本文优先”做成规则，不是把全文硬塞进去

### 3. 文章问题和全站问题边界模糊

解决：

- 明确 route decision
- 当用户问“你最近在做什么”“还有哪些项目”时直接切全局模式

### 4. 预生成内容质量不稳定

解决：

- 优先规则生成基础问题
- LLM 只做精修
- 失败时回退到模板问题，不阻塞页面功能

## 成功指标

- 文章页聊天开启率
- teaser 点击率
- 首轮问题发送率
- article scope 对话平均轮数
- “相关文章点击 / 二次阅读”提升
- 首轮回答平均延迟
- 首轮回答中 article-grounded 命中率

## 结论

这次升级最合适的落点不是“再做一个文章 AI”，而是让现有全局 AI 聊天系统具备 **文章场景感知能力**：

- 页面层负责识别阅读场景并触发轻量入口
- 数据层负责离线预生成 guide 数据
- API 层负责识别 article scope 并优先使用当前文章上下文
- Prompt 层负责把“当前文章”提升为最高优先级知识源

这样既能复用你当前的 AI 聊天体系，也能把文章页对话体验从“泛问答”升级为“阅读伴随式理解助手”。

## 状态

- [x] 完成现状分析
- [x] 明确目标体验与分层边界
- [x] 给出离线预生成与运行时协作框架
- [ ] 进入具体实现阶段

---
创建时间: 2026-03-12
最后更新: 2026-03-12
