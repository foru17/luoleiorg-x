import { articlePageSize, categoryMap } from "@/lib/site-config";
import {
  hasUsablePageHits,
  KV_CACHE_KEY,
  type PageHitItem,
  type PageHitsPayload,
} from "@/lib/analytics";
import { fetchUmamiPageViews } from "@/lib/umami";
import { extractSlug, parsePositivePage } from "@/lib/utils";
import { getAllPosts } from "./posts";
import type { PostItem } from "./types";

const categoryNameMap = new Map<string, string>(
  categoryMap.map((item) => [item.text, item.name]),
);

// 服务端缓存（6小时）
const CACHE_VERSION = 3;
interface HitsCache {
  data: Map<string, number>;
  timestamp: number;
  version?: number;
}

let hitsCache: HitsCache | null = null;
let hitsRefreshPromise: Promise<void> | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const EMPTY_HITS_MAP = new Map<string, number>();

export interface PostListingResult {
  category?: string;
  categoryName?: string;
  posts: PostItem[];
  visiblePosts: PostItem[];
  hitsMap: Map<string, number>;
  hitsLoading: boolean;
  requestedPage: number;
  page: number;
  pageTotal: number;
}

function hasFreshHitsCache(cache: HitsCache | null): cache is HitsCache {
  return !!cache &&
    cache.version === CACHE_VERSION &&
    Date.now() - cache.timestamp < CACHE_TTL_MS;
}

function readHitsCache(): HitsCache | null {
  return hitsCache;
}

function buildHitsMap(items: PageHitItem[]) {
  const hitsMap = new Map<string, number>();

  for (const item of items) {
    const slug = extractSlug(item.page);
    const existing = hitsMap.get(slug) ?? 0;
    hitsMap.set(slug, existing + item.hit);
  }

  return hitsMap;
}

async function readHitsMapFromKV(): Promise<Map<string, number> | null> {
  const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;
  if (!KV) return null;

  try {
    const cachedData = await KV.get<PageHitsPayload>(KV_CACHE_KEY, "json");
    if (!hasUsablePageHits(cachedData)) {
      return null;
    }

    const hitsMap = buildHitsMap(cachedData.data);
    if (hitsMap.size === 0) {
      return null;
    }

    hitsCache = {
      data: hitsMap,
      timestamp: Date.now(),
      version: CACHE_VERSION,
    };

    return hitsMap;
  } catch (error) {
    console.warn("[Server] Failed to read hits cache from KV:", error);
    return null;
  }
}

function scheduleHitsRefresh() {
  if (hitsRefreshPromise) {
    return hitsRefreshPromise;
  }

  hitsRefreshPromise = (async () => {
    try {
      const result = await fetchUmamiPageViews();
      if (!hasUsablePageHits(result)) {
        console.warn("[Server] Skipped empty hits refresh result");
        return;
      }

      const nextHitsMap = buildHitsMap(result.data);
      if (nextHitsMap.size === 0) {
        console.warn("[Server] Skipped empty hits refresh map");
        return;
      }

      hitsCache = {
        data: nextHitsMap,
        timestamp: Date.now(),
        version: CACHE_VERSION,
      };

      const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;
      if (KV) {
        try {
          await KV.put(
            KV_CACHE_KEY,
            JSON.stringify({
              total: result.total,
              data: result.data,
              timestamp: Date.now(),
            }),
            { expirationTtl: CACHE_TTL_MS / 1000 },
          );
        } catch (error) {
          console.warn("[Server] Failed to write hits cache to KV:", error);
        }
      }
    } catch (error) {
      console.error("[Server] Failed to fetch hits:", error);
    }
  })().finally(() => {
    hitsRefreshPromise = null;
  });

  return hitsRefreshPromise;
}

async function getHitsMapWithStrategy(options?: {
  awaitWarmCache?: boolean;
}): Promise<{
  hitsMap: Map<string, number>;
  hitsLoading: boolean;
}> {
  if (hasFreshHitsCache(hitsCache)) {
    return { hitsMap: hitsCache.data, hitsLoading: false };
  }

  const kvHitsMap = await readHitsMapFromKV();
  if (kvHitsMap) {
    return { hitsMap: kvHitsMap, hitsLoading: false };
  }

  const refreshPromise = scheduleHitsRefresh();

  if (options?.awaitWarmCache && !hitsCache) {
    await refreshPromise;

    const warmedCache = readHitsCache();
    if (warmedCache) {
      return { hitsMap: warmedCache.data, hitsLoading: false };
    }
  }

  const staleCache = readHitsCache();
  if (staleCache) {
    return { hitsMap: staleCache.data, hitsLoading: false };
  }

  return { hitsMap: EMPTY_HITS_MAP, hitsLoading: true };
}

export function isKnownCategory(category: string): boolean {
  return categoryNameMap.has(category);
}

export function getCategoryName(category: string): string {
  return categoryNameMap.get(category) ?? category;
}

export async function getPostListing(params: {
  category?: string;
  pageParam?: string;
}): Promise<PostListingResult> {
  const category = params.category;
  const requestedPage = parsePositivePage(params.pageParam);
  const allPosts = getAllPosts();

  const needsStableHitOrder = category === "hot";
  const hitsPromise = getHitsMapWithStrategy({
    awaitWarmCache: needsStableHitOrder,
  });

  const posts =
    category && category !== "hot"
      ? allPosts.filter((post) => post.categories.includes(category))
      : allPosts;

  const { hitsMap, hitsLoading } = await hitsPromise;

  const sortedPosts =
    category === "hot"
      ? [...posts].sort(
          (a, b) => (hitsMap.get(b.slug) ?? 0) - (hitsMap.get(a.slug) ?? 0),
        )
      : posts;

  const pageTotal = Math.max(1, Math.ceil(sortedPosts.length / articlePageSize));
  const page = Math.min(requestedPage, pageTotal);
  const start = (page - 1) * articlePageSize;

  return {
    category,
    categoryName: category ? getCategoryName(category) : undefined,
    posts: sortedPosts,
    visiblePosts: sortedPosts.slice(start, start + articlePageSize),
    hitsMap,
    hitsLoading,
    requestedPage,
    page,
    pageTotal,
  };
}
