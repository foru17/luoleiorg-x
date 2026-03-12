import test from "node:test";
import assert from "node:assert/strict";
import { buildArticleChatGuideContent } from "../article-chat-guide-utils.js";

test("should prefer AI-generated reader questions and normalize formatting", () => {
  const guide = buildArticleChatGuideContent(
    {
      title: "美国 | 美西8000里:蜜月旅行，再续「前」缘",
      categories: ["travel", "photography"],
    },
    {
      openingLine: "可以先陪你理清这趟行程和最值得展开的细节",
      focusQuestions: [
        "1. 这次一共去了哪些地方",
        "- 太浩湖住哪里",
        "预算大概多少",
      ],
      extensionTopics: [
        "还有哪篇美国自驾可以一起看",
        "如果冬天去最该注意什么",
      ],
    },
  );

  assert.equal(guide.openingLine, "可以先陪你理清这趟行程和最值得展开的细节。");
  assert.deepEqual(guide.focusQuestions, [
    "这次一共去了哪些地方？",
    "太浩湖住哪里？",
    "预算大概多少？",
  ]);
  assert.deepEqual(guide.extensionTopics, [
    "还有哪篇美国自驾可以一起看？",
    "如果冬天去最该注意什么？",
  ]);
});

test("should fall back to generic prompts when AI guide data is missing", () => {
  const guide = buildArticleChatGuideContent({
    title: "2026 年，我把自己做成了一个 AI",
    categories: ["code"],
  });

  assert.equal(
    guide.openingLine,
    "我可以先帮你理清这篇文章的主线，再继续聊你关心的细节。",
  );
  assert.deepEqual(guide.focusQuestions, [
    "这篇文章最值得先抓住的重点是什么？",
    "文里最值得继续展开的细节是哪一块？",
    "如果我想顺着这篇继续问，最该从哪里开始？",
  ]);
  assert.deepEqual(guide.extensionTopics, [
    "这篇和站里哪几篇内容适合一起看？",
    "如果想顺着这篇继续聊，还能展开什么？",
  ]);
});

test("should fall back to generic opening line when AI copy is too performative", () => {
  const guide = buildArticleChatGuideContent(
    {
      title: "2024年:我用的手机和宽带套餐",
      categories: ["tech"],
    },
    {
      openingLine: "年底了也该盘盘自己的话费账单，这位博主把几张卡掰扯得挺清楚。",
      focusQuestions: ["哪张卡最值得留？", "公网 IP 现在还好办吗？"],
      extensionTopics: ["如果只留一条宽带该选哪家？"],
    },
  );

  assert.equal(
    guide.openingLine,
    "我可以先帮你理清这篇文章的主线，再继续聊你关心的细节。",
  );
});

test("should coerce newline question strings into guide arrays", () => {
  const guide = buildArticleChatGuideContent(
    {
      title: "香港银行开户",
      categories: ["lifestyle"],
    },
    {
      openingLine: "可以先陪你看这篇里的关键准备项",
      focusQuestions: "开户前要准备什么？\n哪家银行门槛更低？\n现场会被问什么？",
      extensionTopics: "如果没有香港地址怎么办？\n这篇和哪篇可以一起看？",
    },
  );

  assert.deepEqual(guide.focusQuestions, [
    "开户前要准备什么？",
    "哪家银行门槛更低？",
    "现场会被问什么？",
  ]);
  assert.deepEqual(guide.extensionTopics, [
    "如果没有香港地址怎么办？",
    "这篇和哪篇可以一起看？",
  ]);
});
