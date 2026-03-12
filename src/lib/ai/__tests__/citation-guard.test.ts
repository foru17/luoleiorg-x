import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCitationGuard,
  createCitationGuardTransform,
  getCitationGuardPreflight,
} from "../citation-guard.ts";
import type {
  ArticleContext,
  ProjectContext,
  TweetContext,
} from "../chat-prompt.ts";

const emptyTweets: TweetContext[] = [];
const emptyProjects: ProjectContext[] = [];
const emptyArticles: ArticleContext[] = [];

test("unknown answers should be replaced with a concise refusal", () => {
  const result = applyCitationGuard({
    userQuery: "你现在每个月赚多少钱？",
    answerText:
      "这个具体数字我没在博客里留记录。\n\n2018年辞职离开阅文的时候，我写过一篇文章，里面提过一些选择。",
    articles: emptyArticles,
    tweets: emptyTweets,
    projects: emptyProjects,
  });

  assert.equal(result.text, "收入这类信息未公开，我不提供。");
  assert.deepEqual(result.actions, [{ type: "replace_unknown_with_refusal" }]);
});

test("fact answers without known citations should append one direct source", () => {
  const projects: ProjectContext[] = [
    {
      name: "Neko Master",
      url: "https://github.com/foru17/neko-master",
      description: "开源家庭网络流量分析工具，支持 ClickHouse 和 AI 工作流。",
    },
  ];

  const result = applyCitationGuard({
    userQuery: "Neko Master 是什么？",
    answerText: "Neko Master 是我做的一个开源家庭网络流量分析工具。",
    articles: emptyArticles,
    tweets: emptyTweets,
    projects,
  });

  assert.match(result.text, /相关项目：\[Neko Master\]\(https:\/\/github\.com\/foru17\/neko-master\)/u);
  assert.deepEqual(result.actions, [
    {
      type: "append_direct_source_citation",
      sourceKind: "project",
      sourceTitle: "Neko Master",
      sourceUrl: "https://github.com/foru17/neko-master",
    },
  ]);
});

test("travel yes-no fact answers should fall back to the strongest direct source", () => {
  const articles: ArticleContext[] = [
    {
      title: "大陆居民申请尼泊尔签证（香港领事馆）2014最新攻略",
      url: "https://luolei.org/da-lu-ju-min-shen-qing-ni-bo-er-qian-zheng-xiang-gang-ling-shi-guan-2014zui-xin-gong-lue",
      summary: "作者分享尼泊尔签证办理流程和领事馆加急经验。",
      keyPoints: ["加急办理", "香港领事馆"],
      categories: [],
    },
    {
      title: "「等风来:博卡拉滑翔伞飞翔」尼泊尔随记(贰)",
      url: "https://luolei.org/trave-in-nepal-paragliding",
      summary: "作者记录尼泊尔博卡拉滑翔伞体验，从电影《等风来》引入。",
      keyPoints: ["博卡拉滑翔伞统一收费8000卢比"],
      categories: ["travel"],
    },
  ];

  const result = applyCitationGuard({
    userQuery: "你去过尼泊尔吗？",
    answerText:
      "去过，而且去了不止一次。\n\n最经典的是 [EBC（珠峰大本营）徒步](https://luolei.org/ebc-trekking)。",
    articles,
    tweets: emptyTweets,
    projects: emptyProjects,
  });

  assert.match(result.text, /^去过。/u);
  assert.match(result.text, /博卡拉/u);
  assert.match(result.text, /\[「等风来:博卡拉滑翔伞飞翔」尼泊尔随记\(贰\)\]\(https:\/\/luolei\.org\/trave-in-nepal-paragliding\)/u);
  assert.deepEqual(result.actions, [
    {
      type: "replace_travel_fact_with_grounded_source",
      sourceKind: "article",
      sourceTitle: "「等风来:博卡拉滑翔伞飞翔」尼泊尔随记(贰)",
      sourceUrl: "https://luolei.org/trave-in-nepal-paragliding",
    },
  ]);
});

test("citation guard preflight should short-circuit unknown queries", () => {
  const result = getCitationGuardPreflight({
    userQuery: "你现在每个月赚多少钱？",
    articles: emptyArticles,
    tweets: emptyTweets,
    projects: emptyProjects,
  });

  assert.deepEqual(result, {
    text: "收入这类信息未公开，我不提供。",
    actions: [{ type: "replace_unknown_with_refusal" }],
  });
});

test("citation guard transform should stream text before appending citation", async () => {
  const projects: ProjectContext[] = [
    {
      name: "Neko Master",
      url: "https://github.com/foru17/neko-master",
      description: "开源家庭网络流量分析工具，支持 ClickHouse 和 AI 工作流。",
    },
  ];

  const transform = createCitationGuardTransform({
    userQuery: "Neko Master 是什么？",
    articles: emptyArticles,
    tweets: emptyTweets,
    projects,
  })({
    tools: {},
    stopStream() {},
  });

  const input = new ReadableStream({
    start(controller) {
      controller.enqueue({ type: "text-start", id: "answer-1" });
      controller.enqueue({ type: "text-delta", id: "answer-1", text: "Neko Master " });
      controller.enqueue({ type: "text-delta", id: "answer-1", text: "是我做的一个开源家庭网络流量分析工具。" });
      controller.enqueue({ type: "text-end", id: "answer-1" });
      controller.close();
    },
  });

  const reader = input.pipeThrough(transform).getReader();
  const chunks: Array<Record<string, unknown>> = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Record<string, unknown>);
  }

  assert.deepEqual(chunks[0], { type: "text-start", id: "answer-1" });
  assert.deepEqual(chunks[1], { type: "text-delta", id: "answer-1", text: "Neko Master " });
  assert.deepEqual(chunks[2], {
    type: "text-delta",
    id: "answer-1",
    text: "是我做的一个开源家庭网络流量分析工具。",
  });
  assert.equal(chunks.at(-1)?.type, "text-end");
  assert.match(String(chunks[3]?.text), /相关项目/u);
});
