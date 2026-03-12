#!/usr/bin/env node
/**
 * build-source-docs.mjs
 *
 * 将 posts / tweets / projects 统一为 canonical source docs 格式。
 * 这是 fact registry 和后续 hybrid retrieval 的数据基础。
 *
 * 输入：
 *   - data/sources/blog-digest.json
 *   - data/author-tweets-cache.json
 *   - data/github-resume.json
 *
 * 输出：
 *   - data/source-docs/posts.jsonl
 *   - data/source-docs/tweets.jsonl
 *   - data/source-docs/projects.jsonl
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");
const OUTPUT_DIR = path.join(DATA_DIR, "source-docs");

// ─── Helpers ──────────────────────────────────────────

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJsonl(filePath, records) {
  const lines = records.map((r) => JSON.stringify(r));
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  console.log(`  💾 ${path.basename(filePath)}: ${records.length} 条记录`);
}

function slugToSourceId(slug) {
  return `post:${slug}`;
}

function tweetToSourceId(id) {
  return `tweet:${id}`;
}

function projectToSourceId(name) {
  return `project:${name.toLowerCase().replace(/\s+/g, "-")}`;
}

function expToSourceId(company, period) {
  const key = `${company}-${period}`.toLowerCase().replace(/[\s/]+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");
  return `exp:${key}`;
}

// ─── Posts ─────────────────────────────────────────────

function buildPostDocs() {
  const digestPath = path.join(DATA_DIR, "sources/blog-digest.json");
  if (!fs.existsSync(digestPath)) {
    console.log("  ⚠️ blog-digest.json 不存在，跳过 posts");
    return [];
  }

  const digest = readJson(digestPath);
  const posts = digest.posts || [];

  return posts.map((post) => {
    const slug = post.url
      ? post.url.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "")
      : post.title;

    return {
      source_id: slugToSourceId(slug),
      source_type: "post",
      title: post.title,
      url: post.url,
      date: post.date || null,
      categories: post.categories || [],
      summary: post.summary || "",
      key_points: post.keyPoints || [],
      provenance: "authored_public",
    };
  });
}

// ─── Tweets ───────────────────────────────────────────

function buildTweetDocs() {
  const tweetPaths = [
    path.join(DATA_DIR, "author-tweets-cache.json"),
    path.join(DATA_DIR, "tweets-cache.json"),
  ];

  let tweetsData = null;
  for (const p of tweetPaths) {
    if (fs.existsSync(p)) {
      tweetsData = readJson(p);
      break;
    }
  }

  if (!tweetsData?.tweets) {
    console.log("  ⚠️ tweets cache 不存在，跳过 tweets");
    return [];
  }

  const username = tweetsData.user?.username || tweetsData.meta?.username || "luoleiorg";

  return tweetsData.tweets.map((tweet) => {
    const date = tweet.created_at
      ? new Date(tweet.created_at).toISOString().slice(0, 10)
      : null;

    return {
      source_id: tweetToSourceId(tweet.id),
      source_type: "tweet",
      title: `@${username} ${date || ""}`,
      url: `https://x.com/${username}/status/${tweet.id}`,
      date,
      text: tweet.text || "",
      metrics: tweet.public_metrics
        ? {
            likes: tweet.public_metrics.like_count || 0,
            retweets: tweet.public_metrics.retweet_count || 0,
            replies: tweet.public_metrics.reply_count || 0,
            impressions: tweet.public_metrics.impression_count || 0,
          }
        : null,
      provenance: "authored_public",
    };
  });
}

// ─── Projects & Experience ────────────────────────────

function buildProjectDocs() {
  const resumePath = path.join(DATA_DIR, "github-resume.json");
  if (!fs.existsSync(resumePath)) {
    console.log("  ⚠️ github-resume.json 不存在，跳过 projects");
    return [];
  }

  const resume = readJson(resumePath);
  const docs = [];

  // Projects
  for (const project of resume.projects || []) {
    docs.push({
      source_id: projectToSourceId(project.name),
      source_type: "project",
      title: project.name,
      url: project.url,
      date: null,
      description: project.description || "",
      tags: project.tags || [],
      provenance: "curated_public",
    });
  }

  // Experience
  for (const exp of resume.experience || []) {
    docs.push({
      source_id: expToSourceId(exp.company, exp.period),
      source_type: "experience",
      title: `${exp.title} @ ${exp.company}`,
      url: resume.profile?.social?.blog || "https://luolei.org",
      date: null,
      period: exp.period,
      company: exp.company,
      role: exp.title,
      description: exp.description || "",
      provenance: "curated_public",
    });
  }

  // Highlights
  for (const highlight of resume.highlights || []) {
    docs.push({
      source_id: `highlight:${docs.length}`,
      source_type: "highlight",
      title: highlight.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").slice(0, 60),
      url: resume.profile?.social?.blog || "https://luolei.org",
      date: null,
      text: highlight,
      provenance: "curated_public",
    });
  }

  // Public Activities
  for (const activity of resume.publicActivities || []) {
    docs.push({
      source_id: `activity:${docs.length}`,
      source_type: "activity",
      title: activity.slice(0, 60),
      url: resume.profile?.social?.blog || "https://luolei.org",
      date: null,
      text: activity,
      provenance: "curated_public",
    });
  }

  return docs;
}

// ─── Main ─────────────────────────────────────────────

function main() {
  console.log("📦 构建 Source Docs...\n");

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const postDocs = buildPostDocs();
  const tweetDocs = buildTweetDocs();
  const projectDocs = buildProjectDocs();

  writeJsonl(path.join(OUTPUT_DIR, "posts.jsonl"), postDocs);
  writeJsonl(path.join(OUTPUT_DIR, "tweets.jsonl"), tweetDocs);
  writeJsonl(path.join(OUTPUT_DIR, "projects.jsonl"), projectDocs);

  // 写一个 manifest
  const manifest = {
    generatedAt: new Date().toISOString(),
    counts: {
      posts: postDocs.length,
      tweets: tweetDocs.length,
      projects: projectDocs.length,
      total: postDocs.length + tweetDocs.length + projectDocs.length,
    },
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );

  console.log(`\n✅ Source Docs 构建完成`);
  console.log(`  📊 总计 ${manifest.counts.total} 条 canonical source docs`);
}

main();
