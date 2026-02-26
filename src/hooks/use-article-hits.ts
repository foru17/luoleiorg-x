"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { API_PAGE_HITS, type PageHitItem } from "@/lib/analytics";

// Global cache shared across all hook instances
interface GlobalCache {
  data: PageHitItem[] | null;
  timestamp: number;
  promise: Promise<PageHitItem[]> | null;
}

const globalCache: GlobalCache = {
  data: null,
  timestamp: 0,
  promise: null,
};

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes for client-side cache

/**
 * Extract slug from page path/URL
 * Handles formats:
 * - "/article-slug" → "article-slug"
 * - "https://example.com/article-slug/" → "article-slug"
 * - "https://example.com/article-slug" → "article-slug"
 */
function extractSlug(page: string): string {
  // Remove protocol and domain if present
  let path = page;
  
  // Handle full URLs like "https://luolei.org/article-slug/"
  if (path.includes("://")) {
    try {
      const url = new URL(path);
      path = url.pathname;
    } catch {
      // If URL parsing fails, treat as path
    }
  }
  
  // Remove leading slash and extract only the first segment
  // This ensures /slug/amp/, /slug/, and /slug all map to "slug"
  const segments = path.replace(/^\//, "").split("/");
  return segments[0] || "";
}

async function fetchHitsData(): Promise<PageHitItem[]> {
  // Return cached data if fresh
  if (globalCache.data && Date.now() - globalCache.timestamp < CACHE_TTL_MS) {
    return globalCache.data;
  }

  // Return existing promise if there's an in-flight request
  if (globalCache.promise) {
    return globalCache.promise;
  }

  // Start new fetch
  globalCache.promise = (async () => {
    try {
      const res = await fetch(API_PAGE_HITS, { 
        cache: "no-store",
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });
      const json = (await res.json()) as { data?: PageHitItem[] };
      const data = Array.isArray(json.data) ? json.data : [];
      
      // Update cache
      globalCache.data = data;
      globalCache.timestamp = Date.now();
      
      return data;
    } catch {
      return globalCache.data ?? [];
    } finally {
      globalCache.promise = null;
    }
  })();

  return globalCache.promise;
}

export function useArticleHits() {
  const [loading, setLoading] = useState(!globalCache.data);
  const [items, setItems] = useState<PageHitItem[]>(globalCache.data ?? []);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    
    async function load() {
      // If we have cached data, use it immediately
      if (globalCache.data && Date.now() - globalCache.timestamp < CACHE_TTL_MS) {
        if (mountedRef.current) {
          setItems(globalCache.data);
          setLoading(false);
        }
        return;
      }

      // Otherwise fetch
      if (mountedRef.current) {
        setLoading(true);
      }
      
      const data = await fetchHitsData();
      
      if (mountedRef.current) {
        setItems(data);
        setLoading(false);
      }
    }

    void load();
    
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const map = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of items) {
      const slug = extractSlug(item.page);
      // Accumulate hits for the same slug (handles /slug, /slug/, /slug/amp/ etc.)
      const existingHit = m.get(slug) ?? 0;
      m.set(slug, existingHit + item.hit);
    }
    return m;
  }, [items]);

  return { loading, map };
}

export function usePageHits(slug: string) {
  const [loading, setLoading] = useState(!globalCache.data);
  const [hits, setHits] = useState(() => {
    // Try to get from cache immediately
    if (globalCache.data) {
      // Accumulate all hits for this slug (handles /slug, /slug/, /slug/amp/ etc.)
      let totalHits = 0;
      for (const item of globalCache.data) {
        if (extractSlug(item.page) === slug) {
          totalHits += item.hit;
        }
      }
      return totalHits;
    }
    return 0;
  });
  const mountedRef = useRef(true);

  const updateHits = useCallback((items: PageHitItem[]) => {
    // Accumulate all hits for this slug (handles /slug, /slug/, /slug/amp/ etc.)
    let totalHits = 0;
    for (const item of items) {
      if (extractSlug(item.page) === slug) {
        totalHits += item.hit;
      }
    }
    setHits(totalHits);
  }, [slug]);

  useEffect(() => {
    mountedRef.current = true;
    
    async function load() {
      // If we have cached data, use it immediately
      if (globalCache.data && Date.now() - globalCache.timestamp < CACHE_TTL_MS) {
        if (mountedRef.current) {
          updateHits(globalCache.data);
          setLoading(false);
        }
        return;
      }

      // Otherwise fetch
      if (mountedRef.current) {
        setLoading(true);
      }
      
      const data = await fetchHitsData();
      
      if (mountedRef.current) {
        updateHits(data);
        setLoading(false);
      }
    }

    void load();
    
    return () => {
      mountedRef.current = false;
    };
  }, [slug, updateHits]);

  return { loading, hits };
}
