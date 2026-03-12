import test from "node:test";
import assert from "node:assert/strict";
import {
  getChatEntryContextKey,
  GLOBAL_CHAT_CONTEXT,
  toChatRequestContext,
} from "../chat-context.ts";

test("getChatEntryContextKey should distinguish global and article scopes", () => {
  assert.equal(getChatEntryContextKey(GLOBAL_CHAT_CONTEXT), "global");
  assert.equal(
    getChatEntryContextKey({
      scope: "article",
      article: {
        slug: "ai-2026",
        title: "2026 年，我把自己做成了一个 AI",
      },
    }),
    "article:ai-2026",
  );
});

test("toChatRequestContext should keep article scope payload for article chat", () => {
  const context = toChatRequestContext({
    scope: "article",
    article: {
      slug: "ai-2026",
      title: "2026 年，我把自己做成了一个 AI",
      categories: ["ai"],
      summary: "把公开内容做成可聊天的 AI 分身。",
      abstract: "文章级 AI 架构复盘。",
      keyPoints: ["RAG", "提示词", "安全约束"],
      relatedSlugs: ["luolei-ai"],
      focusQuestions: ["这篇文章最值得记住的 3 个重点是什么？"],
      openingLine: "我可以先帮你抓住这篇文章的主线。",
    },
  });

  assert.deepEqual(context, {
    scope: "article",
    article: {
      slug: "ai-2026",
      title: "2026 年，我把自己做成了一个 AI",
      categories: ["ai"],
      summary: "把公开内容做成可聊天的 AI 分身。",
      abstract: "文章级 AI 架构复盘。",
      keyPoints: ["RAG", "提示词", "安全约束"],
      relatedSlugs: ["luolei-ai"],
    },
  });
});
