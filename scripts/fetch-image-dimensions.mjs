#!/usr/bin/env node
/**
 * 批量获取文章图片尺寸并缓存
 * 在构建时运行，用于防止图片加载时的布局抖动 (CLS)
 *
 * 使用方法:
 * node scripts/fetch-image-dimensions.mjs
 */

import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

const SCRIPT_DIR = import.meta.dirname;
const ROOT_DIR = path.join(SCRIPT_DIR, "..");
const CACHE_FILE = path.join(ROOT_DIR, "data/image-dimensions.json");

// 匹配 Markdown 图片语法: ![](url) 或 ![alt](url)
const IMAGE_REGEX = /!\[[^\]]*\]\(([^)]+)\)/g;

// 需要获取尺寸的图片域名白名单
// 这些域名的图片可以通过 HTTP HEAD 请求获取尺寸
const SUPPORTED_DOMAINS = [
  "c2.is26.com",
  "img.is26.com",
  "cdn.is26.com",
  "wp-image.is26.com",
];

/**
 * 扫描所有 Markdown 文件，提取图片 URL
 */
async function extractImageUrls() {
  const postsDir = path.join(ROOT_DIR, "content/posts");
  const imageUrls = new Set();

  async function scanDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.name.endsWith(".md")) {
        const content = await fs.readFile(fullPath, "utf-8");
        const { content: markdownContent } = matter(content);

        let match;
        while ((match = IMAGE_REGEX.exec(markdownContent)) !== null) {
          const url = match[1].trim();
          // 只处理支持的域名的图片
          if (isSupportedImage(url)) {
            imageUrls.add(normalizeUrl(url));
          }
        }
      }
    }
  }

  await scanDir(postsDir);
  return Array.from(imageUrls);
}

/**
 * 检查 URL 是否是支持的图片
 */
