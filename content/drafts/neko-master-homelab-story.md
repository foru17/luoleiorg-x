---
title: "Neko Master: 一个 Homelab 用户的 Vibe Coding 实践"
date: "2026-02-15"
cover: https://c2.is26.com/blog/2026/02/neko-master/neko-master-cover.png
categories:
  - code
tags:
  - opensource
  - homelab
  - ai
---

## 起因

我是个 Homelab 用户。

家里分流策略比较复杂，日常开发也会频繁切换 IP。原生面板更多是「运行状态」展示，但缺少一个更直观的视角去看：

**流量到底在干什么？**

- 哪些域名在吃带宽？
- 哪个节点负载更高？
- 当前的规则策略是否合理？

与其在不同工具之间拼凑数据，不如自己做一个更聚焦「流量感知」的面板。

## 它是什么

一个开源、自部署的网络流量分析面板。

- 多维流量统计（域名 / 节点 / 规则 / 地区等）
- 趋势分析
- 多后端支持（OpenClash / Mihomo / Surge）
- Docker 一键部署
- 移动端适配 + PWA

定位很简单：**轻量、聚合分析优先、界面尽量现代。**

由于涉及实时数据采集和分析，建议采用旁路部署，而不要和网关部署在同一台机器上。

我自己是部署在 NAS（N5105 CPU）上，监控 3 个上游 Clash 网关，目前运行比较稳定，对主网关负载影响也较小。

![](https://c2.is26.com/blog/2026/02/neko-master/neko-1.png)

![](https://c2.is26.com/blog/2026/02/neko-master/neko-2.png)

## 关于 Vibe Coding

这个项目算是一次完整的 Vibe Coding 实践。

MVP 1 小时完成，4 小时上线第一版。后续一周主要在做结构重构和稳定性打磨。

开发过程中用到了：

- Kimi K2.5（早期结构搭建主力）
- Claude Code Opus 4.5 / 4.6（复杂逻辑与性能问题）
- GPT 5.2 / 5.3（迭代优化）
- Gemini 3 Pro（辅助 Review）

一个真实体感是：**AI 非常适合快速把想法变成可运行的系统。**

国产模型在初始化阶段已经足够高效，但当复杂度提升时，Opus 4.6 / GPT 5-5.3 在 Debug 和架构层面的稳定性优势更明显。

### 关于「去 AI 味」

一个设计小技巧：不要只对 AI 说「写个好看的面板」，给它具体的视觉参考，设计质量会明显提升。

我给 AI 扔了几个我喜欢的设计风格截图，它就能 output 出符合预期的东西。审美判断依然是决定成品质量的关键。

## 关于改名

项目最早叫「Clash Master」，上线后很快收到了社区反馈——Clash 这个词在某些场景下比较敏感。

想了想，改成「Neko Master」。

**Neko**（ねこ）在日语中意为「猫」，发音为 **/ˈneɪkoʊ/**（NEH-ko）。

如同猫一般安静而敏锐，Neko Master 专注于对网络流量进行轻量、精确的分析与可视化。

改名后也顺便做了一些品牌重设计，Logo 用 AI 多轮迭代优化，意外收到不少好评。

## 一周迭代复盘

项目上线一周，GitHub 破 1000 Star。趁这个机会，复盘一下迭代过程中的几个关键节点。

### Day 1: MVP 上线

第一版其实是个「能用就行」的状态，核心功能跑通就发布了。V2EX 发帖后，用户反馈来得很快：

- 端口冲突问题（3000 被占用）
- 连通性测试缺失
- Emoji 在节点名中显示异常

这些问题当晚就修了，v1.0.3 发布。

### Day 3: I/O 问题暴露

有用户反馈 SQLite 写入量过大，一天能跑出十几 GB 的硬盘 I/O。

这块确实是我的盲区。数据持久化策略一开始没想清楚，逐条写入的方式在高频场景下完全扛不住。

v1.0.6 引入了批量写入 + 内存缓冲，v1.0.8 进一步加了 30 秒刷新机制。最终日均 I/O 从 200GB 降到了 1.6GB 左右。

### Day 5: WebSocket 实时推送

HTTP 轮询的方式延迟有 5 秒左右，用户体验不够好。v1.1.4 加了 WebSocket 支持，配合反向代理配置，实时性提升明显。

### Day 7: Surge 支持

社区里有不少 Surge 用户希望接入。v1.2.7 完成了 Surge HTTP API 的适配，虽然是轮询模式（Surge 不支持 WebSocket 实时流），但 2 秒延迟也在可接受范围内。

## 一些开发体感

### AI 辅助开发的边界

这次实践让我对「AI 能做到什么程度」有了更具体的感知。

**AI 擅长：**
- 快速搭建项目骨架
- 生成 CRUD 逻辑
- 根据参考实现 UI
- 处理重复性高的代码

**AI 不擅长：**
- 处理复杂的性能问题（如 SQLite I/O 优化）
- 做架构层面的决策
- 处理边界条件和异常情况
- 理解业务上下文中的隐含需求

这些问题还是需要人来把控。AI 可以写代码，但系统设计需要人的判断。

### 开源项目的维护成本

上线后才发现，用户的使用场景远比预想的复杂：

- 有人跑在 OpenWrt 上
- 有人跑在群晖 Docker 里
- 有人用 Cloudflare Tunnel
- 有人用 Nginx 反向代理
- 还有人想跑在 ROS 上

每种环境都有不同的坑。文档写得再详细，也覆盖不了所有情况。

最终我选择在 GitHub Issues 里集中处理，同时把常见问题整理到 FAQ 里。目前 Issues 还能应付，但长期来看，社区自治可能是更好的方向。

## 技术栈

简单列一下：

- **框架**：Next.js 15 + React 19
- **语言**：TypeScript
- **样式**：Tailwind CSS 4 + shadcn/ui
- **数据库**：SQLite（默认）/ ClickHouse（可选）
- **部署**：Docker / Docker Compose
- **实时通信**：WebSocket

架构层面，采用 Monorepo 结构，分了 web、collector、agent 三个应用：

- **web**：前端界面 + API 路由
- **collector**：数据采集服务，负责从 Clash/Surge 拉取数据
- **agent**：可选的代理采集器，用于分布式部署场景

## 数据流向

```
Clash/Surge API → Collector → SQLite/ClickHouse → Web UI
                      ↓
                  WebSocket → Real-time Updates
```

数据采集使用 WebSocket（Clash）或 HTTP 轮询（Surge），存入 SQLite 后通过 Next.js API 暴露给前端。ClickHouse 作为可选的存储后端，适合数据量大的场景。

## 在线演示

**演示地址**：[https://neko-master.is26.com](https://neko-master.is26.com)

**访问密码**：`neko2026`

演示站为只读展示模式，部分功能受限。

## 写在最后

这个项目的出发点很简单——解决自己的痛点。

我是一个喜欢折腾网络的人，但又不想花太多时间在看日志上。Neko Master 算是把「看流量」这件事变得稍微优雅了一点。

MIT 开源，代码在这里：[https://github.com/foru17/neko-master](https://github.com/foru17/neko-master)

如果你家里也在用 OpenClash / Mihomo / Surge，欢迎体验。

---

*P.S. 关于 Logo，全程用 AI 生成，没用任何传统设计工具。另一个感受是：在 AI 时代，代码的门槛在下降，但审美判断依然是决定成品质量的关键。*
