# About 页面改版需求文档（AI 第三方画像）

## 目标

将当前导航中“关于”从 GitHub 外链改为站内独立页面 `/about`，通过 AI 对博客内容、X（Twitter）动态和 GitHub 履历进行第三方视角归纳，让首次访问者在 1-3 分钟内建立对作者的清晰认知：**是谁、做什么、风格如何、代表作品是什么**。

## 背景

- 现状：顶部导航“关于”直接跳转 `siteConfig.social.github`，没有站内“作者画像”承接页。
- 问题：
  - 新访客需要跨平台拼接信息，认知成本高。
  - 博客已具备 AI 内容能力（`data/ai-summaries.json`），但未用于作者整体形象呈现。
  - 缺少统一、可持续更新的“个人品牌说明页”。

## 设计原则

1. 第三方视角：文案以“他/罗磊”叙述，避免第一人称自述口吻。
2. 有据可依：每个核心结论至少有博客/X/GitHub 事实支撑。
3. 简约克制：减少营销化表达，强调真实、可验证、可阅读。
4. 可迭代：先上线可控版本，再逐步自动化更新报告。
5. 风格一致：保持现有博客排版气质与配色体系，不做强风格割裂。

## 用户与场景

- 新访客（第一次进入站点）：快速了解作者定位与内容方向。
- 老读者：查看作者近阶段重心变化与代表成果。
- 合作方/媒体：快速获取对外介绍材料与可信依据。

## 需求范围

### In Scope（本次）

- 新增独立路由页面：`/about`
- 顶部导航“关于”改为站内跳转 `/about`（桌面 + 移动端）
- 页面核心模块（见下文“信息架构”）
- 基于现有内容源生成 `AI 第三方画像报告`（离线生成，静态读取）
- 页面中展示“数据来源 + 生成时间 + AI 免责声明”

### Out of Scope（本次不做）

- 运行时调用 AI（避免延迟、成本和不稳定）
- 在线抓取 X/GitHub 实时数据（先使用缓存/手动输入）
- 多语言版本
- 用户可交互问答式“AI 聊天关于页”

## 信息架构（页面模块）

### M1. Hero：一句话画像 + 导语

- 内容目标：30 秒内让用户形成第一印象。
- 形式：
  - 主标题：`AI 视角下的罗磊`
  - 核心句：类似“如果说 A 是…，那么罗磊更像…”
  - 副文案：2-3 句概括技术、审美、生活方式融合特征。

### M2. 核心身份与背景（Identity Pillars）

- 3-5 个身份卡片（例如：全栈开发者、数字游民、内容创作者、开源实践者）
- 每张卡片包含：
  - 身份名
  - 1 句解释
  - 1 条证据（文章/项目/时间）

### M3. 技术与审美特长（Strengths）

- 展示作者的“技术硬实力 + 产品审美 + AI 工具实践”组合。
- 形式建议：2 列分组卡片（技术、审美/产品）+ 要点列表。

### M4. 性格与行事风格（Working Style）

- 提炼 3-4 条行为特征（例如：真诚分享、行动导向、长期主义）
- 每条包含简短说明，避免空泛赞美。

### M5. 代表作品与影响力线索（Proof）

- 博客代表文章（3-5 篇）
- X 代表动态（2-3 条，来自 `data/tweets-cache.json`）
- GitHub 代表项目（2-4 个）
- 每条附链接与一句价值描述。

### M6. 数据来源与声明（Transparency）

- 明确报告来源：博客文章、X 缓存、GitHub 履历。
- 显示：
  - 报告生成时间
  - 使用模型（可选）
  - 免责声明：AI 归纳可能存在偏差，欢迎以原始内容为准。

## 文案规范（AI 生成约束）

1. 叙述视角：第三人称，不使用“我”。
2. 表达风格：客观、克制、具体，不写空泛套话。
3. 结构化输出：结论 + 证据。
4. 禁止项：
   - 无依据推断隐私信息
   - 绝对化表述（如“最强”“唯一”）
   - 与事实冲突的时间线
5. 长度控制：页面总阅读时长控制在 2-4 分钟内。

## 数据与生成方案

### 数据源

- 博客：`content/posts/*.md` + `data/ai-summaries.json`
- X：`data/tweets-cache.json`（仅使用 `author.username = luoleiorg`）
- GitHub 履历：建议新增 `data/github-resume.json`（先手动维护）

### 建议产物

- `data/author-profile-context.json`
  - 聚合后的输入上下文（供调试）
- `data/author-profile-report.json`
  - 页面直接消费的结构化结果

### 报告数据结构（建议）

```json
{
  "meta": {
    "lastUpdated": "2026-03-01T22:00:00+08:00",
    "model": "gemini-3-flash-preview",
    "sources": ["posts", "tweets-cache", "github-resume"]
  },
  "report": {
    "hero": {
      "title": "AI 视角下的罗磊",
      "summary": "..."
    },
    "identities": [
      { "name": "全栈开发者", "description": "...", "evidence": "..." }
    ],
    "strengths": [{ "title": "...", "points": ["..."] }],
    "styles": [{ "trait": "...", "description": "..." }],
    "proofs": {
      "posts": [{ "title": "...", "url": "...", "reason": "..." }],
      "tweets": [{ "id": "...", "url": "...", "reason": "..." }],
      "projects": [{ "name": "...", "url": "...", "reason": "..." }]
    }
  }
}
```

