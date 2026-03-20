# 导航过渡与统计链路优化

## 目标
优化首页、分类页、文章页之间的客户端跳转体验，减少慢网环境下“URL 已变化但页面还停在旧内容”的体感卡顿。

## 背景
线上交互里存在两类叠加问题：

1. App Router 在导航过渡期间会先更新地址栏，再等待新路由数据与页面挂载完成。
2. 文章页和列表页在首屏阶段还夹带了不必要的阻塞逻辑：
   - 文章页 metadata 与正文都走完整的文章详情读取，导致 markdown 渲染重复执行。
   - 文章页首屏同步等待阅读量。
   - 首页/分类页在缓存未命中时会直接等待 Umami 统计。

## 实现
本次优化包含四部分：

1. 文章详情链路瘦身
   - `src/lib/content/posts.ts`
   - 将文章基础信息与正文渲染拆开。
   - metadata 走轻量 `getPostSummaryBySlug()`。
   - 正文 HTML 渲染结果按 slug 做进程内缓存，避免同篇文章重复转换 markdown。

2. 统计链路改为非阻塞
   - `src/lib/content/listings.ts`
   - 首页和普通分类页不再因为阅读量阻塞首屏。
   - 没有热缓存时先返回占位态，再在后台刷新统计。
   - 热门页仍保留更稳定的排序策略。

3. 列表页统计客户端补拉
   - `src/components/article-list.tsx`
   - `src/components/article-list-client.tsx`
   - `src/hooks/use-article-hits.ts`
   - 当服务端返回的是占位态时，客户端会补拉 `/api/analytics/hits`。
   - 加载态不再把默认 `0` 当成真实阅读量渲染。

4. 导航过渡反馈
   - `src/components/route-transition-progress.tsx`
   - `src/components/route-transition-complete.tsx`
   - `src/app/[slug]/loading.tsx`
   - 增加全局顶部导航进度条。
   - 新页面真正挂载后才结束进度反馈。
   - 文章动态路由补上 `loading.tsx`，让动态路由预取和 fallback 有明确边界。

## 结果
- 首屏不再被阅读量统计硬阻塞。
- 文章页 metadata 不再重复触发完整 markdown 渲染。
- 冷缓存时列表页先显示占位，随后自动补齐阅读量。
- 路由切换过程有可见反馈，慢网下不再是“地址变了但页面没反应”。

## 状态
- [x] 文章详情重复计算收敛
- [x] 列表页统计改为非阻塞
- [x] 列表页阅读量客户端补拉
- [x] 全局导航过渡反馈
- [x] 文章路由 loading fallback

---
创建时间: 2026-03-19
最后更新: 2026-03-19
