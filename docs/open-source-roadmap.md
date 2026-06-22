# 开源博客框架改造规划 (Open-Source Roadmap)

## 目标

把 `luoleiorg-x`（基于 vinext + RSC + Cloudflare 的个人博客）从「深度个人化的产品」改造为「通用、可适配、可复用的开源博客框架」。本文档记录一次完整 code review 的结论，以及分阶段改造路线。

## 背景

当前代码工程水平很高（边缘原生架构、构建期内联内容、成熟的 AI 子系统与缓存降级策略），但所有配置、文案、个人画像数据都强绑定作者本人，无法直接被他人复用。

---

## 一、Code Review 总评

| 维度 | 现状评分 | 说明 |
|------|---------|------|
| 架构设计 | 9/10 | 边缘原生、`import.meta.glob` 构建期内联内容、RSC 直出 |
| 代码质量/类型安全 | 8.5/10 | 全 TS strict、模块边界清晰、有测试 |
| AI 子系统 | 9/10 | 同类博客中罕见的深度，但强绑定作者身份 |
| 配置抽象 | 5/10 | 有 `site-config.ts`，但个人数据散落多处、存在重复源 |
| 可复用性（作为框架） | 3.5/10 | i18n 缺失、个人基建硬编码、特性不可关闭 |
| 安全/密钥管理 | 8/10 | 密钥已被 `.gitignore` 正确忽略（见下方更正） |

**重要更正**：`wrangler.jsonc`（`.gitignore:66`）、`.env`、`.dev.vars` 均已被 git 忽略，**API 密钥没有进版本库**。真正的开源前红线是「个人画像数据已被 tracked」（见 §四 高优先项）。

---

## 二、分模块发现

### 内容与渲染层（优秀，但中文/个人硬编码渗透）

优点：
- `import.meta.glob("/content/posts/**/*.md", {query:"?raw", eager:true})` 构建期内联所有 markdown，边缘运行时零 FS I/O。
- unified 管线规范（`post-markdown.ts:247`），自定义插件（图片懒加载、链接 favicon、TweetCard/GearCard）解耦得当。
- `React.cache()` + in-memory Map 防重复解析。

复用阻塞点：

| 问题 | 位置 | 严重度 |
|------|------|--------|
| 阅读时长写死中文 `${minutes} 分钟` | `src/lib/content/posts.ts:85` | 中 |
| 日期格式写死中文 `年/月/日` | `src/lib/content/utils.ts:3-26` | 中 |
| 内部域名 fallback 写死 `["luolei.org","www.luolei.org"]` | `post-markdown.ts:29`、`url-utils.ts:7` | 高 |
| 图片代理服务写死 `img.is26.com` | `content/utils.ts:1`、`image-proxy.ts:1`、`favicon.ts:1` | 高 |
| GearCard 标签写死「入手价格/原价」 | `post-markdown.ts:59` | 低 |
| `.md` 导出注入写死 `source: https://luolei.org` | `api/raw/[slug]/route.ts:36` | 中 |
| 默认 Twitter 用户名 `luoleiorg` | `tweets.ts:9` | 低 |

### AI 子系统（亮点，也是最深的耦合）

数据流：`/api/chat` → 语义检索（可选 LLM 抽词）→ 证据分析 → 拼装 system prompt → 流式输出 → citation guard 防幻觉。Provider 走 `AI_BASE_URL/AI_API_KEY/AI_MODEL`（OpenAI 兼容），抽象良好。

强耦合点：
- 人格、声纹（`voice-profile.json`）、事实库（`fact-registry.json`）、`author-context.json`（830KB）全是编译期 `import` 的作者专属数据，且**已提交进 git**。
- prompt 全程第一人称单数，`core-identity.ts:66` 直接写「你是 ${name}」，多作者场景需重写。
- **MCP server（`/api/mcp`）无鉴权、无限流**，`read_article`/`search_articles` 完全开放——真实的 DoS/抓取面。

亮点：`citation-guard`、`evidence-analysis`、`keyword-extraction` 均为纯函数、零博客依赖，天然可抽包。

### 配置与部署

- 绑定：`ASSETS`、`IMAGES`（CF Images）、`CACHE_KV`；env 走 `wrangler.jsonc` 注入。
- 分析：Umami 自托管 + KV 缓存（`umami_pageviews_cache_v2`，6h / summary 5min），stale-while-error 降级很好。
- 但分析/评论/AI 全部 always-on，无 feature flag；Umami ID 在 `site-config.ts:65` 与 `umami-config.ts` 重复定义。

---

## 三、与同类博客系统对比

| 框架 | 内容层 | 配置模型 | 本项目差距 |
|------|--------|---------|-----------|
| Astro + Content Collections | `defineCollection` + Zod 校验 | `astro.config` + 内容 schema | 缺 schema 校验、主题分离 |
| Next.js blog templates | MDX/contentlayer | 约定式 | 架构更先进但模板化程度低 |
| Hexo / VitePress | `source/_posts` + `_config.yml` | 单一 config 驱动一切 | 需把散落硬编码收敛成一份 config |
| Nextra | 文件路由 + theme config | `theme.config` | 需主题/内核分离 |

