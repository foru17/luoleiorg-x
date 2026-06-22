import { getAISeo, getAISummary } from "./ai-data";
import { getAllPosts } from "./posts";
import { siteConfig } from "@/lib/site-config";

interface CategoryDescriptor {
  text: string;
  name: string;
  description: string;
}

const CATEGORY_DESCRIPTORS: CategoryDescriptor[] = [
  {
    text: "code",
    name: "编程开发",
    description:
      "前端、全栈、Node.js、TypeScript、Cloudflare Workers、AI 工程实践等技术分享。",
  },
  {
    text: "tech",
    name: "数码科技",
    description: "电子产品评测、Mac/Homelab/NAS 折腾、效率工具与软件推荐。",
  },
  {
    text: "travel",
    name: "旅行见闻",
    description: "城市漫游、海外旅行、咖啡馆与小众目的地的随笔记录。",
  },
  {
    text: "lifestyle",
    name: "生活方式",
    description: "对独立创作、产品消费、个人成长与日常思考的总结。",
  },
  {
    text: "photography",
    name: "摄影记录",
    description: "街拍、风光、人像作品集与摄影器材使用心得。",
  },
  {
    text: "run",
    name: "跑步与马拉松",
    description: "六大满贯之路、训练计划、装备选择与赛事复盘。",
  },
  {
    text: "zuoluotv",
    name: "ZUOLUOTV 视频",
    description: "B 站 / YouTube 频道 ZUOLUOTV 的视频内容索引。",
  },
];

function clean(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim();
}

function getDescription(slug: string, fallback: string): string {
  const seo = getAISeo(slug);
  if (seo?.metaDescription) return seo.metaDescription;
  const summary = getAISummary(slug);
  if (summary?.summary) return summary.summary;
  return fallback;
}

export function buildLlmsTxt(): string {
  const posts = getAllPosts();
  const lines: string[] = [];

  lines.push(`# ${siteConfig.title}`);
  lines.push("");
  lines.push(`> ${siteConfig.description}`);
  lines.push("");
  lines.push("## 关于作者");
  lines.push("");
  lines.push(
    `${siteConfig.author.name}（${siteConfig.siteUrl}）是一名常驻深圳的全栈开发者、独立创作者、摄影师与马拉松跑者。本博客记录他在编程、AI、出海、摄影、旅行与跑步等方向上的实践与思考，文章使用简体中文撰写，自 2011 年持续更新至今。`,
  );
  lines.push("");
  lines.push("## 关键入口");
  lines.push("");
  lines.push(`- [博客首页](${siteConfig.siteUrl}/): 最新文章与导航`);
  lines.push(
    `- [关于作者](${siteConfig.siteUrl}/about): 由多家 AI 模型基于历年文章、X 推文与 GitHub 经历自动总结的作者画像`,
  );
  lines.push(`- [作者画像 JSON](${siteConfig.siteUrl}/api/profile): 站点元信息 + 作者结构化画像 + 统计`);
  lines.push(`- [RSS 订阅](${siteConfig.siteUrl}/rss.xml): 全文 RSS Feed`);
  lines.push(
    `- [全部文章索引](${siteConfig.siteUrl}/llms-full.txt): 所有可被引用文章的标题、链接、Markdown 与 AI 摘要`,
  );
  lines.push(`- [Sitemap](${siteConfig.siteUrl}/sitemap.xml): 站点地图`);
  lines.push(
    `- [博客源码](https://github.com/${siteConfig.contentRepo.owner}/${siteConfig.contentRepo.repo}): 本博客在 GitHub 的开源仓库`,
  );
  lines.push("");
  lines.push("## 社交与作品");
  lines.push("");
  lines.push(`- GitHub: ${siteConfig.social.github}`);
  lines.push(`- X / Twitter: https://x.com/${siteConfig.author.twitterUsername}`);
  lines.push(`- YouTube: ${siteConfig.social.youtube}`);
  lines.push(`- Bilibili: ${siteConfig.social.bilibili}`);
  lines.push(`- Unsplash: https://unsplash.com/@${siteConfig.author.unsplash}`);
  lines.push(`- Email: ${siteConfig.author.email}`);
  lines.push("");
  lines.push("## 内容分类");
  lines.push("");

  for (const cat of CATEGORY_DESCRIPTORS) {
    const list = posts.filter((p) => p.categories.includes(cat.text));
    if (list.length === 0) continue;

    lines.push(`### ${cat.name} (/${cat.text})`);
    lines.push("");
    lines.push(cat.description);
    lines.push("");
    lines.push(`共 ${list.length} 篇文章。代表作品：`);
    lines.push("");

    for (const post of list.slice(0, 5)) {
      const desc = clean(getDescription(post.slug, post.excerpt)).slice(0, 160);
      lines.push(
        `- [${post.title}](${siteConfig.siteUrl}/${post.slug}) (${post.date})${desc ? `: ${desc}` : ""}`,
      );
    }
    lines.push("");
  }

  lines.push("## 使用说明");
  lines.push("");
  lines.push(
    "本文件遵循 https://llmstxt.org/ 提案，方便 LLM、AI 助手与检索引擎快速理解本站结构。每篇文章都额外提供一个 `.md` 路由（例如 `/luolei-ai.md`），可直接拿到带 frontmatter 的原文。完整文章列表见 llms-full.txt。",
  );
  lines.push("");
  lines.push(
    `本站欢迎 AI 检索（OAI-SearchBot、Claude-SearchBot、PerplexityBot 等）抓取并引用文章内容；屏蔽以训练为目的的爬虫（GPTBot、ClaudeBot、Google-Extended、Bytespider 等），相关策略可见 ${siteConfig.siteUrl}/robots.txt。`,
  );
  lines.push("");
  lines.push(`最后更新：${new Date().toISOString()}`);
  lines.push("");

  return lines.join("\n");
}

export function buildLlmsFullTxt(): string {
  const posts = getAllPosts();
  const lines: string[] = [];

  lines.push(`# ${siteConfig.title} · 全部文章`);
  lines.push("");
  lines.push(`> ${siteConfig.description}`);
  lines.push("");
  lines.push(
    `本文件包含 ${siteConfig.siteUrl} 上所有公开发布的文章列表，每篇带 AI 生成的摘要，按发布时间倒序排列。摘要由作者使用 GPT-5 / Gemini 系列模型基于原文生成，可作为检索与引用入口；想获取全文可访问对应 URL 或 .md 路由。`,
  );
  lines.push("");
  lines.push(`总文章数：${posts.length} 篇`);
  lines.push(`最后更新：${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const post of posts) {
    const desc = clean(getDescription(post.slug, post.excerpt));
    lines.push(`## ${post.title}`);
    lines.push("");
    lines.push(`- URL: ${siteConfig.siteUrl}/${post.slug}`);
    lines.push(`- Markdown: ${siteConfig.siteUrl}/${post.slug}.md`);
    lines.push(`- 发布日期: ${post.date}`);
    if (post.categories.length > 0) {
      lines.push(`- 分类: ${post.categories.join(", ")}`);
    }
    lines.push("");
    if (desc) {
      lines.push(desc);
      lines.push("");
    }
  }

  return lines.join("\n");
}
