import { NextResponse } from "next/server";
import { fetchPageViews, hasUsablePageHits, KV_CACHE_KEY } from "@/lib/analytics";
import type { PageHitsPayload } from "@/lib/analytics";

export const runtime = "edge";
export const revalidate = 300; // 5 分钟

const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

function toResponseData(payload: Pick<PageHitsPayload, "total" | "data">) {
  return {
    total: payload.total,
    data: payload.data,
  };
}

export async function GET() {
  try {
    const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;
    let staleData: PageHitsPayload | null = null;
    
    // 检查缓存
    if (KV) {
      try {
        const cachedData = await KV.get<PageHitsPayload>(KV_CACHE_KEY, "json");
        if (hasUsablePageHits(cachedData)) {
          staleData = cachedData;
        }

        if (
          cachedData &&
          cachedData.timestamp &&
          Date.now() - cachedData.timestamp < CACHE_TTL_MS &&
          hasUsablePageHits(cachedData)
        ) {
          return NextResponse.json(
            toResponseData(cachedData),
            { headers: { "Cache-Control": "public, max-age=300", "X-Cache": "HIT" } }
          );
        }
      } catch (err) {
        console.warn("[Analytics API] KV get failure", err);
      }
    }

    // 从 Umami 获取数据
    const umamiData = await fetchPageViews();

    // 构造响应格式
    const data = {
      total: umamiData.total,
      data: umamiData.data,
    };

    // 更新缓存。Umami 短暂失败时会返回空数组，不能把空结果写入 KV。
    if (KV && hasUsablePageHits(data)) {
      try {
        await KV.put(
          KV_CACHE_KEY,
          JSON.stringify({ ...data, timestamp: Date.now() }),
          { expirationTtl: CACHE_TTL_SECONDS }
        );
      } catch (err) {
        console.warn("[Analytics API] KV put failure", err);
      }
    }

    if (!hasUsablePageHits(data)) {
      if (staleData) {
        return NextResponse.json(toResponseData(staleData), {
          headers: { "Cache-Control": "public, max-age=60", "X-Cache": "STALE" },
        });
      }

      return NextResponse.json(data, {
        headers: { "Cache-Control": "no-store", "X-Cache": "BYPASS" },
      });
    }

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300", "X-Cache": "MISS" },
    });
  } catch (error) {
    console.error("[Analytics API] Error:", error);

    // 发生错误时，尽量容退查找旧缓存
    const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;
    if (KV) {
      try {
        const staleData = await KV.get<PageHitsPayload>(KV_CACHE_KEY, "json");
        if (hasUsablePageHits(staleData)) {
          return NextResponse.json(toResponseData(staleData), {
            headers: { "Cache-Control": "public, max-age=60", "X-Cache": "STALE" },
          });
        }
      } catch {}
    }

    // 无缓存时返回空数据
    return NextResponse.json(
      { total: 0, data: [] },
      { headers: { "Cache-Control": "no-store", "X-Cache": "BYPASS" } },
    );
  }
}
