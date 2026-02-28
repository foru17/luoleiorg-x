const CF_IMAGE_PROXY_HOST = "https://img.is26.com";

export function formatDate(dateInput: string): string {
  const date = new Date(dateInput);
  if (Number.isNaN(date.getTime())) return dateInput;

  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${y} 年 ${m} 月 ${d} 日`;
}

export function formatShowDate(dateInput: string): string {
  const source = new Date(dateInput);
  const now = new Date();

  // Same calendar day → "今天"
  if (
    source.getFullYear() === now.getFullYear() &&
    source.getMonth() === now.getMonth() &&
    source.getDate() === now.getDate()
  ) {
    return "今天";
  }

  return source.toISOString().slice(0, 10);
}

function normalizeImageSource(url: string): string {
  const source = url.trim();
  if (!source) return "";
  if (source.startsWith("//")) {
    return `https:${source}`;
  }
  return source;
}

function stripCfTransform(url: string): string {
  // 移除旧格式 /w=XXX 和新格式 ?variant=wXXX
  return url
    .replace(/\?variant=[^&]+/, "")
    .replace(/\/w=[^/?#]+(?:,[^/?#]+)*$/, "")
    .replace(/\?$/, "");
}

function toCfImage(url: string, transform?: string): string {
  const source = normalizeImageSource(url);
  if (!source) return "";

  if (source.startsWith("data:") || source.startsWith("blob:")) {
    return source;
  }

  if (source.startsWith("/") && !source.startsWith("//")) {
    return source;
  }

  if (source.startsWith(`${CF_IMAGE_PROXY_HOST}/`)) {
    const clean = stripCfTransform(source);
    return transform ? `${clean}?variant=${transform}` : clean;
  }

  const raw = source.startsWith("http") ? source : source.replace(/^\/+/, "");
  const proxied = `${CF_IMAGE_PROXY_HOST}/${raw}`;
  return transform ? `${proxied}?variant=${transform}` : proxied;
}

export function getOriginalImage(url: string): string {
  return toCfImage(url);
}

export function getPreviewImage(url?: string): string {
if (!url) return "";
return toCfImage(url, "w=800");
}

export function getArticleLazyImage(url: string): string {
return toCfImage(url, "w=1200");
}

export function getBannerImage(url?: string): string {
if (!url) return "";
return toCfImage(url, "w=800");
}

// 图片尺寸缓存 - 在构建时由 scripts/fetch-image-dimensions.mjs 生成
let imageDimensionsCache: Map<string, { width: number; height: number }> | null = null;

/**
 * 加载图片尺寸缓存
 * 只在构建时执行一次，运行时复用
 */
function loadImageDimensionsCache(): Map<string, { width: number; height: number }> {
  if (imageDimensionsCache) return imageDimensionsCache;

  imageDimensionsCache = new Map();

  try {
    // 在构建时通过 Vite 的 import.meta.glob 加载缓存文件
    const cacheFiles = import.meta.glob("/data/image-dimensions.json", {
      eager: true,
      import: "default",
    });

    const cachePath = "/data/image-dimensions.json";
    const cache = cacheFiles[cachePath] as
      | { images?: Record<string, { width: number; height: number }> }
      | undefined;

    if (cache?.images) {
      for (const [url, dimensions] of Object.entries(cache.images)) {
        // 存储原始 URL 和清理后的 URL
        imageDimensionsCache!.set(url, dimensions);
        // 也存储去掉转换参数的 URL
        const cleanUrl = stripCfTransform(url);
        if (cleanUrl !== url) {
          imageDimensionsCache!.set(cleanUrl, dimensions);
        }
      }
    }
  } catch {
    // 缓存文件不存在或加载失败，忽略错误
  }

  return imageDimensionsCache;
}

/**
 * 获取图片尺寸
 * @param url 图片 URL
 * @returns 图片尺寸或 null
 */
export function getImageDimensions(
  url: string,
): { width: number; height: number } | null {
  const cache = loadImageDimensionsCache();

  // 尝试直接匹配
  const directMatch = cache.get(url);
  if (directMatch) return directMatch;

  // 尝试清理后的 URL
  const cleanUrl = stripCfTransform(url);
  if (cleanUrl !== url) {
    const cleanMatch = cache.get(cleanUrl);
    if (cleanMatch) return cleanMatch;
  }

  // 尝试添加/移除协议
  const variations = [
    url.startsWith("https://") ? url.replace("https://", "http://") : null,
    url.startsWith("http://") ? url.replace("http://", "https://") : null,
    url.startsWith("https://") ? `//${url.slice(8)}` : null,
    url.startsWith("//") ? `https:${url}` : null,
  ].filter(Boolean);

  for (const variant of variations) {
    const match = cache.get(variant as string);
    if (match) return match;
  }

  return null;
}
