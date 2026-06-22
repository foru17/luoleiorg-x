import { NextResponse } from "next/server";
import { fetchWebsiteSummary } from "@/lib/umami";

export const runtime = "edge";
export const revalidate = 300; // 5 分钟缓存

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

const CACHE_KEY = "umami_summary_cache_v4";

interface CachedAnalyticsSummary {
  totalPageViews: number;
  totalVisitors: number;
  totalVisits: number;
  recentVisitor: {
    country: string;
    region: string;
    city: string;
    lastAt: string;
  } | null;
  timestamp?: number;
}

function hasUsableTotals(data: Pick<CachedAnalyticsSummary, "totalPageViews" | "totalVisitors" | "totalVisits">) {
  return data.totalPageViews > 0 || data.totalVisitors > 0 || data.totalVisits > 0;
}

function hasCompleteTotals(data: Pick<CachedAnalyticsSummary, "totalPageViews" | "totalVisitors" | "totalVisits">) {
  return data.totalPageViews > 0 && data.totalVisitors > 0 && data.totalVisits > 0;
}

function toResponseData(data: CachedAnalyticsSummary) {
  return {
    totalPageViews: data.totalPageViews,
    totalVisitors: data.totalVisitors,
    totalVisits: data.totalVisits,
    recentVisitor: data.recentVisitor,
  };
}

export async function GET() {
  try {
    const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;

    // 检查缓存
    if (KV) {
      try {
        const cachedData = await KV.get<CachedAnalyticsSummary>(CACHE_KEY, "json");

        if (
          cachedData &&
          cachedData.timestamp &&
          Date.now() - cachedData.timestamp < CACHE_TTL_MS &&
          hasUsableTotals(cachedData)
        ) {
          return NextResponse.json(
            toResponseData(cachedData),
            {
              headers: {
                "Cache-Control": "public, max-age=300",
                "X-Cache": "HIT",
              },
            }
          );
        }
      } catch (err) {
        console.warn("[Analytics Summary API] KV get failure", err);
      }
    }

    // 从 Umami 获取数据
    const summary = await fetchWebsiteSummary();

    // 构造响应
    const data = {
      totalPageViews: summary.totalPageViews,
      totalVisitors: summary.totalVisitors,
      totalVisits: summary.totalVisits,
      recentVisitor: summary.recentVisitor,
    };

    // 更新缓存。避免把 Umami 临时失败造成的 0 或半截结果写入边缘缓存。
    if (KV && hasCompleteTotals(data)) {
      try {
        await KV.put(
          CACHE_KEY,
          JSON.stringify({ ...data, timestamp: Date.now() }),
          { expirationTtl: CACHE_TTL_SECONDS }
        );
      } catch (err) {
        console.warn("[Analytics Summary API] KV put failure", err);
      }
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": hasCompleteTotals(data) ? "public, max-age=300" : "no-store",
        "X-Cache": hasCompleteTotals(data) ? "MISS" : "BYPASS",
      },
    });
  } catch (error) {
    console.error("[Analytics Summary API] Error:", error);

    // 发生错误时，尽量容退查找旧缓存
    const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;
    if (KV) {
      try {
        const staleData = await KV.get<CachedAnalyticsSummary>(CACHE_KEY, "json");
        if (staleData && hasUsableTotals(staleData)) {
          return NextResponse.json(toResponseData(staleData), {
            headers: {
              "Cache-Control": "public, max-age=60",
              "X-Cache": "STALE",
            },
          });
        }
      } catch {}
    }

    // 无缓存时返回空数据
    return NextResponse.json(
      {
        totalPageViews: 0,
        totalVisitors: 0,
        totalVisits: 0,
        recentVisitor: null,
      },
      {
        headers: { "Cache-Control": "public, max-age=60" },
      }
    );
  }
}
