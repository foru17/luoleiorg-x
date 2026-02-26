import { fetchGA4PageViews, isGA4Configured } from "@/lib/ga4";
import { articlePageSize, categoryMap } from "@/lib/site-config";
import { getAllPosts } from "./posts";
import type { PostItem } from "./types";

const categoryNameMap = new Map<string, string>(
  categoryMap.map((item) => [item.text, item.name]),
);

// 服务端缓存（6小时，因为 GA4 数据有 24-48 小时延迟）
interface HitsCache {
  data: Map<string, number>;
  timestamp: number;
  loading: boolean;
}

let hitsCache: HitsCache | null = null;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6小时

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

function parsePageNumber(pageParam?: string): number {
  if (!pageParam) return 1;
  const parsed = Number(pageParam);
  if (!Number.isFinite(parsed)) return 1;
  const integer = Math.trunc(parsed);
  return integer > 0 ? integer : 1;
}

function extractSlug(page: string): string {
  let path = page;
  
  if (path.includes("://")) {
    try {
      const url = new URL(path);
      path = url.pathname;
    } catch {
      // If URL parsing fails, treat as path
    }
  }
  
  // Remove leading slash and extract only the first segment
  // This ensures /slug/amp/ and /slug/ both map to "slug"
  const segments = path.replace(/^\//, "").split("/");
  return segments[0] || "";
}

async function getHitsMap(): Promise<{
  hitsMap: Map<string, number>;
  hitsLoading: boolean;
}> {
  // 检查缓存
  if (hitsCache && Date.now() - hitsCache.timestamp < CACHE_TTL_MS) {
    console.log("[Server] Using cached hits data");
    return { hitsMap: hitsCache.data, hitsLoading: hitsCache.loading };
  }

  const staleCache = hitsCache;

  // 启动获取
  const fetchPromise = (async () => {
    const hitsMap = new Map<string, number>();
    let loading = true;

    try {
      if (!isGA4Configured()) {
        console.warn("[Server] GA4 not configured");
        loading = false;
      } else {
        console.log("[Server] Fetching hits from GA4...");
        const results = await fetchGA4PageViews();
        
        for (const item of results) {
          const slug = extractSlug(item.page);
          const existingHit = hitsMap.get(slug) ?? 0;
          hitsMap.set(slug, existingHit + item.hit);
        }
        loading = false;
        console.log("[Server] Hits loaded:", hitsMap.size, "unique slugs");
      }
    } catch (error) {
      console.error("[Server] Failed to fetch hits:", error);
    }

    hitsCache = {
      data: hitsMap,
      timestamp: Date.now(),
      loading,
    };

    return { hitsMap, hitsLoading: loading };
  })();

  if (staleCache) {
    fetchPromise.catch(() => {});
    return { hitsMap: staleCache.data, hitsLoading: staleCache.loading };
  }

  return fetchPromise;
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
  const requestedPage = parsePageNumber(params.pageParam);
  const allPosts = getAllPosts();
  
  const hitsPromise = getHitsMap();
  
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
