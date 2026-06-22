/**
 * Umami 配置管理
 * 支持本地开发和生产环境
 */

// 默认配置（用于本地开发）
const DEFAULT_CONFIG = {
  apiUrl: "https://u.is26.com/api",
  websiteId: "185ef031-29b2-49e3-bc50-1c9f80b4e831",
  scriptUrl: "https://u.is26.com/script.js",
  // 注意：API Token 应该从环境变量读取
  // 本地开发时可以在 .env 中设置，生产环境通过 wrangler secret 设置
};

export interface UmamiConfig {
  apiUrl: string;
  websiteId: string;
  apiToken: string;
  scriptUrl: string;
}

/**
 * 获取 Umami 配置
 * 优先从环境变量读取，否则使用默认值
 * 
 * 注意：在 Cloudflare Workers 中，vars 可能无法通过 process.env 访问
 * 所以直接使用默认值确保可靠性
 */
export function getUmamiConfig(): UmamiConfig {
  // 尝试从 globalThis 获取 token（Cloudflare Workers secret 方式）
  const globalToken = (globalThis as unknown as { UMAMI_API_TOKEN?: string }).UMAMI_API_TOKEN;
  
  // 从环境变量读取（本地开发用 .env，生产环境用 wrangler vars）
  const envToken = typeof process !== "undefined" ? process.env.UMAMI_API_TOKEN : undefined;
  
  return {
    apiUrl: DEFAULT_CONFIG.apiUrl,
    websiteId: DEFAULT_CONFIG.websiteId,
    apiToken: globalToken || envToken || "",
    scriptUrl: DEFAULT_CONFIG.scriptUrl,
  };
}

/**
 * 站点配置中使用的 Umami 设置
 */
export const siteUmamiConfig = {
  websiteId: DEFAULT_CONFIG.websiteId,
  scriptUrl: DEFAULT_CONFIG.scriptUrl,
};
