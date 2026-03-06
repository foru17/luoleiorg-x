/**
 * Umami Analytics API Client
 * 用于从自托管 Umami 获取统计数据
 */

import { getUmamiConfig } from "./umami-config";

// 统计数据项
export interface UmamiPageView {
  page: string;
  hit: number;
}

export interface UmamiStatsResult {
  total: number;
  data: UmamiPageView[];
}

/**
 * 从 Umami API 获取页面浏览量数据
 * 
 * 本地开发和生产环境都会调用 Umami API 获取历史统计数据
 * 注意：Umami 只记录配置的域名（luolei.org）的新访问，但 API 可以查询所有历史数据
 */
export async function fetchUmamiPageViews(): Promise<UmamiStatsResult> {
  try {
    const { apiUrl, websiteId, apiToken } = getUmamiConfig();

    if (!apiUrl || !websiteId) {
      console.warn("[Umami] API URL or Website ID not configured");
      return { total: 0, data: [] };
    }

    // 计算时间范围：从 2015-01-01 到当前时间
    const startAt = new Date("2015-01-01").getTime();
    const endAt = Date.now();

    // 构建请求头
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiToken) {
      headers["Authorization"] = `Bearer ${apiToken}`;
    }

    // 尝试获取页面 URL 统计数据 - 使用 /metrics 端点
    // Umami v3 API: type=path (v2 是 type=url)
    const metricsUrl = new URL(`${apiUrl}/websites/${websiteId}/metrics`);
    metricsUrl.searchParams.set("startAt", startAt.toString());
    metricsUrl.searchParams.set("endAt", endAt.toString());
    metricsUrl.searchParams.set("type", "path");
    metricsUrl.searchParams.set("limit", "2000");

    // 使用 AbortController 替代 AbortSignal.timeout（兼容性更好）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const metricsResponse = await fetch(metricsUrl.toString(), {
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    let pageData: UmamiPageView[] = [];

    if (metricsResponse.ok) {
      const metricsData = (await metricsResponse.json()) as Array<{
        x: string;
        y: number;
      }>;

      pageData = metricsData.map((item) => ({
        page: item.x,
        hit: item.y,
      }));
    } else {
      const errorText = await metricsResponse.text().catch(() => "Unknown error");
      console.error("[Umami] Metrics API error:", metricsResponse.status, errorText);

      // 如果 metrics 失败，尝试 pageviews 端点
      const pageviewsUrl = new URL(`${apiUrl}/websites/${websiteId}/pageviews`);
      pageviewsUrl.searchParams.set("startAt", startAt.toString());
      pageviewsUrl.searchParams.set("endAt", endAt.toString());
      pageviewsUrl.searchParams.set("unit", "year");
      pageviewsUrl.searchParams.set("tz", "Asia/Shanghai");

      const pvController = new AbortController();
      const pvTimeoutId = setTimeout(() => pvController.abort(), 10000);
      
      const pageviewsResponse = await fetch(pageviewsUrl.toString(), {
        headers,
        signal: pvController.signal,
      });
      
      clearTimeout(pvTimeoutId);

      if (pageviewsResponse.ok) {
        const pageviewsData = (await pageviewsResponse.json()) as {
          pageviews?: Array<{ x: string; y: number }>;
        };

        if (pageviewsData.pageviews) {
          pageData = pageviewsData.pageviews.map((item) => ({
            page: item.x,
            hit: item.y,
          }));
        }
      } else {
        const errorText = await pageviewsResponse.text().catch(() => "Unknown error");
        console.error("[Umami] Pageviews API error:", pageviewsResponse.status, errorText);
      }
    }

    if (pageData.length === 0) {
      console.warn("[Umami] No page data available from API");
    }

    const total = pageData.reduce((sum, item) => sum + item.hit, 0);

    return {
      total,
      data: pageData,
    };
  } catch (error) {
    console.error("[Umami] Failed to fetch page views:", error);
    // 出错时返回空数据，不影响页面渲染
    return { total: 0, data: [] };
  }
}

/**
 * 验证 Umami 配置是否完整
 */
export function isUmamiConfigured(): boolean {
  const config = getUmamiConfig();
  return !!(config.apiUrl && config.websiteId);
}

/**
 * 获取 Umami 追踪脚本配置
 */
export function getUmamiScriptConfig():
  | {
      src: string;
      websiteId: string;
    }
  | null {
  const { websiteId, scriptUrl } = getUmamiConfig();

  if (!websiteId) {
    return null;
  }

  return {
    src: scriptUrl,
    websiteId,
  };
}

/**
 * 最近访客信息
 */
export interface RecentVisitor {
  country: string;
  region: string;
  city: string;
  lastAt: string;
}

/**
 * 网站统计摘要
 */
export interface WebsiteSummary {
  totalPageViews: number;
  totalVisitors: number;
  totalVisits: number;
  recentVisitor: RecentVisitor | null;
}

/**
 * 从 Umami API 获取网站总统计
 */
