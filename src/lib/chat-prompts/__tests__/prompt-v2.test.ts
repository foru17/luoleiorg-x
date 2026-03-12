import test from "node:test";
import assert from "node:assert/strict";
import { getChatPromptRuntimeConfig } from "../config.ts";
import { buildCoreIdentity } from "../core-identity.ts";
import { buildCoreRules, fallbackResponseTemplates } from "../core-rules.ts";
import {
  rankArticlesByIntent,
  resolveAnswerMode,
  resolveVoiceStyleMode,
} from "../intent-ranking.ts";
import { buildRuntimeContext } from "../runtime-context.ts";
import type { ArticleContext, CurrentArticleContext, TweetContext } from "../types.ts";

function createArticle(params: {
  title: string;
  categories: string[];
  summary: string;
  keyPoints: string[];
  daysAgo?: number;
}): ArticleContext {
  return {
    title: params.title,
    url: `https://luolei.org/${encodeURIComponent(params.title)}`,
    categories: params.categories,
    summary: params.summary,
    keyPoints: params.keyPoints,
    dateTime: Date.now() - (params.daysAgo ?? 30) * 24 * 60 * 60 * 1000,
  };
}

function createTweet(params: {
  title: string;
  text: string;
  date: string;
  daysAgo?: number;
}): TweetContext {
  return {
    title: params.title,
    url: `https://x.com/luoleiorg/status/${encodeURIComponent(params.title)}`,
    text: params.text,
    date: params.date,
    dateTime: Date.now() - (params.daysAgo ?? 30) * 24 * 60 * 60 * 1000,
  };
}

const articlePool: ArticleContext[] = [
  createArticle({
    title: "AI 分身架构实战：RAG 与 Agent",
    categories: ["code", "ai"],
    summary: "从 embedding 到 RAG 检索，再到 Agent 对话编排。",
    keyPoints: ["LLM", "Prompt", "向量检索"],
    daysAgo: 5,
  }),
  createArticle({
    title: "Cloudflare + Wrangler + Docker 的 Homelab 运维实践",
    categories: ["code", "devops"],
    summary: "通过 cloudflare、wrangler、openwrt 组合构建家庭实验室。",
    keyPoints: ["Prometheus", "Nginx", "OpenWrt"],
    daysAgo: 20,
  }),
  createArticle({
    title: "Next.js 与 React 全栈 SEO 指南",
    categories: ["code", "frontend"],
    summary: "围绕 nextjs、react、typescript 的 SEO 与渲染策略。",
    keyPoints: ["TS", "SSR", "Metadata"],
    daysAgo: 40,
  }),
  createArticle({
    title: "东京晨跑与镰仓摄影旅行",
    categories: ["travel", "photography"],
    summary: "东京、镰仓、香港徒步与摄影记录。",
    keyPoints: ["旅行", "摄影", "马拉松"],
    daysAgo: 60,
  }),
  createArticle({
    title: "深圳医院验光与眼镜消费体验",
    categories: ["lifestyle"],
    summary: "医院验光流程、眼镜消费和生活方式体验复盘。",
    keyPoints: ["眼镜", "医院", "消费体验"],
    daysAgo: 15,
  }),
  createArticle({
    title: "随手记：与主题无关的杂谈",
    categories: ["misc"],
    summary: "没有明显关键词。",
    keyPoints: ["随笔"],
    daysAgo: 10,
  }),
];

