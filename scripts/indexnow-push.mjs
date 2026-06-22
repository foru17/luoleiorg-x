#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

// IndexNow 把更新过的 URL 推送给 Bing/Yandex/Naver/Seznam，几分钟内被索引；
// Copilot/ChatGPT Search 走 Bing 通道，因此对 AI 引用速度也有帮助。
//
// 使用方式：
//   pnpm indexnow:recent [days=14]    推送最近 N 天有更新的文章
//   pnpm indexnow:all                 推送全站
//   pnpm indexnow:url <url> [...]     单条/多条 URL
//   pnpm indexnow:dry                 仅打印不发送

const KEY = "4753a8056038de63201e5039610375c4";
const HOST = "luolei.org";
const SITE_URL = "https://luolei.org";
const KEY_LOCATION = `${SITE_URL}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/IndexNow";

const POSTS_DIR = path.resolve(process.cwd(), "content/posts");

function listMarkdown(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listMarkdown(p));
    else if (e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function fileToSlug(filePath) {
  return path
    .relative(POSTS_DIR, filePath)
    .replace(/\.md$/, "")
    .split(path.sep)
    .join("-");
}

function loadPosts() {
  return listMarkdown(POSTS_DIR)
    .map((file) => {
      const { data } = matter(fs.readFileSync(file, "utf-8"));
      if (!data?.title || !data?.date || data?.hide) return null;
      return {
        slug: fileToSlug(file),
        date: new Date(data.date).getTime(),
      };
    })
    .filter(Boolean);
}

function postsToUrls(posts) {
  const urls = new Set();
  // 永远把站点的核心入口推一遍
  urls.add(`${SITE_URL}/`);
  urls.add(`${SITE_URL}/about`);
  urls.add(`${SITE_URL}/llms.txt`);
  urls.add(`${SITE_URL}/llms-full.txt`);
  urls.add(`${SITE_URL}/sitemap.xml`);
  for (const p of posts) {
    urls.add(`${SITE_URL}/${p.slug}`);
    urls.add(`${SITE_URL}/${p.slug}.md`);
  }
  return [...urls];
}

async function pushUrls(urls, { dryRun }) {
  if (urls.length === 0) {
    console.log("[indexnow] no URLs to push");
    return;
  }

  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  };

  console.log(`[indexnow] preparing to push ${urls.length} URLs`);
  if (urls.length <= 20) {
    for (const u of urls) console.log(`  · ${u}`);
  } else {
    for (const u of urls.slice(0, 5)) console.log(`  · ${u}`);
    console.log(`  · ... and ${urls.length - 5} more`);
  }

  if (dryRun) {
    console.log("[indexnow] --dry-run, not sending");
    return;
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const body = await res.text();
  console.log(`[indexnow] response ${res.status}: ${body || "(empty body)"}`);
  // IndexNow 协议：200/202 表示已接收，其它皆为失败
  if (![200, 202].includes(res.status)) {
    process.exitCode = 1;
  }
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filtered = args.filter((a) => a !== "--dry-run");
  const mode = filtered[0];

  let urls = [];

  if (mode === "all") {
    urls = postsToUrls(loadPosts());
  } else if (mode === "recent") {
    const days = Number.parseInt(filtered[1] ?? "14", 10);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const recent = loadPosts().filter((p) => p.date >= cutoff);
    console.log(`[indexnow] ${recent.length} posts updated within ${days} days`);
    urls = postsToUrls(recent);
  } else if (mode === "url") {
    urls = filtered.slice(1);
    if (urls.length === 0) {
      console.error("Usage: indexnow-push url <url> [<url> ...]");
      process.exit(1);
    }
  } else {
    console.error(
      "Usage:\n" +
        "  indexnow-push recent [days]       push posts updated in last N days (default 14)\n" +
        "  indexnow-push all                 push every post (and core index pages)\n" +
        "  indexnow-push url <url> [...]     push specific URLs\n" +
        "  add --dry-run to preview without sending",
    );
    process.exit(1);
  }

  pushUrls(urls, { dryRun });
}

main();