export async function fetchUmamiStats(): Promise<{
  pageviews: number;
  visitors: number;
  visits: number;
} | null> {
  try {
    const { apiUrl, websiteId, apiToken } = getUmamiConfig();
    
    if (!apiUrl || !websiteId) {
      console.warn("[Umami] API URL or Website ID not configured");
      return null;
    }
    
    // 计算时间范围：从 2015-01-01 到当前时间
    const startAt = new Date("2015-01-01").getTime();
    const endAt = Date.now();

    // 构建请求头
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiToken) {
      headers["Authorization"] = `Bearer ${apiToken}`;
    }

    // 使用 /stats 端点获取总统计
    const statsUrl = new URL(`${apiUrl}/websites/${websiteId}/stats`);
    statsUrl.searchParams.set("startAt", startAt.toString());
    statsUrl.searchParams.set("endAt", endAt.toString());
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(statsUrl.toString(), {
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = (await response.json()) as {
        pageviews: number;
        visitors: number;
        visits: number;
      };

      return data;
    } else {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error("[Umami] Stats API error:", response.status, errorText);
      return null;
    }
  } catch (error) {
    console.error("[Umami] Failed to fetch stats:", error);
    return null;
  }
}

/**
 * 从 Umami API 获取最近访客信息（带重试机制）
 * 优先使用实时数据，如果没有则查询最近7天的会话
 */
export async function fetchRecentVisitor(): Promise<RecentVisitor | null> {
  const MAX_RETRIES = 1;
  const TIMEOUT_MS = 8000; // 8秒超时
  
  const { apiUrl, websiteId, apiToken } = getUmamiConfig();
  
  if (!apiUrl || !websiteId) {
    console.warn("[Umami] API URL or Website ID not configured");
    return null;
  }
  
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  
  if (apiToken) {
    headers["Authorization"] = `Bearer ${apiToken}`;
  }
  
  // 首先尝试获取实时数据（最近30分钟）
  try {
    const realtimeUrl = new URL(`${apiUrl}/realtime/${websiteId}`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    const response = await fetch(realtimeUrl.toString(), {
      headers,
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const rawData = await response.json() as {
        events?: Array<{
          country?: string;
          createdAt?: string;
        }>;
      };

      // realtime 返回的 events 数组包含最近的访问事件
      if (rawData.events && rawData.events.length > 0) {
        // 获取第一个事件（最新的）
        const event = rawData.events[0];
        const visitor: RecentVisitor = {
          country: event.country || "Unknown",
          region: "", // realtime 不返回 region
          city: "",   // realtime 不返回 city
          lastAt: event.createdAt || new Date().toISOString(),
        };
        return visitor;
      }
    } else {
      const errorText = await response.text().catch(() => "Unknown error");
      console.warn("[Umami] Realtime API error:", response.status, errorText);
    }
  } catch (error) {
    console.warn("[Umami] Failed to fetch realtime data:", error);
  }
  
  // 如果 realtime 失败或没有数据，回退到 sessions 查询（最近7天）
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 计算时间范围：最近7天（之前是24小时，可能太短了）
      const endAt = Date.now();
      const startAt = endAt - 7 * 24 * 60 * 60 * 1000; // 7天前
      
      // 使用 /sessions 端点获取最近访客
      const sessionsUrl = new URL(`${apiUrl}/websites/${websiteId}/sessions`);
      sessionsUrl.searchParams.set("startAt", startAt.toString());
      sessionsUrl.searchParams.set("endAt", endAt.toString());
      sessionsUrl.searchParams.set("page", "1");
      sessionsUrl.searchParams.set("pageSize", "1"); // 只获取最近的一条
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
      
      const response = await fetch(sessionsUrl.toString(), {
        headers,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const rawData = await response.json();
        const data = rawData as {
          data: Array<{
            country: string;
            region: string;
            city: string;
            lastAt: string;
          }>;
        };
        
        if (data.data && data.data.length > 0) {
          const visitor = data.data[0];
          return {
            country: visitor.country || "Unknown",
            region: visitor.region || "",
            city: visitor.city || "",
            lastAt: visitor.lastAt,
          };
        }
        
        return null;
      } else {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error(`[Umami] Sessions API error (attempt ${attempt + 1}):`, response.status, errorText);
        
        // 如果不是最后一次尝试，继续重试
        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // 递增延迟
          continue;
        }
        
        return null;
      }
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      
      if (isAbortError) {
        console.error(`[Umami] Fetch recent visitor timeout (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      } else {
        console.error(`[Umami] Failed to fetch recent visitor (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error);
      }
      
      // 如果不是最后一次尝试，继续重试
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // 递增延迟
        continue;
      }
      
      return null;
    }
  }
  
  return null;
}

/**
 * 获取网站统计摘要（总浏览量 + 最近访客）
 */
export async function fetchWebsiteSummary(): Promise<WebsiteSummary> {
  const [stats, recentVisitor] = await Promise.all([
    fetchUmamiStats(),
    fetchRecentVisitor(),
  ]);
  
  return {
    totalPageViews: stats?.pageviews || 0,
    totalVisitors: stats?.visitors || 0,
    totalVisits: stats?.visits || 0,
    recentVisitor,
  };
}