test("core rules should include mandatory contracts and fixed templates", () => {
  const rules = buildCoreRules();

  assert.match(rules, /来源限制协议/);
  assert.match(rules, /数字协议/);
  assert.match(rules, /履历协议/);
  assert.match(rules, /链接协议/);

  assert.match(rules, new RegExp(fallbackResponseTemplates.missingProfile));
  assert.match(rules, new RegExp(fallbackResponseTemplates.missingNumber));
  assert.match(rules, new RegExp(fallbackResponseTemplates.emptySearch));
  assert.match(rules, new RegExp(fallbackResponseTemplates.searchGuidance));

  assert.equal((rules.match(/来源限制协议/g) ?? []).length, 1);
  assert.equal((rules.match(/数字协议/g) ?? []).length, 1);
  assert.equal((rules.match(/履历协议/g) ?? []).length, 1);
  assert.equal((rules.match(/链接协议/g) ?? []).length, 1);
  assert.match(rules, /来源分层协议/);
  assert.match(rules, /回答模式协议/);
  assert.match(rules, /L1「相关文章\/相关动态」/);
  assert.match(rules, /recommendation 先给 2-4 个推荐项/);
  assert.match(rules, /禁止输出内部证据编号（如 A1、T1、\[A、\[T）/);
});

test("intent ranking should be stable and relevant for 10 typical queries", () => {
  const cases = [
    { query: "RAG 数字分身 agent 怎么做", expectedTop: "AI 分身架构实战：RAG 与 Agent" },
    { query: "cloudflare wrangler docker 运维", expectedTop: "Cloudflare + Wrangler + Docker 的 Homelab 运维实践" },
    { query: "Next.js React TS SEO", expectedTop: "Next.js 与 React 全栈 SEO 指南" },
    { query: "东京 旅行 摄影", expectedTop: "东京晨跑与镰仓摄影旅行" },
    { query: "眼镜 医院 体验", expectedTop: "深圳医院验光与眼镜消费体验" },
    { query: "推荐 react ts 文章", expectedTop: "Next.js 与 React 全栈 SEO 指南" },
    { query: "openwrt nginx homelab", expectedTop: "Cloudflare + Wrangler + Docker 的 Homelab 运维实践" },
    { query: "LLM prompt embedding", expectedTop: "AI 分身架构实战：RAG 与 Agent" },
    { query: "香港 徒步 跑步", expectedTop: "东京晨跑与镰仓摄影旅行" },
    { query: "消费体验 生活方式", expectedTop: "深圳医院验光与眼镜消费体验" },
  ] as const;

  for (const item of cases) {
    const { rankedArticles } = rankArticlesByIntent({
      query: item.query,
      articles: articlePool,
      enabled: true,
    });

    assert.equal(rankedArticles[0]?.title, item.expectedTop, `query: ${item.query}`);
  }
});

test("unknown intent should fallback to original article order", () => {
  const baseline = [articlePool[2], articlePool[0], articlePool[1]];
  const { intent, rankedArticles } = rankArticlesByIntent({
    query: "今天心情如何",
    articles: baseline,
    enabled: true,
  });

  assert.equal(intent, "unknown");
  assert.deepEqual(
    rankedArticles.map((item) => item.title),
    baseline.map((item) => item.title),
  );
});

test("recent query should prefer the newest equally relevant article", () => {
  const marathonArticles = [
    createArticle({
      title: "长沙马拉松:回到 5 小时内",
      categories: ["lifestyle"],
      summary: "2024 年长沙马拉松完赛记录。",
      keyPoints: ["马拉松", "长沙", "4小时56分"],
      daysAgo: 500,
    }),
    createArticle({
      title: "京都马拉松: 第一次去日本跑马",
      categories: ["travel"],
      summary: "2025 年京都马拉松完赛记录。",
      keyPoints: ["马拉松", "京都", "完赛"],
      daysAgo: 380,
    }),
  ];

  const { rankedArticles } = rankArticlesByIntent({
    query: "你最近一次公开写的马拉松是哪一场？",
    articles: marathonArticles,
    enabled: true,
  });

  assert.equal(rankedArticles[0]?.title, "京都马拉松: 第一次去日本跑马");
});

test("default prompt config should not hide public pet highlights", () => {
  const config = getChatPromptRuntimeConfig();

  assert.deepEqual(config.sensitiveHighlightPatterns, []);
});

test("voice style mode should match query intent", () => {
  assert.equal(resolveVoiceStyleMode("Cloudflare Workers 和 Docker 怎么部署"), "technical");
  assert.equal(resolveVoiceStyleMode("东京旅行有什么推荐"), "recommendation");
  assert.equal(resolveVoiceStyleMode("你最近一次去京都跑马是什么体验"), "travel");
  assert.equal(resolveVoiceStyleMode("最近生活上有什么折腾"), "life");
  assert.equal(resolveVoiceStyleMode("你今天心情如何"), null);
});

test("answer mode should match query shape", () => {
  assert.equal(resolveAnswerMode("你过去都在哪些公司工作过？"), "timeline");
  assert.equal(resolveAnswerMode("你去过哪些国家？"), "list");
  assert.equal(resolveAnswerMode("你去过日本几次？"), "count");
  assert.equal(resolveAnswerMode("你怎么看 AI 对开发者的影响？"), "opinion");
  assert.equal(resolveAnswerMode("如果第一次看你的博客，你会推荐我先读哪几篇？"), "recommendation");
  assert.equal(resolveAnswerMode("你老婆叫什么名字？"), "unknown");
  assert.equal(resolveAnswerMode("介绍一下你自己"), "fact");
});

test("runtime context should include current article full text for article-scoped questions", () => {
  const currentArticle: CurrentArticleContext = {
    slug: "digital-nomad-ids",
    title: "实现 AI 自由：我为未来准备的 4 个数字通行证",
    url: "https://luolei.org/digital-nomad-ids",
    summary: "围绕数字通行证的配置思路。",
    keyPoints: ["海外手机号", "国际邮箱", "虚拟信用卡"],
    categories: ["ai", "digital-nomad"],
    questionFacts: ["我把这套数字通行证分成四层：海外手机号、国际邮箱、虚拟信用卡，以及海外身份验证工具。"],
    fullContent: `我把这套数字通行证分成四层：海外手机号、国际邮箱、虚拟信用卡，以及可长期使用的海外身份验证工具。

其中海外实体 SIM 卡是接收国际服务验证码的基础保障。很多海外服务会校验注册手机号是否真实可用。`,
  };

  const runtime = buildRuntimeContext({
    articles: [],
    tweets: [],
    projects: [],
    userQuery: "海外实体 SIM 卡为什么是基础保障？",
    config: getChatPromptRuntimeConfig(),
    currentArticle,
  });

  assert.match(runtime, /正文全文（优先直接阅读这里，不要只看摘要）/);
  assert.match(runtime, /海外实体 SIM 卡是接收国际服务验证码的基础保障/);
  assert.match(runtime, /针对当前问题最直接的原文事实/);
  assert.match(runtime, /语义消歧：如果用户在当前文章里问“你住哪里 \/ 去了哪些地方 \/ 花了多少 \/ 怎么走”这类问题/);
  assert.match(runtime, /先使用 L0 的正文全文直接回答/);
  assert.ok(runtime.indexOf("## 当前阅读文章") < runtime.indexOf("## 关于你"));
});

test("core identity should only inject the active voice mode", () => {
  const recommendationIdentity = buildCoreIdentity("推荐几篇 AI RAG 入门文章");

  assert.match(recommendationIdentity, /当前回答风格模式：推荐类回答（recommendation）/);
  assert.match(recommendationIdentity, /本轮表达参考：/);
  assert.match(recommendationIdentity, /## 语言风格（L5 style_only，仅影响表达）/);
  assert.doesNotMatch(recommendationIdentity, /技术类回答（technical）/);
  assert.doesNotMatch(recommendationIdentity, /旅行类回答（travel）/);
  assert.doesNotMatch(recommendationIdentity, /生活类回答（life）/);

  const neutralIdentity = buildCoreIdentity("你今天心情如何");

  assert.doesNotMatch(neutralIdentity, /当前回答风格模式：/);
});

test("runtime context should expose provenance layers and expected answer mode", () => {
  const runtime = buildRuntimeContext({
    articles: articlePool,
    tweets: [
      createTweet({
        title: "tweet-1",
        text: "最近在东京和京都之间来回折腾，顺手还跑了场马拉松。",
        date: "2025-02-20",
        daysAgo: 20,
      }),
    ],
    projects: [
      {
        name: "Raycast Sink",
        url: "https://github.com/foru17/raycast-sink",
        description: "基于 Cloudflare Sink 的 Raycast 插件。",
      },
    ],
    userQuery: "如果第一次看你的博客，你会推荐我先读哪几篇？",
    config: getChatPromptRuntimeConfig(),
  });

  assert.match(runtime, /## 关于你（L2 curated_public）/);
  assert.match(runtime, /## 结构化事实索引（L3 validated_derived，辅助参考）/);
  assert.match(runtime, /## 相关文章（博客，L1 authored_public）/);
  assert.match(runtime, /## 相关动态（X，L1 authored_public）/);
  assert.match(runtime, /## 相关项目\/经历（L2 curated_public）/);
  assert.match(runtime, /腾讯前端体验大会/);
  assert.match(runtime, /内部技术分享讲师/);
  assert.match(runtime, /预期回答模式：recommendation/);
  assert.match(runtime, /模式提示：先推荐 2-4 个具体项目\/文章/);
  assert.match(runtime, /来源优先级：L0 当前阅读文章 > L1 相关文章\/相关动态 > L2 关于你\/相关项目 > L3 结构化事实索引 > L5 语言风格/);
});
