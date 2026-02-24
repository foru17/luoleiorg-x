# luoleiorg-x

基于 React 19 + Next.js 16 的 luolei.org 新架构重构项目。

## Goals

- 保持现有博客视觉风格和信息结构
- 保留 markdown 驱动 + 静态页面生成能力，继续提升 SEO
- 预留未来动态能力（AI 总结、AI 搜索）的 API 扩展位
- 提升工程化规范与可维护性

## Tech Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- gray-matter + unified/remark/rehype (markdown pipeline)

## Directory Overview

- `content/posts/`: markdown 文章源
- `packages/search-core/`: monorepo 共享搜索核心（索引与检索评分）
- `src/app/`: 路由、页面、metadata、sitemap、robots、api
- `src/components/`: 主题组件（ArticleCard/Meta/Nav/Footer 等）
- `src/styles/`: 样式分层（tokens/layout/article）
- `src/lib/content/`: 内容加载、frontmatter 解析、markdown 渲染、数据模型
- `scripts/sync-content.mjs`: 从旧仓库同步 markdown 内容
- `scripts/generate-search-index.mjs`: 生成静态搜索索引 `public/search-index.json`

## Monorepo Baseline

- 使用 `pnpm-workspace.yaml` 管理工作区：根应用 `.` + `packages/*`
- 当前已拆出共享包：`@luoleiorg/search-core`
- Next.js 配置了 `transpilePackages`，可直接消费 workspace 包源码

## Style Architecture

- `src/app/globals.css`: 仅做样式入口聚合，不写业务样式
- `src/styles/tokens.css`: 设计变量、字体声明、主题色与全局基础层
- `src/styles/layout.css`: 站点级布局与结构样式（如 header/footer/nav）
- `src/styles/article.css`: 文章正文排版与 markdown 作用域样式（`article-content`）

### Naming Rules

- 使用语义化类名前缀：`site-*`、`article-*`
- 避免继续引入 VitePress 私有选择器（如 `.VP*`、`.vp-doc`）
- Markdown 样式统一收敛在 `article-content`，禁止外部散落覆盖

## Commands

```bash
pnpm i
pnpm sync:content
pnpm search:index
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
```

## Migration Notes

- 文章源来自 `../luoleiorg/docs/*.md`，通过 `pnpm sync:content` 一键同步到新项目。
- 已保留核心能力：
  - 静态文章路由 (`/[slug]` + `generateStaticParams`)
  - SEO Metadata / OpenGraph
  - RSS (`/rss.xml`)
  - Sitemap (`/sitemap.xml`) / Robots (`/robots.txt`)
  - 主题组件化与分页/分类入口
- 已预留未来能力：
  - `POST /api/ai/summary`
  - `POST /api/ai/search`
- 已实现 Command+K 搜索：标题+正文内容本地检索（基于静态索引）
