"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSummary } from "@/lib/analytics/summary";

const CLIENT_CACHE_KEY = "umami_analytics_cache";
const CLIENT_CACHE_TTL_MS = 5 * 60 * 1000;
const LOADING_INDICATOR_DELAY_MS = 300;

function hasUsableSummary(data: AnalyticsSummary): boolean {
  return data.totalPageViews > 0 || data.totalVisitors > 0 || data.totalVisits > 0;
}

function readClientCache(): AnalyticsSummary | null {
  if (typeof window === "undefined") return null;

  try {
    const cached = localStorage.getItem(CLIENT_CACHE_KEY);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached) as {
      data: AnalyticsSummary;
      timestamp: number;
    };
    if (Date.now() - timestamp > CLIENT_CACHE_TTL_MS) return null;
    if (!hasUsableSummary(data)) return null;

    return data;
  } catch {
    return null;
  }
}

function writeClientCache(data: AnalyticsSummary) {
  if (typeof window === "undefined") return;
  if (!hasUsableSummary(data)) return;

  try {
    localStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    // Ignore cache write failures in restricted environments.
  }
}

export function useAnalyticsSummary() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      const hideTimerId = window.setTimeout(() => {
        setShowLoading(false);
      }, 0);

      return () => window.clearTimeout(hideTimerId);
    }

    const timerId = window.setTimeout(() => {
      setShowLoading(true);
    }, LOADING_INDICATOR_DELAY_MS);

    return () => window.clearTimeout(timerId);
  }, [isLoading]);

  useEffect(() => {
    let isActive = true;
    const cached = readClientCache();

    async function fetchAnalyticsSummary() {
      setIsLoading(true);

      try {
        const response = await fetch("/api/analytics/summary");
        if (!response.ok) return;

        const data = (await response.json()) as AnalyticsSummary;
        if (!isActive) return;
        if (!hasUsableSummary(data)) return;

        setSummary(data);
        writeClientCache(data);
      } catch (error) {
        console.error("Failed to fetch analytics summary:", error);
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    const fetchTimerId = window.setTimeout(() => {
      if (!isActive) return;

      if (cached) {
        setSummary(cached);
      }

      void fetchAnalyticsSummary();
    }, 0);

    return () => {
      isActive = false;
      window.clearTimeout(fetchTimerId);
    };
  }, []);

  return {
    showLoading,
    summary,
  };
}
