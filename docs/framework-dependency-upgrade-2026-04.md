# 博客框架依赖升级记录

## 目标

将博客框架链路更新到当前可安装的新版本，重点升级 Vinext，并根据 Vinext 自 `0.0.21` 以来的新增能力做兼容性优化。

## 背景

本仓库此前使用 `vinext@0.0.21`。截至 2026-04-30，npm `latest` 为 `vinext@0.0.45`，官方发布记录显示 2026-03-06 到 2026-04-28 期间连续发布了多轮 App Router、缓存、ISR、Vite 8、Cloudflare Workers 和安全修复。

## 升级结果

- `vinext`: `0.0.21` -> `0.0.45`
- `next`: `16.1.6` -> `16.2.4`
- `react` / `react-dom`: `19.2.4` -> `19.2.5`
- `vite`: `7.3.1` -> `8.0.10`
- `@cloudflare/vite-plugin`: `1.25.5` -> `1.34.0`
- `wrangler`: `4.68.1` -> `4.86.0`
- `@vitejs/plugin-rsc`: `0.5.20` -> `0.5.25`
- 新增 `@vitejs/plugin-react@5.2.0`，用于满足 `vinext@0.0.45` 的 peer dependency。

`eslint@10`、`typescript@6`、`@vitejs/plugin-react@6`、`@types/node@25` 虽然是 registry latest，但当前依赖链仍存在 peer compatibility 缺口：

- Next ESLint 依赖链尚未声明支持 `eslint@10`
- `vite-tsconfig-paths` 仍要求 `typescript@^5`
- `@vitejs/plugin-react@6` 要求额外 React Compiler peer，并不适合当前配置
- 项目文档基线仍是 Node 20+，因此保留 `@types/node@20.19.x`

## Vinext 新增能力评估

已采纳：

- `vinext check` 兼容性扫描：用于发现 ESM/CommonJS 全局问题。
- ESM 脚本路径优化：将脚本中的 `__dirname` / `__filename` 兼容写法迁移到 `import.meta.dirname`。
- Vite 8 构建链路：通过新版 Vinext、Cloudflare Vite Plugin 和 Wrangler 组合启用。

暂缓采纳：

- Next.js Google Fonts 支持：当前站点主要使用系统字体和本地嵌入字体，接入 `next/font/google` 会增加构建期外部字体下载依赖，暂不改变排版链路。
- CSP 支持：站点使用 Umami、Google Analytics、Cloudflare Turnstile、Artalk 等外部脚本与接口，需要单独设计策略后再开启，避免误伤线上功能。
- App Router ISR / KV CacheHandler：文章内容来自构建时 Markdown 静态注入，现阶段收益有限；统计数据已有独立 KV 缓存策略。
- `generateSitemaps()` 分片 sitemap：当前约 300+ 篇文章，单 sitemap 规模仍远低于分片需求。

## 状态

- [x] 查询当前依赖与 registry 最新版本
- [x] 升级框架与运行时依赖
- [x] 补齐 Vinext peer dependency
- [x] 运行 `vinext check` 并修复明确兼容问题
- [x] 完成 `pnpm typecheck`、`pnpm lint`、`pnpm exec vinext build`
- [ ] 完整 `pnpm build` 会重建搜索与文章对话索引；本次为避免覆盖升级前已存在的 `data/article-chat-guides.json` 本地改动，未直接执行。

---
创建时间: 2026-04-30
最后更新: 2026-04-30
