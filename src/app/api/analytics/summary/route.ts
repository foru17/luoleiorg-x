import { NextResponse } from "next/server";
import { fetchWebsiteSummary } from "@/lib/umami";

export const runtime = "edge";
export const revalidate = 300; // 5 分钟缓存

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

const CACHE_KEY = "umami_summary_cache";

export async function GET() {
  try {
    const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;

    // 检查缓存
    if (KV) {
      try {
        const cachedData = await KV.get<{
          totalPageViews: number;
          totalVisitors: number;
          totalVisits: number;
          recentVisitor: {
            country: string;
            region: string;
            city: string;
            lastAt: string;
          } | null;
          timestamp: number;
        }>(CACHE_KEY, "json");

        if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL_MS) {
          return NextResponse.json(
            {
              totalPageViews: cachedData.totalPageViews,
              totalVisitors: cachedData.totalVisitors,
              totalVisits: cachedData.totalVisits,
              recentVisitor: cachedData.recentVisitor,
            },
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

    // 更新缓存
    if (KV) {
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
        "Cache-Control": "public, max-age=300",
        "X-Cache": "MISS",
      },
    });
  } catch (error) {
    console.error("[Analytics Summary API] Error:", error);

    // 发生错误时，尽量容退查找旧缓存
    const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;
    if (KV) {
      try {
        const staleData = await KV.get<{
          totalPageViews: number;
          totalVisitors: number;
          totalVisits: number;
          recentVisitor: {
            country: string;
            region: string;
            city: string;
            lastAt: string;
          } | null;
        }>(CACHE_KEY, "json");
        if (staleData) {
          return NextResponse.json(staleData, {
            headers: {
              "Cache-Control": "public, max-age=60",
              "X-Cache": "STALE",
            },
          });
        }
      } catch (err) {}
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