function isSupportedImage(url) {
  if (!url) return false;
  // 跳过 data URI
  if (url.startsWith("data:")) return false;
  // 跳过相对路径（本地图片）
  if (url.startsWith("/") && !url.startsWith("//")) return false;

  try {
    const urlObj = new URL(url.startsWith("//") ? `https:${url}` : url);
    return SUPPORTED_DOMAINS.some((domain) => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

/**
 * 规范化 URL，移除现有的转换参数
 */
function normalizeUrl(url) {
  // 移除 Cloudflare Images 转换参数
  return url.replace(/\/w=[^/?#]+(?:,[^/?#]+)*$/, "").replace(/\/$/, "");
}

/**
 * 通过 HTTP 请求获取图片尺寸
 * 使用 HEAD 请求检查是否有 Content-Length，然后尝试获取图片
 */
async function fetchImageDimensions(url) {
  try {
    const normalizedUrl = normalizeUrl(url);
    const fullUrl = normalizedUrl.startsWith("//")
      ? `https:${normalizedUrl}`
      : normalizedUrl;

    // 使用 img.is26.com 的缩略图 API 获取小尺寸图片来检测
    // 添加 w=100 参数获取小图，减少带宽
    const probeUrl = fullUrl.includes("img.is26.com")
      ? `${fullUrl}/w=100`
      : fullUrl;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10秒超时

    const response = await fetch(probeUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // 获取图片数据
    const buffer = await response.arrayBuffer();

    // 解析图片尺寸
    const dimensions = parseImageDimensions(Buffer.from(buffer));

    if (dimensions) {
      return dimensions;
    }

    throw new Error("无法解析图片尺寸");
  } catch (error) {
    throw new Error(`获取失败: ${error.message}`);
  }
}

/**
 * 解析图片 Buffer 获取尺寸
 * 支持 JPEG, PNG, WebP, GIF
 */
function parseImageDimensions(buffer) {
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return parseJPEG(buffer);
  }
  // PNG
  if (buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") {
    return parsePNG(buffer);
  }
  // WebP
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return parseWebP(buffer);
  }
  // GIF
  if (buffer.toString("ascii", 0, 3) === "GIF") {
    return parseGIF(buffer);
  }

  return null;
}

/**
 * 解析 JPEG 尺寸
 */
function parseJPEG(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) break;

    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS

    const length = buffer.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // SOF markers
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    offset += 2 + length;
  }
  return null;
}

/**
 * 解析 PNG 尺寸
 */
function parsePNG(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/**
 * 解析 WebP 尺寸
 */
function parseWebP(buffer) {
  const type = buffer.toString("ascii", 12, 16);

  if (type === "VP8 ") {
    // Lossy WebP
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height };
  } else if (type === "VP8L") {
    // Lossless WebP
    const bits = buffer.readUInt32LE(21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  } else if (type === "VP8X") {
    // Extended WebP
    const width = buffer.readUInt24LE(24) + 1;
    const height = buffer.readUInt24LE(27) + 1;
    return { width, height };
  }

  return null;
}

/**
 * 解析 GIF 尺寸
 */
function parseGIF(buffer) {
  const width = buffer.readUInt16LE(6);
  const height = buffer.readUInt16LE(8);
  return { width, height };
}

/**
 * 批处理图片，带并发控制
 */
async function processBatch(urls, concurrency = 5) {
  const results = {};
  const errors = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const promises = batch.map(async (url) => {
      try {
        const dimensions = await fetchImageDimensions(url);
        results[url] = dimensions;
        process.stdout.write(`✓ ${url.slice(0, 60)}... (${dimensions.width}x${dimensions.height})\n`);
        return { url, success: true };
      } catch (error) {
        errors.push({ url, error: error.message });
        process.stdout.write(`✗ ${url.slice(0, 60)}... (${error.message})\n`);
        return { url, success: false };
      }
    });

    await Promise.all(promises);

    // 短暂延迟，避免请求过快
    if (i + concurrency < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return { results, errors };
}

/**
 * 加载现有的缓存
 */
async function loadExistingCache() {
  try {
    const content = await fs.readFile(CACHE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return { images: {}, lastUpdated: null };
  }
}

/**
 * 主函数
 */
async function main() {
  console.log("🔍 扫描文章中的图片...\n");

  const imageUrls = await extractImageUrls();
  console.log(`✅ 找到 ${imageUrls.length} 张图片\n`);

  if (imageUrls.length === 0) {
    console.log("没有需要处理的图片");
    return;
  }

  // 加载现有缓存
  const existingCache = await loadExistingCache();
  console.log(`📦 现有缓存: ${Object.keys(existingCache.images).length} 张图片`);

  // 找出需要获取的新图片
  const newUrls = imageUrls.filter((url) => !existingCache.images[url]);
  const existingUrls = imageUrls.filter((url) => existingCache.images[url]);

  console.log(`🆕 新图片: ${newUrls.length} 张`);
  console.log(`♻️  复用缓存: ${existingUrls.length} 张\n`);

  // 合并结果
  const results = { ...existingCache.images };

  // 处理新图片
  if (newUrls.length > 0) {
    console.log("📡 获取新图片尺寸...\n");
    const { results: newResults, errors } = await processBatch(newUrls, 5);

    Object.assign(results, newResults);

    if (errors.length > 0) {
      console.log(`\n⚠️  ${errors.length} 张图片获取失败`);
    }
  }

  // 保存缓存
  const cache = {
    images: results,
    lastUpdated: new Date().toISOString(),
    totalImages: Object.keys(results).length,
    successCount: Object.keys(results).length,
  };

  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");

  console.log(`\n✅ 缓存已更新: ${CACHE_FILE}`);
  console.log(`📊 总计: ${cache.totalImages} 张图片有尺寸数据`);
  console.log(`🕐 更新时间: ${cache.lastUpdated}`);
}

main().catch((error) => {
  console.error("❌ 错误:", error.message);
  process.exit(1);
});