成熟开源博客框架普遍做到三件本项目还没做的事：
1. 配置单一入口（一份 `*.config.ts` 决定全部站点行为）；
2. 内容与代码分离（用户的 `content/` + `config` 在框架外）；
3. i18n + frontmatter schema 校验。

---

## 四、开源前高优先项

1. 🔴 **个人画像数据在 git 里**：`data/author-context.json`（830KB）等已被 tracked，开源即泄露完整个人事实库。务必先移出，仅留 `*.example.json` 模板。
2. 🟠 **MCP `/api/mcp` 无鉴权无限流**：开源后会被照搬，内核应默认带限流。
3. 🟡 **配置重复源**（Umami ID、域名列表 ≥3 处），收敛进单一 config。
4. 🟡 **i18n 缺失**：与「通用框架」差距最大的一项，中文文案散落十余处文件。

---

## 五、分发形态选择

| 形态 | 好处 | 代价 | 业界代表 |
|------|------|------|---------|
| 模板仓库（degit / Use this template） | 上手最快、用户拥有全部代码、心智负担低 | 内核更新用户只能手动 merge | Vercel examples、Astro themes、blog-starter |
| 框架内核 + npm 包 | 可 semver 升级、`npm update` 即可、职责清晰 | 需稳定公共 API + monorepo 拆包，成本高 | Next.js、Astro、Docusaurus、Nextra |
| 主题化（theme.config + slot 覆写） | 升级顺滑 + 一定可定制 | slot/override API 设计费心 | VitePress、Hugo/Hexo 主题 |

**业界规律**：成功的博客系统几乎都是「模板/starter 起步，内核成熟后再抽包」。没有人一上来就拆 npm 包——博客的可配置面要在真实使用中才暴露，过早抽象一定抽错。

**决策**：模板仓库起步 → 沉淀出稳定的 `site.config.ts` 契约后，再把内核抽成 `@yourorg/blog-core` 包。阶段 0–3 两种形态都要做，暂不锁死。

---

## 六、分阶段改造路线

### 阶段 0：去个人化与密钥卫生（必须，1–2 天）

- [ ] 把 `data/author-context.json`、`fact-registry.json`、`voice-profile.json`、`reports/*.json` 等个人数据从 git 移除（加 `.gitignore`），仅保留 `*.example.json` 模板。
- [ ] 校验无 secret 入库（已确认 wrangler/.env 已忽略 ✅），补 `SECURITY.md` 说明密钥走 `wrangler secret`。
- [ ] 清理 `data/structured-facts-aggregated.json.backup` 等备份文件。

### 阶段 1：配置单一入口（框架地基，1 周）

- [ ] 扩展 `site-config.ts` → `site.config.ts`，纳入散落配置并新增 `i18n` / `categories` / `features`（全部可关）/ `analytics` / `comments` / `images.proxy` / `license` 等字段。
- [ ] 消灭重复源：Umami ID、域名列表只在 config 一处定义；`url-utils.ts:7` / `post-markdown.ts:29` 改为读 `config.site.domains`。

### 阶段 2：i18n 与内容契约（1–1.5 周）

- [ ] 抽离中文 UI 文案到 `locales/{zh,en}.json`（日期、阅读时长、GearCard、推文指标、分享卡文案等）。
- [ ] frontmatter 用 Zod schema 校验，给友好报错；`tags` 等字段正式纳入 schema。
- [ ] `content/` 目录路径可配置；渲染管线（remark/rehype 插件、自定义卡片）做成可注册的插件数组。

### 阶段 3：特性开关与适配器（1–2 周）

- [ ] `features.*` 落地：AI/MCP/评论/分析/分享卡均可一键关闭，关闭即不打进 bundle。
- [ ] Analytics adapter 接口（Umami/Plausible/GA/none）；Comments adapter（Artalk/Giscus/none）。
- [ ] MCP server 加限流 + 可选 token 鉴权。
- [ ] AI 子系统做成可选模块：人格/声纹/事实从 `import` 改为运行时加载，允许「通用助手人格」降级；`citation-guard`/`evidence-analysis`/`keyword-extraction` 抽成内部纯函数包，为抽包铺路。

### 阶段 4：开源工程化（0.5–1 周）

- [ ] `create-` CLI 或 degit 模板入口；`.env.example` + `wrangler.example.jsonc` + `site.config.example.ts` 三件套齐全。
- [ ] README（中英）、`docs/setup.md` / `docs/deployment.md`、贡献指南、LICENSE、CI（lint+typecheck+build）。
- [ ] happy path 跑通：`pnpm create-blog` → 改 config → `deploy:vinext`。

---

## 状态

- [x] 完整 code review（内容层 / AI / 配置部署 / 安全）
- [x] 分发形态调研与决策（模板起步 → 内核抽包）
- [ ] 阶段 0：去个人化与密钥卫生
- [ ] 阶段 1：配置单一入口
- [ ] 阶段 2：i18n 与内容契约
- [ ] 阶段 3：特性开关与适配器
- [ ] 阶段 4：开源工程化

---
创建时间：2026-06-18
最后更新：2026-06-18
