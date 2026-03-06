/**
 * 获取作者时间线推文并缓存（用于 About 页面画像）
 *
 * 用法:
 *   source .env && node scripts/fetch-author-tweets.mjs
 *   source .env && node scripts/fetch-author-tweets.mjs --username=luoleiorg --max=300
 *   source .env && node scripts/fetch-author-tweets.mjs --include-replies
 *   source .env && node scripts/fetch-author-tweets.mjs --force  (忽略缓存，全量拉取)
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "author-tweets-cache.json");
const TWEET_CACHE_MAX_AGE_DAYS = 7;

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    username: "luoleiorg",
    max: 300,
    includeReplies: false,
    force: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--username=")) {
      flags.username = arg.slice("--username=".length).trim() || flags.username;
    } else if (arg.startsWith("--max=")) {
      const value = Number.parseInt(arg.slice("--max=".length), 10);
      if (Number.isFinite(value) && value > 0) {
        flags.max = Math.min(2000, value);
      }
    } else if (arg === "--include-replies") {
      flags.includeReplies = true;
    } else if (arg === "--force") {
      flags.force = true;
    }
  }

  return flags;
}

async function loadEnv() {
  const envPath = path.join(ROOT_DIR, ".env");
  try {
    const content = await fs.readFile(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore missing .env
  }
}

async function requestJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API 请求失败: ${response.status} ${text.slice(0, 500)}`);
  }

  return response.json();
}

function mapMedia(includes) {
  const mediaMap = new Map();
  for (const media of includes?.media ?? []) {
    mediaMap.set(media.media_key, {
      type: media.type,
      url: media.url,
      preview_image_url: media.preview_image_url,
      width: media.width,
      height: media.height,
    });
  }
  return mediaMap;
}

function extractTweets(payload) {
  const mediaMap = mapMedia(payload.includes);
  return (payload.data ?? []).map((tweet) => {
    const media = (tweet.attachments?.media_keys ?? [])
      .map((key) => mediaMap.get(key))
      .filter(Boolean);

    return {
      id: tweet.id,
      text: tweet.text,
      created_at: tweet.created_at,
      public_metrics: tweet.public_metrics ?? null,
      media,
      conversation_id: tweet.conversation_id,
      referenced_tweets: tweet.referenced_tweets ?? [],
    };
  });
}

async function getUserByUsername(username, token) {
  const userUrl = new URL(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`,
  );
  userUrl.searchParams.set("user.fields", "id,name,username,description,profile_image_url");
  const payload = await requestJson(userUrl.toString(), token);
  if (!payload?.data?.id) {
    throw new Error(`未找到用户: ${username}`);
  }
  return payload.data;
}

async function fetchAuthorTweets(userId, token, options) {
  const allTweets = [];
  let nextToken = null;
  let requestCount = 0;

  while (allTweets.length < options.max) {
    const remaining = options.max - allTweets.length;
    // Twitter API v2 要求 max_results 在 5-100 之间
    const pageSize = Math.min(100, Math.max(5, remaining));

    const timelineUrl = new URL(
      `https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets`,
    );
    timelineUrl.searchParams.set("max_results", String(pageSize));
    timelineUrl.searchParams.set(
      "tweet.fields",
      "created_at,public_metrics,attachments,conversation_id,referenced_tweets",
    );
    timelineUrl.searchParams.set(
      "expansions",
      "attachments.media_keys",
    );
    timelineUrl.searchParams.set(
      "media.fields",
      "type,url,preview_image_url,width,height",
    );
    if (!options.includeReplies) {
      timelineUrl.searchParams.set("exclude", "retweets,replies");
    } else {
      timelineUrl.searchParams.set("exclude", "retweets");
    }
    if (options.sinceId) {
      timelineUrl.searchParams.set("since_id", options.sinceId);
    }
    if (options.untilId) {
      timelineUrl.searchParams.set("until_id", options.untilId);
    }
    if (nextToken) {
      timelineUrl.searchParams.set("pagination_token", nextToken);
    }

    const payload = await requestJson(timelineUrl.toString(), token);
    const tweets = extractTweets(payload);
    requestCount += 1;

    if (tweets.length === 0) break;
    allTweets.push(...tweets);

    nextToken = payload?.meta?.next_token ?? null;
    if (!nextToken) break;
  }

  return {
    tweets: allTweets.slice(0, options.max),
    requestCount,
  };
}

async function readJsonSafe(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isCacheFresh(cacheData) {
  const updatedAt = cacheData?.meta?.lastUpdated;
  if (!updatedAt) return false;
  const age = Date.now() - new Date(updatedAt).getTime();
  return age < TWEET_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

async function main() {
  await loadEnv();
  const args = parseArgs();
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    console.error("❌ 缺少 TWITTER_BEARER_TOKEN，请先在 .env 中配置");
    process.exit(1);
  }

  // 检查已有缓存，判断是否可以增量拉取
  const existingCache = await readJsonSafe(OUTPUT_PATH);
  const canIncremental =
    !args.force &&
    existingCache?.tweets?.length > 0 &&
    isCacheFresh(existingCache);

  console.log(`🔍 获取用户信息 @${args.username} ...`);
  const user = await getUserByUsername(args.username, token);
  console.log(`✅ 用户: ${user.name} (@${user.username})`);

  let finalTweets;
  let totalRequests;

  if (canIncremental) {
    // 增量模式：先拉取最新新推文，再往旧处补足至 max
    const newestId = existingCache.tweets[0]?.id;
    const oldestId = existingCache.tweets[existingCache.tweets.length - 1]?.id;
    console.log(
      `📡 增量拉取（缓存 ${existingCache.tweets.length} 条，since_id=${newestId}）...`,
    );
    const { tweets: newTweets, requestCount: rc1 } = await fetchAuthorTweets(
      user.id,
      token,
      {
        max: args.max,
        includeReplies: args.includeReplies,
        sinceId: newestId,
      },
    );
    totalRequests = rc1;

    // 合并新旧推文，按 ID 去重（不截断）
    const idSet = new Set();
    const merged = [];
    for (const tweet of [...newTweets, ...existingCache.tweets]) {
      if (!idSet.has(tweet.id)) {
        idSet.add(tweet.id);
        merged.push(tweet);
      }
    }
    console.log(
      `   └─ 新增 ${newTweets.length} 条，合并后 ${merged.length} 条`,
    );

    // 若缓存仍不足 max，继续往旧处补充
    if (merged.length < args.max && oldestId) {
      const need = args.max - merged.length;
      console.log(`📡 向旧处补充（until_id=${oldestId}，需要 ${need} 条）...`);
      const { tweets: olderTweets, requestCount: rc2 } = await fetchAuthorTweets(
        user.id,
        token,
        {
          max: need,
          includeReplies: args.includeReplies,
          untilId: oldestId,
        },
      );
      totalRequests += rc2;
      for (const tweet of olderTweets) {
        if (!idSet.has(tweet.id)) {
          idSet.add(tweet.id);
          merged.push(tweet);
        }
      }
      console.log(
        `   └─ 补充 ${olderTweets.length} 条，合并后 ${merged.length} 条`,
      );
    }

    finalTweets = merged;
  } else {
    // 全量拉取
    const reason = args.force
      ? "--force"
      : !existingCache?.tweets?.length
        ? "无缓存"
        : "缓存过期";
    console.log(
      `📡 全量拉取时间线推文（max=${args.max}，原因: ${reason}）...`,
    );
    const { tweets, requestCount } = await fetchAuthorTweets(user.id, token, {
      max: args.max,
      includeReplies: args.includeReplies,
    });
    finalTweets = tweets;
    totalRequests = requestCount;
  }

  const cache = {
    meta: {
      lastUpdated: new Date().toISOString(),
      username: user.username,
      fetchedCount: finalTweets.length,
      requestCount: totalRequests,
      includeReplies: args.includeReplies,
    },
    user,
    tweets: finalTweets,
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`✅ 已写入: ${OUTPUT_PATH}`);
  console.log(`📊 推文数量: ${finalTweets.length}（API 请求: ${totalRequests}）`);
}

main().catch((error) => {
  console.error("❌ 失败:", error.message);
  process.exit(1);
});
