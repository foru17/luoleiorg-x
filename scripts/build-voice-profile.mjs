#!/usr/bin/env node
/**
 * build-voice-profile.mjs
 *
 * 从博客标题、推文原文中提取作者的表达风格画像。
 * 不调用 AI，纯本地分析。
 *
 * 输入：
 *   - data/source-docs/posts.jsonl
 *   - data/source-docs/tweets.jsonl
 *
 * 输出：
 *   - data/voice-profile.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");

// ─── Helpers ──────────────────────────────────────────

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ─── 标题风格分析 ─────────────────────────────────────

function analyzeTitlePatterns(posts) {
  const patterns = {
    // 标题中的分隔符使用
    usesVerticalBar: 0, // "xxx | xxx"
    usesColon: 0, // "xxx:xxx" or "xxx：xxx"
    usesMiddleDot: 0, // "xxx・xxx"
    // 标题中的表达特征
    usesQuestion: 0, // 标题是问句
    usesEmoji: 0,
    usesEnglish: 0, // 中英混用
    usesYear: 0, // 标题带年份
    usesSeriesFormat: 0, // 系列文章 "xxx(壹)" "Day1"
  };

  for (const post of posts) {
    const title = post.title || "";
    if (title.includes("|") || title.includes("｜")) patterns.usesVerticalBar++;
    if (title.includes(":") || title.includes("：")) patterns.usesColon++;
    if (title.includes("・") || title.includes("·")) patterns.usesMiddleDot++;
    if (/[?？]/.test(title)) patterns.usesQuestion++;
    if (/[\u{1F300}-\u{1F9FF}]/u.test(title)) patterns.usesEmoji++;
    if (/[a-zA-Z]{3,}/.test(title)) patterns.usesEnglish++;
    if (/20\d{2}/.test(title)) patterns.usesYear++;
    if (/[壹贰叁肆伍陆柒捌玖拾]|Day\s?\d|Part\s?\d|[（(]\d[）)]/i.test(title))
      patterns.usesSeriesFormat++;
  }

  return {
    total: posts.length,
    patterns,
    // 归一化为百分比
    style: {
      vertical_bar_rate: Math.round((patterns.usesVerticalBar / posts.length) * 100),
      colon_rate: Math.round((patterns.usesColon / posts.length) * 100),
      question_rate: Math.round((patterns.usesQuestion / posts.length) * 100),
      english_mix_rate: Math.round((patterns.usesEnglish / posts.length) * 100),
      year_in_title_rate: Math.round((patterns.usesYear / posts.length) * 100),
    },
  };
}

// ─── 推文风格分析 ─────────────────────────────────────

function analyzeTweetPatterns(tweets) {
  const emojiCount = { total: 0, withEmoji: 0 };
  const lengthBuckets = { short: 0, medium: 0, long: 0 }; // <50, 50-140, >140
  const mentionCount = { total: 0, withMention: 0 };
  const hashtagCount = { total: 0, withHashtag: 0 };
  const urlCount = { total: 0, withUrl: 0 };
  const questionCount = { total: 0, withQuestion: 0 };

  // 收集高互动推文用于提取表达样本
  const topTweets = tweets
    .filter((t) => t.text && t.metrics)
    .sort((a, b) => (b.metrics?.likes || 0) - (a.metrics?.likes || 0))
    .slice(0, 20);

  for (const tweet of tweets) {
    const text = tweet.text || "";
    emojiCount.total++;
    if (/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(text))
      emojiCount.withEmoji++;

    const len = text.length;
    if (len < 50) lengthBuckets.short++;
    else if (len <= 140) lengthBuckets.medium++;
    else lengthBuckets.long++;

    mentionCount.total++;
    if (/@\w+/.test(text)) mentionCount.withMention++;

    hashtagCount.total++;
    if (/#\w+/.test(text)) hashtagCount.withHashtag++;

    urlCount.total++;
    if (/https?:\/\//.test(text)) urlCount.withUrl++;

    questionCount.total++;
    if (/[?？]/.test(text)) questionCount.withQuestion++;
  }

  return {
    total: tweets.length,
    length_distribution: {
      short_pct: Math.round((lengthBuckets.short / tweets.length) * 100),
      medium_pct: Math.round((lengthBuckets.medium / tweets.length) * 100),
      long_pct: Math.round((lengthBuckets.long / tweets.length) * 100),
    },
    emoji_rate: Math.round((emojiCount.withEmoji / tweets.length) * 100),
    question_rate: Math.round((questionCount.withQuestion / tweets.length) * 100),
    url_share_rate: Math.round((urlCount.withUrl / tweets.length) * 100),
    top_tweet_samples: topTweets.map((t) => ({
      text: t.text.slice(0, 200),
      likes: t.metrics?.likes || 0,
    })),
  };
}

// ─── 表达习惯提取 ─────────────────────────────────────

function extractExpressionHabits(posts, tweets) {
  // 从标题和推文中提取常见转折/连接词
  const connectors = {};
  const allTexts = [
    ...posts.map((p) => p.title || ""),
    ...tweets.map((t) => t.text || ""),
  ];

  const connectorPatterns = [
    "其实", "说实话", "不过", "但是", "所以", "然后",
    "感觉", "突然", "顺手", "顺便", "随手",
    "折腾", "踩坑", "跳坑", "体验", "分享",
    "推荐", "安利", "种草",
  ];

  for (const text of allTexts) {
    for (const pattern of connectorPatterns) {
      if (text.includes(pattern)) {
        connectors[pattern] = (connectors[pattern] || 0) + 1;
      }
    }
  }

  // 按频率排序
  const sortedConnectors = Object.entries(connectors)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 15)
    .map(([word, count]) => ({ word, count }));

  return {
    frequent_expressions: sortedConnectors,
    style_notes: [
      "标题常用竖线分隔格式：「地名 | 主题」或「系列名 | 标题」",
      "技术类标题直接用英文术语，不强行翻译",
      "生活类标题偏感性，常用问句或感叹",
      "推文风格简短直接，常带 emoji",
      "喜欢用「折腾」「踩坑」等口语化表达描述技术探索",
      "分享经验时常用「攻略」「指南」「记」等实用性标题词",
    ],
  };
}

// ─── Main ─────────────────────────────────────────────

function main() {
  console.log("🎤 构建 Voice Profile...\n");

  const posts = readJsonl(path.join(DATA_DIR, "source-docs/posts.jsonl"));
  const tweets = readJsonl(path.join(DATA_DIR, "source-docs/tweets.jsonl"));

  console.log(`  📖 ${posts.length} 篇博客`);
  console.log(`  🐦 ${tweets.length} 条推文`);

  const titleAnalysis = analyzeTitlePatterns(posts);
  const tweetAnalysis = analyzeTweetPatterns(tweets);
  const expressionHabits = extractExpressionHabits(posts, tweets);

  const profile = {
    $schema: "voice-profile-v1",
    generatedAt: new Date().toISOString(),
    author: "罗磊",
    overall_tone: {
      description: "随性但有料，技术话题务实不炫技，生活话题真实不矫情",
      primary_persona: "独立开发者 + 科技生活博主",
      communication_style: "先给结论，再补背景和细节",
      humor_level: "适度自嘲，偶尔调侃",
    },
    blog_title_style: titleAnalysis,
    tweet_style: tweetAnalysis,
    expression_habits: expressionHabits,
    style_modes: {
      technical: {
        description: "技术类回答",
        traits: ["直接给方案", "会提到具体工具和版本", "不回避踩过的坑", "代码片段简洁"],
      },
      travel: {
        description: "旅行类回答",
        traits: ["按时间线叙述", "会提到具体地名和体验", "偶尔加个人感悟", "推荐实用信息"],
      },
      life: {
        description: "生活类回答",
        traits: ["语气更随意", "会用 emoji", "偶尔自嘲", "不说教"],
      },
      recommendation: {
        description: "推荐类回答",
        traits: ["先说结论", "附带使用体验", "不强推", "说清优缺点"],
      },
    },
  };

  const outputPath = path.join(DATA_DIR, "voice-profile.json");
  fs.writeFileSync(outputPath, JSON.stringify(profile, null, 2), "utf-8");

  console.log(`\n✅ Voice Profile 构建完成`);
  console.log(`  📊 标题竖线分隔率: ${titleAnalysis.style.vertical_bar_rate}%`);
  console.log(`  📊 标题中英混用率: ${titleAnalysis.style.english_mix_rate}%`);
  console.log(`  📊 推文 emoji 使用率: ${tweetAnalysis.emoji_rate}%`);
  console.log(`  📊 高频表达: ${expressionHabits.frequent_expressions.slice(0, 5).map((e) => e.word).join("、")}`);
}

main();