### 生成方式（建议）

- 离线脚本生成（与现有 `scripts/ai-process.mjs` 一致思路）：
  - `scripts/generate-author-profile.mjs`
- 命令建议：
  - `pnpm ai:profile`
  - `pnpm ai:profile --force`
- 页面仅静态读取 JSON，不在请求时调用 AI API。

## 前端实现方案

### 路由与组件

- 新增：`src/app/about/page.tsx`
- 新增：`src/lib/content/author-profile.ts`（读取并校验报告 JSON）
- 新增组件（建议）：
  - `src/components/about/about-hero.tsx`
  - `src/components/about/about-identity.tsx`
  - `src/components/about/about-strengths.tsx`
  - `src/components/about/about-proofs.tsx`
  - `src/components/about/about-disclaimer.tsx`

### 站点导航修改

- `src/components/site-header.tsx`
  - “关于”链接从 `siteConfig.social.github` 改为 `"/about"`
  - 保留 GitHub 图标链接（单独入口）

### SEO

- `generateMetadata` 配置：
  - title: `关于 | 罗磊的独立博客`
  - description: AI 第三方视角的作者画像简介
  - canonical: `/about`
- 可选：添加 `Person` JSON-LD（含站点、GitHub、X、YouTube）

## 视觉与交互建议（简约方向）

- 版式：单列主内容 + 局部卡片分组，避免复杂瀑布布局。
- 视觉语气：轻边框、弱阴影、高留白，强调阅读节奏。
- 交互：
  - 模块内不做复杂动画
  - “展开更多”用于控制长段落
  - 所有证据链接可直接跳转原文
- 移动端优先：卡片垂直堆叠，标题与段落保持紧凑。

## 验收标准

- [ ] `/about` 可访问，且导航“关于”指向站内页面
- [ ] 页面首屏可在 30 秒内传达作者核心画像
- [ ] 至少包含 3 类信息源（博客、X、GitHub）
- [ ] 结论具备证据支撑，不出现明显事实错误
- [ ] 页面样式与现有博客风格一致，移动端可读性良好
- [ ] `pnpm typecheck`、`pnpm lint`、`pnpm build` 均通过（开发阶段）

## 分阶段计划

1. Phase 1（MVP）：静态页面 + 手动报告 JSON + 导航改造
2. Phase 2：离线 AI 生成脚本 + 上下文聚合 + 报告自动更新
3. Phase 3：内容质量优化（证据引用、文案打磨、SEO 增强）

## 风险与对策

- AI 幻觉或过度美化
  - 对策：强制“结论+证据”格式，人工审核后发布
- 数据时效性不足
  - 对策：显示 `lastUpdated`，提供固定更新命令
- 语气不符合个人品牌
  - 对策：新增风格提示词模板，并支持人工覆写段落

## 待你确认的问题

1. `/about` 文案更偏“专业履历”还是“生活方式 + 专业融合”？
2. 是否保留“与其他技术博主对比”的段落（如 @m1ssuo）？
3. GitHub 履历数据是手动维护 JSON，还是后续接入 API 自动抓取？
4. 页面语言是否只保留中文？

## 状态

- [x] 需求草案完成
- [ ] 你确认需求方向
- [ ] 进入页面开发与实现

## 2026-04-30 模型渠道更新

About 页面多模型画像切换到新的本地 `.profile-models.json` 配置。当前启用模型为：

- `gpt-5.5`：OpenAI compatible 渠道 `https://api.ttttt.ai/v1`
- `minimax-latest`：Ark coding v3 渠道
- `glm-5.1`：Ark coding v3 渠道
- `deepseek-v4-pro`：DeepSeek 官方 OpenAI-compatible 渠道 `https://api.deepseek.com`
- `kimi-k2.6`：Ark coding v3 渠道

Ark coding v3 渠道需要在请求头中带：

- `User-Agent: claude-code/2.1.37`
- `Cache-Control: no-cache`

脚本侧已支持按模型配置自定义 `headers` 与 `maxTokens`，并在更新 manifest 时清理不再启用的旧模型条目。

2026-04-30 本轮 `pnpm profile:force` 结果：

- AI 成功：`glm-5.1`、`deepseek-v3.2`、`kimi-k2.6`
- 规则兜底：`gpt-5.5` 上游返回 500/超时；`minimax-latest` 返回内容但引用了上下文外 GitHub URL，未通过报告校验。

## 2026-05-01 DeepSeek V4 Pro 更新

按最新 DeepSeek 官方渠道替换 About 页面中的旧 DeepSeek 视角：

- 模型 ID：`deepseek-v4-pro`
- Base URL：`https://api.deepseek.com`
- 请求参数：`stream: false`、`thinking.type: enabled`、`reasoning_effort: high`
- 脚本支持：`scripts/generate-profile-report.mjs` 新增 `extraBody` 透传，并在请求前清洗孤立 Unicode surrogate，避免 DeepSeek JSON 解析失败。

本轮 `node scripts/generate-profile-report.mjs --model=deepseek-v4-pro --force` 结果：

- AI 成功：`deepseek-v4-pro`
- 旧报告：`data/reports/deepseek-v3.2.json` 已移除
- Manifest：`data/reports/manifest.json` 已替换为 `DeepSeek V4 Pro`

---
创建时间: 2026-03-01  
最后更新: 2026-05-01
