/**
 * 批量获取推文数据并缓存
 * 使用 Twitter API v2 获取推文信息
 * 
 * 使用方法:
 * 1. 设置环境变量 TWITTER_BEARER_TOKEN
 * 2. 运行: node scripts/fetch-tweets.mjs
 * 
 * 或者在 package.json 中添加脚本:
 * "fetch-tweets": "node scripts/fetch-tweets.mjs"
 */

import fs from "fs/promises";
import path from "path";

const SCRIPT_DIR = import.meta.dirname;
const ROOT_DIR = path.join(SCRIPT_DIR, "..");

// 加载 .env 文件
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
  } catch {}
}

// 推文 ID 列表 - 自动从 content/posts 目录提取
async function extractTweetIds() {
  const postsDir = path.join(SCRIPT_DIR, "../content/posts");
  const tweetIds = new Set();
  
  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const content = await fs.readFile(fullPath, "utf-8");
        // 匹配 tweetId="1234567890" 或 tweetId='1234567890'
        const matches = content.match(/tweetId=["'](\d+)["']/g);
        if (matches) {
          matches.forEach(match => {
            const id = match.match(/tweetId=["'](\d+)["']/)[1];
            tweetIds.add(id);
          });
        }
      }
    }
  }
  
  await scanDir(postsDir);
  return Array.from(tweetIds);
}

// 批量获取推文数据（每批 100 个）
async function fetchTweetsBatch(ids) {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    throw new Error("请设置 TWITTER_BEARER_TOKEN 环境变量");
  }

  const idString = ids.join(",");
  const url = new URL("https://api.x.com/2/tweets");
  url.searchParams.append("ids", idString);
  url.searchParams.append("tweet.fields", "created_at,public_metrics,attachments");
  url.searchParams.append("expansions", "attachments.media_keys,author_id");
  url.searchParams.append("media.fields", "type,url,preview_image_url,width,height,alt_text");
  url.searchParams.append("user.fields", "name,username,profile_image_url");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 请求失败: ${response.status} ${error}`);
  }

  const data = await response.json();
  return data;
}

// 处理 API 响应，构建缓存对象
function processTweetData(apiResponse) {
  const { data: tweets, includes, errors } = apiResponse;
  const cache = { tweets: {}, lastUpdated: new Date().toISOString() };

  if (errors) {
    console.warn("部分推文获取失败:", errors);
  }

  // 构建用户映射
  const users = {};
  if (includes?.users) {
    includes.users.forEach(user => {
      users[user.id] = user;
    });
  }

  // 构建媒体映射
  const mediaMap = {};
  if (includes?.media) {
    includes.media.forEach(m => {
      mediaMap[m.media_key] = m;
    });
  }

  // 处理每条推文
  tweets?.forEach(tweet => {
    const author = users[tweet.author_id];
    const media = tweet.attachments?.media_keys?.map(key => mediaMap[key]).filter(Boolean) || [];

    cache.tweets[tweet.id] = {
      id: tweet.id,
      text: tweet.text,
      created_at: tweet.created_at,
      author: author ? {
        name: author.name,
        username: author.username,
        profile_image_url: author.profile_image_url,
      } : { name: "未知用户", username: "unknown", profile_image_url: "" },
      public_metrics: tweet.public_metrics,
      media: media.map(m => ({
        type: m.type,
        url: m.url,
        preview_image_url: m.preview_image_url,
      })),
    };
  });

  return cache;
}

async function main() {
  try {
    await loadEnv();
    const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

    console.log("🔍 扫描文章中的推文 ID...");
    const tweetIds = await extractTweetIds();
    console.log(`✅ 找到 ${tweetIds.length} 条推文`);

    if (tweetIds.length === 0) {
      console.log("没有找到推文 ID，退出");
      return;
    }

    if (!BEARER_TOKEN) {
      console.error("❌ 错误: 请设置 TWITTER_BEARER_TOKEN 环境变量");
      console.log("\n获取方式:");
      console.log("1. 访问 https://developer.twitter.com/en/portal/dashboard");
      console.log("2. 创建或选择应用");
      console.log("3. 在 Keys and Tokens 中生成 Bearer Token");
      console.log("\n使用方法:");
      console.log("TWITTER_BEARER_TOKEN=your_token node scripts/fetch-tweets.mjs");
      process.exit(1);
    }

    console.log("\n📡 获取推文数据...");
    const batchSize = 100; // Twitter API 每次最多 100 个
    const batches = [];
    for (let i = 0; i < tweetIds.length; i += batchSize) {
      batches.push(tweetIds.slice(i, i + batchSize));
    }

    let allData = { tweets: {} };
    for (let i = 0; i < batches.length; i++) {
      console.log(`  批次 ${i + 1}/${batches.length} (${batches[i].length} 条)...`);
      const response = await fetchTweetsBatch(batches[i]);
      const processed = processTweetData(response);
      Object.assign(allData.tweets, processed.tweets);
    }

    allData.lastUpdated = new Date().toISOString();

    // 确保 data 目录存在
    const dataDir = path.join(SCRIPT_DIR, "../data");
    await fs.mkdir(dataDir, { recursive: true });

    // 写入缓存文件
    const cachePath = path.join(dataDir, "tweets-cache.json");
    await fs.writeFile(cachePath, JSON.stringify(allData, null, 2), "utf-8");

    console.log(`\n✅ 缓存已更新: ${cachePath}`);
    console.log(`📊 成功缓存 ${Object.keys(allData.tweets).length}/${tweetIds.length} 条推文`);
    console.log(`🕐 更新时间: ${allData.lastUpdated}`);

    // 显示缺失的推文
    const cachedIds = new Set(Object.keys(allData.tweets));
    const missingIds = tweetIds.filter(id => !cachedIds.has(id));
    if (missingIds.length > 0) {
      console.warn(`\n⚠️  ${missingIds.length} 条推文未能获取:`);
      missingIds.forEach(id => console.warn(`   - ${id}`));
    }

  } catch (error) {
    console.error("❌ 错误:", error.message);
    process.exit(1);
  }
}

main();
