import { NextResponse } from "next/server";
import { fetchPageViews, KV_CACHE_KEY } from "@/lib/analytics";
import type { PageHitItem } from "@/lib/analytics";

export const runtime = "edge";
export const revalidate = 300; // 5 分钟

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

export async function GET() {
  try {
    const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;
    
    // 检查缓存
    if (KV) {
      try {
        const cachedData = await KV.get<{ total: number; data: PageHitItem[]; timestamp: number }>(KV_CACHE_KEY, "json");
        if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL_MS) {
          return NextResponse.json(
            { total: cachedData.total, data: cachedData.data },
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

    // 更新缓存
    if (KV) {
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

    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=300", "X-Cache": "MISS" },
    });
  } catch (error) {
    console.error("[Analytics API] Error:", error);

    // 发生错误时，尽量容退查找旧缓存
    const KV = (globalThis as unknown as { CACHE_KV?: KVNamespace }).CACHE_KV;
    if (KV) {
      try {
        const staleData = await KV.get<{ total: number; data: PageHitItem[] }>(KV_CACHE_KEY, "json");
        if (staleData) {
          return NextResponse.json(
            { total: staleData.total, data: staleData.data },
            { headers: { "Cache-Control": "public, max-age=3600", "X-Cache": "STALE" } }
          );
        }
      } catch {}
    }

    // 无缓存时返回空数据
    return NextResponse.json(
      { total: 0, data: [] },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  }
}
