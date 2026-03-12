import test from "node:test";
import assert from "node:assert/strict";
import {
  extractCurrentArticleQuestionFacts,
  extractRelevantArticleExcerpts,
} from "../article-chat-excerpts.ts";

test("extractRelevantArticleExcerpts should surface lodging details from the current article", () => {
  const content = `这一次我们在旧金山只做了短暂停留。

太浩湖是加州著名的度假胜地，这一次我们同美国的朋友9人一起约周末滑雪，在南太浩湖租了一个大别墅，一晚三千多人民币，里面有四个卧室，平摊下来价格倒也还好。

滑完雪，朋友们开车回旧金山了，我和杨左在太浩湖多呆了一天。`;

  const excerpts = extractRelevantArticleExcerpts(content, "太浩湖住哪里？");

  assert.ok(excerpts.length > 0);
  assert.match(excerpts[0] ?? "", /南太浩湖租了一个大别墅/);
});

test("extractCurrentArticleQuestionFacts should surface ordered travel route facts", () => {
  const content = `这一次的行程，我们依旧选择从旧金山出发。

下午，就约上在美国工作和定居的大学同学，一起出发前往我们的第一个目的地：太浩湖。

中午，在太浩湖买了点东西，出发前往优胜美地。

干脆今晚就挤一挤时间，赶下夜路先回内华达首府 Carson City 卡森市。

本来计划今天出发前往伊利，然后明天再从伊利出发去盐湖城。

第二天，前往拱门国家公园。

在拱门国家公园逛了四五个小时，下午准备出发去纪念碑谷。

又来到了这个地方，马蹄湾。

下午5点从马蹄湾出发，晚上10点到达拉斯维加斯。

第二天，前往这次旅行我们最后的目的地:死亡谷。`;

  const facts = extractCurrentArticleQuestionFacts(content, "这次旅行你总共去了哪些地方？");

  assert.ok(facts.length >= 6);
  assert.match(facts.join("\n"), /旧金山/);
  assert.match(facts.join("\n"), /太浩湖/);
  assert.match(facts.join("\n"), /优胜美地/);
  assert.match(facts.join("\n"), /Carson City|卡森市/);
  assert.match(facts.join("\n"), /盐湖城/);
  assert.match(facts.join("\n"), /拱门国家公园/);
  assert.match(facts.join("\n"), /纪念碑谷/);
  assert.match(facts.join("\n"), /马蹄湾/);
  assert.match(facts.join("\n"), /拉斯维加斯/);
  assert.match(facts.join("\n"), /死亡谷/);
});

test("extractCurrentArticleQuestionFacts should surface lodging facts from the current trip instead of profile data", () => {
  const content = `除了第一天酒店和最后两天川普饭店是提前预定，其他所有酒店，都是在路上随便订的。

太浩湖是加州著名的度假胜地，这一次我们同美国的朋友9人一起约周末滑雪，在南太浩湖租了一个大别墅，一晚三千多人民币，里面有四个卧室。

优胜美地住宿昂贵，我们并没有进入优胜美地国家公园住宿，而是住在优胜美地国家公园南侧40多英里的马里波萨。

Carson City卡森是内华达州的首府，到达 Carson 这天，旅店前台是一个50多岁的大叔。

在卡森的第二晚，依旧住昨晚那家酒店。

HOTEL NEVADA，夜晚到达小城伊利。

回到拉斯维加斯，入住川普饭店，这也是我们行程最后的终点了。`;

  const facts = extractCurrentArticleQuestionFacts(content, "你都住哪里呢？");

  assert.ok(facts.length >= 4);
  assert.match(facts.join("\n"), /南太浩湖租了一个大别墅/);
  assert.match(facts.join("\n"), /马里波萨/);
  assert.match(facts.join("\n"), /HOTEL NEVADA/);
  assert.match(facts.join("\n"), /川普饭店/);
  assert.doesNotMatch(facts.join("\n"), /深圳|上海|北京/);
});
