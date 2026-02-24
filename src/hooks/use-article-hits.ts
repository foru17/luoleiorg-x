"use client";

import { useEffect, useMemo, useState } from "react";
import { API_PAGE_HITS, type PageHitItem } from "@/lib/analytics";

export function useArticleHits() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PageHitItem[]>([]);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const res = await fetch(API_PAGE_HITS, { cache: "no-store" });
        const json = (await res.json()) as { data?: PageHitItem[] };
        if (active) {
          setItems(Array.isArray(json.data) ? json.data : []);
        }
      } catch {
      } finally {
        if (active) setLoading(false);
      }
    }
    run();
    return () => {
      active = false;
    };
  }, []);

  const map = useMemo(() => {
    const m = new Map<string, number>();
    for (const item of items) {
      m.set(item.page.replace(/^\//, ""), item.hit);
    }
    return m;
  }, [items]);

  return { loading, map };
}

export function usePageHits(slug: string) {
  const [loading, setLoading] = useState(true);
  const [hits, setHits] = useState(0);

  useEffect(() => {
    let active = true;
    async function run() {
      try {
        const pagePath = `/${slug}`;
        const res = await fetch(`${API_PAGE_HITS}?page=${pagePath}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as { data?: PageHitItem[] };
        const found = json.data?.find((item) => item.page === pagePath);
        if (active) {
          setHits(found?.hit ?? 0);
        }
      } catch {
      } finally {
        if (active) setLoading(false);
      }
    }
    run();
    return () => {
      active = false;
    };
  }, [slug]);

  return { loading, hits };
}
