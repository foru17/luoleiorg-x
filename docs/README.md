# 项目文档索引

本文档目录用于追踪项目中的技术决策、任务规范和实现细节。

## 📋 文档列表

### 系统规范

| 文档 | 说明 | 状态 |
|------|------|------|
| [../AGENTS.md](../AGENTS.md) | AI Agent 工作规范 | ✅ 活跃 |
| [./TWEET_CARD_USAGE.md](./TWEET_CARD_USAGE.md) | TweetCard 系统使用指南 | ✅ 活跃 |
| [./about-page-ai-profile-prd.md](./about-page-ai-profile-prd.md) | About 页面 AI 第三方画像需求文档 | 🧪 评审中 |
| [./chat-prompt-v2-refactor.md](./chat-prompt-v2-refactor.md) | 首页 AI 分身 Prompt v2 分层重构说明 | ✅ 已完成 |
| [./ai-chat-v3-optimization.md](./ai-chat-v3-optimization.md) | AI 对话架构与流程升级规划 | ✅ 已更新 |
| [./ai-chat-review-report.md](./ai-chat-review-report.md) | AI 对话数据流 Review 报告 | ✅ 已更新 |
| [./ai-chat-handoff-2026-03-06.md](./ai-chat-handoff-2026-03-06.md) | 2026-03-06 AI 对话链路调试与交接记录 | 🧪 新增 |
| [./article-page-ai-chat-framework.md](./article-page-ai-chat-framework.md) | 文章页自动弹出式 AI 对话增强方案 | 🧪 新增 |

### 开发指南

| 文档 | 说明 | 状态 |
|------|------|------|
| [./setup.md](./setup.md) | 项目初始化和环境配置 | 📝 待创建 |
| [./deployment.md](./deployment.md) | 部署流程和注意事项 | 📝 待创建 |

### 任务追踪

| 文档 | 说明 | 状态 |
|------|------|------|
| [./tasks/favicon-pwa.md](./tasks/favicon-pwa.md) | Favicon 修复和 PWA 支持 | ✅ 已完成 |
| [./tasks/tweet-card-optimization.md](./tasks/tweet-card-optimization.md) | TweetCard 系统重构 | ✅ 已完成 |

## 📝 文档规范

### 创建新文档

1. 根据文档类型放入相应子目录
2. 使用清晰的文件名（kebab-case）
3. 在本文档索引中添加条目
4. 包含以下章节：
   - **目标**: 清晰描述文档目的
   - **背景**: 为什么要做这个
   - **实现**: 具体方案
   - **状态**: 待办/进行中/已完成

### 文档模板

```markdown
# 任务名称

## 目标
简要描述这个任务要达成什么。

## 背景
为什么要做这个事情，有什么痛点。

## 实现
具体实现步骤和方案。

## 结果
最终效果和验证方式。

## 状态
- [x] 步骤 1
- [x] 步骤 2
- [ ] 步骤 3

---
创建时间: 2024-XX-XX
最后更新: 2024-XX-XX
```

## 🔗 相关链接

- [线上站点](https://luolei.org)
- [GitHub 仓库](https://github.com/foru17/luoleiorg-x)
- [旧版仓库 (VitePress)](https://github.com/foru17/luoleiorg)
