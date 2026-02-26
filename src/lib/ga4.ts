import { SignJWT } from "jose";

// GA4 Data API 配置 - 使用函数懒读取，避免模块初始化时 process.env 为空
// 在 Cloudflare Workers 中，secrets 只能通过 env 参数传入，
// worker/index.ts 在每次请求时将其注入到 process.env
function getGA4Config() {
  return {
    propertyId: process.env.GA4_PROPERTY_ID || "123456789",
    clientEmail: process.env.GA4_CLIENT_EMAIL || "",
    privateKey: process.env.GA4_PRIVATE_KEY || "",
  };
}

interface GA4Row {
  dimensionValues: Array<{ value: string }>;
  metricValues: Array<{ value: string }>;
}

interface GA4Response {
  rows?: GA4Row[];
}

/**
 * 将 Base64 字符串转换为 ArrayBuffer
 * 兼容 Cloudflare Workers 环境（使用 Buffer 而非 atob）
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const buffer = Buffer.from(base64, 'base64');
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/**
 * 解析 PEM 格式的私钥
 */
function parsePrivateKey(pem: string): ArrayBuffer {
  // 移除 PEM 头尾标记和换行符
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  
  return base64ToArrayBuffer(cleaned);
}

/**
 * 生成 Google API 访问用的 JWT Token
 */
async function getAccessToken(): Promise<string> {
  const GA4_CONFIG = getGA4Config();
  console.log("[GA4] Checking GA4 config...");
  console.log("[GA4] Property ID:", GA4_CONFIG.propertyId);
  console.log("[GA4] Client Email exists:", !!GA4_CONFIG.clientEmail);
  console.log("[GA4] Private Key exists:", !!GA4_CONFIG.privateKey);
  console.log("[GA4] Private Key length:", GA4_CONFIG.privateKey?.length);

  if (!GA4_CONFIG.clientEmail || !GA4_CONFIG.privateKey) {
    throw new Error("GA4 credentials not configured");
  }

  try {
    // 解析 PEM 私钥
    console.log("[GA4] Parsing private key...");
    const keyData = parsePrivateKey(GA4_CONFIG.privateKey);
    console.log("[GA4] Key data length:", keyData.byteLength);

    console.log("[GA4] Importing key with crypto.subtle...");
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
    console.log("[GA4] Key imported successfully");

    const jwt = await new SignJWT({
      iss: GA4_CONFIG.clientEmail,
      sub: GA4_CONFIG.clientEmail,
      scope: "https://www.googleapis.com/auth/analytics.readonly",
      aud: "https://oauth2.googleapis.com/token",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    console.log("[GA4] JWT signed, fetching access token...");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error("[GA4] Token fetch failed:", tokenResponse.status, error);
      throw new Error(`Token fetch failed: ${tokenResponse.status} ${error}`);
    }

    console.log("[GA4] Access token obtained");
    const { access_token } = (await tokenResponse.json()) as { access_token: string };
    return access_token;
  } catch (error) {
    console.error("[GA4] Error in getAccessToken:", error);
    throw error;
  }
}

/**
 * 从 GA4 Data API 获取页面浏览量数据
 */
export async function fetchGA4PageViews(): Promise<Array<{ page: string; hit: number }>> {
  try {
    console.log("[GA4] Starting fetchGA4PageViews...");
    const accessToken = await getAccessToken();
    
    // 计算日期范围（GA4 数据有延迟，查询前天及之前的数据）
    const endDate = new Date();
    endDate.setDate(endDate.getDate() - 1); // 昨天
    const startDate = new Date("2016-01-01"); // GA4 要求开始日期 > 2015-08-13

    console.log("[GA4] Fetching report from GA4 Data API...");
    const response = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${getGA4Config().propertyId}:runReport`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRanges: [
            {
              startDate: startDate.toISOString().split("T")[0],
              endDate: endDate.toISOString().split("T")[0],
            },
          ],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          dimensionFilter: {
            filter: {
              fieldName: "pagePath",
              stringFilter: {
                matchType: "BEGINS_WITH",
                value: "/",
              },
            },
          },
          orderBys: [
            {
              metric: { metricName: "screenPageViews" },
              desc: true,
            },
          ],
          limit: 10000,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("[GA4] API error:", response.status, error);
      throw new Error(`GA4 API error: ${response.status}`);
    }

    const data = (await response.json()) as GA4Response;
    
    const results = (data.rows || []).map((row) => ({
      page: row.dimensionValues[0].value,
      hit: parseInt(row.metricValues[0].value, 10) || 0,
    }));

    console.log(`[GA4] Fetched ${results.length} pages`);
    return results;
  } catch (error) {
    console.error("[GA4] Failed to fetch:", error);
    return [];
  }
}

/**
 * 验证 GA4 配置是否完整
 */
export function isGA4Configured(): boolean {
  const config = getGA4Config();
  return !!(
    config.propertyId &&
    config.propertyId !== "123456789" &&
    config.clientEmail &&
    config.privateKey
  );
}
