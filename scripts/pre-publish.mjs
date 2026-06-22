/**
 * 发布前预处理脚本
 *
 * 一键完成：拉取推文数据 → AI 摘要/SEO → 搜索索引
 *
 * 用法:
 *   pnpm pre-publish                     处理所有新增/变更文章
 *   pnpm pre-publish --slug=my-article   只处理指定文章
 *   pnpm pre-publish --skip-tweets       跳过推文拉取
 *   pnpm pre-publish --skip-ai           跳过 AI 处理
 *   pnpm pre-publish --skip-search       跳过搜索索引
 *   pnpm pre-publish --force             强制重新处理 AI
 *   pnpm pre-publish --dry-run           预览会执行的操作
 */

import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";

const SCRIPT_DIR = import.meta.dirname;
const ROOT = path.join(SCRIPT_DIR, "..");

// ─── CLI 参数 ─────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = {
    slug: null,
    skipTweets: false,
    skipAi: false,
    skipSearch: false,
    force: false,
    dryRun: false,
  };
  for (const arg of args) {
    if (arg.startsWith("--slug=")) flags.slug = arg.split("=")[1];
    else if (arg === "--skip-tweets") flags.skipTweets = true;
    else if (arg === "--skip-ai") flags.skipAi = true;
    else if (arg === "--skip-search") flags.skipSearch = true;
    else if (arg === "--force") flags.force = true;
    else if (arg === "--dry-run") flags.dryRun = true;
  }
  return flags;
}

// ─── 工具函数 ─────────────────────────────────────────────

function run(cmd, label) {
  console.log(`\n${"─".repeat(50)}`);
  console.log(`▶ ${label}`);
  console.log(`  $ ${cmd}`);
  console.log("");
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit" });
    console.log(`✅ ${label} 完成`);
    return true;
  } catch {
    console.error(`⚠️  ${label} 失败（继续执行后续步骤）`);
    return false;
  }
}

/**
 * 检测指定文章（或全部文章）中的推文 ID
 */
async function detectTweets(slug) {
  const postsDir = path.join(ROOT, "content/posts");
  const tweetIds = new Set();

  async function scanFile(filePath) {
    const content = await fs.readFile(filePath, "utf-8");
    const matches = content.match(/tweetId=["'](\d+)["']/g);
    if (matches) {
      for (const m of matches) {
        tweetIds.add(m.match(/tweetId=["'](\d+)["']/)[1]);
      }
    }
  }

  if (slug) {
    // 尝试匹配指定 slug 对应的文件
    const candidates = [
      path.join(postsDir, `${slug}.md`),
      path.join(postsDir, slug.replace(/-/g, "/") + ".md"),
    ];
    for (const f of candidates) {
      try {
        await scanFile(f);
      } catch {
        // 文件不存在，继续
      }
    }
    // 兜底：遍历查找
    if (tweetIds.size === 0) {
      await scanDir(postsDir, slug, tweetIds);
    }
  } else {
    await scanDir(postsDir, null, tweetIds);
  }

  return tweetIds;
}

async function scanDir(dir, targetSlug, tweetIds) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDir(full, targetSlug, tweetIds);
    } else if (entry.name.endsWith(".md")) {
      if (targetSlug) {
        const fileSlug = full
          .replace(path.join(dir, "..").replace(/\/content\/posts$/, "") + "/content/posts/", "")
          .replace(/\.md$/, "")
          .replace(/\//g, "-");
        if (fileSlug !== targetSlug) continue;
      }
      const content = await fs.readFile(full, "utf-8");
      const matches = content.match(/tweetId=["'](\d+)["']/g);
      if (matches) {
        for (const m of matches) {
          tweetIds.add(m.match(/tweetId=["'](\d+)["']/)[1]);
        }
      }
    }
  }
}

/**
 * 检查已缓存的推文，返回缺失的 ID
 */
async function findMissingTweets(tweetIds) {
  try {
    const cacheFile = path.join(ROOT, "data/tweets-cache.json");
    const cache = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
    const cached = new Set(Object.keys(cache.tweets || {}));
    return [...tweetIds].filter((id) => !cached.has(id));
  } catch {
    return [...tweetIds]; // 没有缓存文件，全部需要拉取
  }
}

// ─── 主流程 ──────────────────────────────────────────────

async function main() {
  const flags = parseArgs();

  console.log("🚀 发布前预处理");
  if (flags.slug) console.log(`   目标文章: ${flags.slug}`);
  if (flags.dryRun) console.log("   模式: dry-run（仅预览）");
  console.log("");

  // ── Step 1: 推文 ──────────────────────────────────────

  if (!flags.skipTweets) {
    const tweetIds = await detectTweets(flags.slug);
    if (tweetIds.size === 0) {
      console.log("📋 未检测到推文引用，跳过推文拉取");
    } else {
      const missing = await findMissingTweets(tweetIds);
      console.log(`📋 检测到 ${tweetIds.size} 条推文引用，${missing.length} 条未缓存`);
      if (missing.length > 0) {
        if (flags.dryRun) {
          console.log("   [dry-run] 将拉取以下推文:", missing.join(", "));
        } else {
          // fetch-tweets.mjs 会自动扫描所有文章并拉取全部
          run("node scripts/fetch-tweets.mjs", "拉取推文数据");
        }
      }
    }
  } else {
    console.log("⏭️  跳过推文拉取 (--skip-tweets)");
  }

  // ── Step 2: AI 摘要 & SEO ─────────────────────────────

  if (!flags.skipAi) {
    const aiArgs = [];
    if (flags.slug) aiArgs.push(`--slug=${flags.slug}`);
    if (flags.force) aiArgs.push("--force");
    if (flags.dryRun) aiArgs.push("--dry-run");

    const aiCmd = `node scripts/ai-process.mjs ${aiArgs.join(" ")}`.trim();
    run(aiCmd, "AI 摘要 & SEO 处理");
  } else {
    console.log("⏭️  跳过 AI 处理 (--skip-ai)");
  }

  // ── Step 3: 搜索索引 ─────────────────────────────────

  if (!flags.skipSearch) {
    if (flags.dryRun) {
      console.log("\n[dry-run] 将重新生成搜索索引");
    } else {
      run("pnpm search:index", "生成搜索索引");
    }
  } else {
    console.log("⏭️  跳过搜索索引 (--skip-search)");
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log("🎉 预处理完成");
}

main().catch((err) => {
  console.error("❌ 脚本执行失败:", err);
  process.exit(1);
});
