import test from "node:test";
import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import type { CurrentArticleContext } from "../../chat-prompts/types.ts";
import {
  buildArticleConversationQuery,
  buildArticleEvidenceQuery,
  decideArticleIntent,
} from "../article-chat.ts";

const currentArticle: CurrentArticleContext = {
  slug: "digital-nomad-ids",
  title: "实现 AI 自由：我为未来准备的 4 个数字通行证",
  url: "https://luolei.org/digital-nomad-ids",
  summary: "作者分享为实现 AI 自由准备的 4 个数字通行证，包括海外手机号、国际邮箱、虚拟信用卡和海外身份验证工具。",
  keyPoints: ["海外手机号", "国际邮箱", "虚拟信用卡", "海外身份验证工具"],
  categories: ["ai", "digital-nomad"],
  fullContent: `我把这套数字通行证分成四层：海外手机号、国际邮箱、虚拟信用卡，以及可长期使用的海外身份验证工具。

其中海外实体 SIM 卡是接收国际服务验证码的基础保障。很多海外服务会校验注册手机号是否真实可用，也会在高风险操作时要求再次验证，因此只依赖国内号码会经常卡住。

如果要一步步搭建，我会优先从手机号和邮箱开始，再补齐支付和身份验证。`,
};

test("should treat article body details as current-article questions", () => {
  const decision = decideArticleIntent(
    "文中提到「海外实体SIM卡」是接收国际服务验证码的基础保障，背后的原因是什么？",
    currentArticle,
  );

  assert.equal(decision.mode, "article_detail");
  assert.equal(decision.shouldSearchSiteWide, false);
});

test("should keep short follow-up questions in current article scope", () => {
  const decision = decideArticleIntent("为什么？", currentArticle);

  assert.equal(decision.mode, "article_detail");
  assert.equal(decision.shouldSearchSiteWide, false);
});

test("should still allow explicit global shifts away from the current article", () => {
  const decision = decideArticleIntent("除了这篇之外，你最近还写过哪些相关文章？", currentArticle);

  assert.equal(decision.mode, "article_extension");
  assert.equal(decision.shouldSearchSiteWide, false);
});

test("should expand short article follow-up queries with recent user context", () => {
  const messages: UIMessage[] = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "这次旅行你总共去了哪些地方？" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "去了好几个地方。" }],
    },
    {
      id: "u2",
      role: "user",
      parts: [{ type: "text", text: "你都住哪里呢？" }],
    },
  ];

  const contextualQuery = buildArticleConversationQuery(messages);

  assert.match(contextualQuery, /这次旅行你总共去了哪些地方/);
  assert.match(contextualQuery, /你都住哪里呢/);
});

test("should keep topical article follow-up query focused on the latest question for evidence extraction", () => {
  const messages: UIMessage[] = [
    {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "这次旅行你总共去了哪些地方？" }],
    },
    {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "去了不少地方。" }],
    },
    {
      id: "u2",
      role: "user",
      parts: [{ type: "text", text: "你都住哪里呢？" }],
    },
  ];

  const evidenceQuery = buildArticleEvidenceQuery(messages);

  assert.equal(evidenceQuery, "你都住哪里呢？");
});
