// Umami Analytics 集成
// 用于文章阅读量统计展示

import { fetchUmamiPageViews } from "./umami";
import { extractSlug } from "./utils";

// Local API route (used by client components)
export const API_PAGE_HITS = "/api/analytics/hits";

export interface PageHitItem {
  page: string;
  hit: number;
}

// 兼容旧代码的导出
export { fetchUmamiPageViews as fetchPageViews } from "./umami";
export type { UmamiStatsResult as StatsResult } from "./umami";

// Server-side cache for hits data (shared across requests)
interface HitsCache {
  data: PageHitItem[];
  timestamp: number;
}

// 强制重置缓存（部署后清除旧缓存）
const CACHE_VERSION = 2;
let serverHitsCache: (HitsCache & { version?: number }) | null = null;
const SERVER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const KV_CACHE_KEY = "umami_pageviews_cache";

/**
 * 服务端获取单篇文章的浏览量（用于 Server Components）
 * 优先使用注入到 globalThis 的 CACHE_KV，若没有再走 Umami API
 */
export async function getPageHits(slug: string): Promise<number> {
  const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;

  // 1. 优先尝试从全局 CF KV 读取最新数据
  if (KV) {
    try {
      const cached = await KV.get<{ total: number; data: PageHitItem[]; timestamp: number }>(KV_CACHE_KEY, "json");
      if (cached && Date.now() - cached.timestamp < SERVER_CACHE_TTL) {
        return calculateHitsForSlug(cached.data, slug);
      }
    } catch (err) {
      console.warn("[getPageHits] KV read failed", err);
    }
  }

  // 2. 本地内存版本回退校验 (主要做开发环境没有绑定KV的兼容)
  if (serverHitsCache && 
      serverHitsCache.version === CACHE_VERSION &&
      Date.now() - serverHitsCache.timestamp < SERVER_CACHE_TTL) {
    return calculateHitsForSlug(serverHitsCache.data, slug);
  }

  try {
    const result = await fetchUmamiPageViews();
    const data = result.data || [];

    // 更新内存缓存
    serverHitsCache = { data, timestamp: Date.now(), version: CACHE_VERSION };

    // 如果绑定了 KV，同步更新到 KV
    if (KV) {
      try {
        await KV.put(
          KV_CACHE_KEY,
          JSON.stringify({ total: result.total, data, timestamp: Date.now() }),
          { expirationTtl: SERVER_CACHE_TTL / 1000 }
        );
      } catch (err) {
        console.warn("[getPageHits] KV put failed", err);
      }
    }

    const hits = calculateHitsForSlug(data, slug);
    return hits;
  } catch (error) {
    console.error("[getPageHits] Error:", error);
    
    // 如果失败且有 KV，尝试拿 stale KV 数据
    if (KV) {
      try {
        const stale = await KV.get<{ data: PageHitItem[] }>(KV_CACHE_KEY, "json");
        if (stale?.data) return calculateHitsForSlug(stale.data, slug);
      } catch {}
    }

    if (serverHitsCache) {
      return calculateHitsForSlug(serverHitsCache.data, slug);
    }
    return 0;
  }
}

/**
 * 计算指定 slug 的总浏览量（处理多路径如 /slug, /slug/, /slug/amp/）
 */
function calculateHitsForSlug(data: PageHitItem[], slug: string): number {
  const targetSlug = extractSlug(`/${slug}`);
  let total = 0;
  for (const item of data) {
    if (extractSlug(item.page) === targetSlug) {
      total += item.hit;
    }
  }
  return total;
}
