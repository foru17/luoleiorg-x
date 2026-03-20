import { articlePageSize, categoryMap } from "@/lib/site-config";
import { fetchUmamiPageViews } from "@/lib/umami";
import { extractSlug, parsePositivePage } from "@/lib/utils";
import { getAllPosts } from "./posts";
import type { PostItem } from "./types";

const categoryNameMap = new Map<string, string>(
  categoryMap.map((item) => [item.text, item.name]),
);

// 服务端缓存（6小时）
const CACHE_VERSION = 2;
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

function scheduleHitsRefresh() {
  if (hitsRefreshPromise) {
    return hitsRefreshPromise;
  }

  hitsRefreshPromise = (async () => {
    const nextHitsMap = new Map<string, number>();

    try {
      const result = await fetchUmamiPageViews();

      for (const item of result.data) {
        const slug = extractSlug(item.page);
        const existing = nextHitsMap.get(slug) ?? 0;
        nextHitsMap.set(slug, existing + item.hit);
      }

      hitsCache = {
        data: nextHitsMap,
        timestamp: Date.now(),
        version: CACHE_VERSION,
      };
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

  const refreshPromise = scheduleHitsRefresh();

  if (options?.awaitWarmCache && !hitsCache) {
    await refreshPromise;

    if (hitsCache) {
      return { hitsMap: hitsCache.data, hitsLoading: false };
    }
  }

  if (hitsCache) {
    return { hitsMap: hitsCache.data, hitsLoading: false };
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
