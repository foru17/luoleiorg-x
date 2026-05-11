/**
 * Cloudflare Worker entry point
 */
import handler from "vinext/server/app-router-entry";
import {
  asMarkdownResponse,
  prefersMarkdown,
  resolveMarkdownTarget,
  serveWellKnown,
  withAgentLinkHeaders,
} from "./agent-adapter";

interface Env {
  ASSETS: {
    fetch(input: Request | URL | string, init?: RequestInit): Promise<Response>;
  };
  IMAGES: {
    input(stream: ReadableStream<Uint8Array>): {
      transform(options: { width?: number; height?: number; fit?: string }): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
  CACHE_KV: KVNamespace;
  // 可选：Umami API Token（如果需要认证访问统计数据）
  UMAMI_API_TOKEN?: string;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Inject Cloudflare secrets into process.env and globalThis so server-side code can access them.
    // In Workers, secrets are only available via the env parameter, not process.env.
    if (env.UMAMI_API_TOKEN) {
      process.env.UMAMI_API_TOKEN = env.UMAMI_API_TOKEN;
      // 同时设置到 globalThis，确保 Server Component 可以访问
      (globalThis as unknown as { UMAMI_API_TOKEN: string }).UMAMI_API_TOKEN = env.UMAMI_API_TOKEN;
    }

    if (env.CACHE_KV) {
      (globalThis as unknown as { CACHE_KV: KVNamespace }).CACHE_KV = env.CACHE_KV;
    }

    const url = new URL(request.url);

    // ── Agent 发现协议：/.well-known/* 静态短路返回 ──────────────────────────
    const wellKnown = serveWellKnown(url.pathname);
    if (wellKnown) return wellKnown;

    // ── Agent 内容协商：显式 Accept: text/markdown 时改写到 markdown 端点 ──
    if (request.method === "GET" && prefersMarkdown(request)) {
      const target = resolveMarkdownTarget(url.pathname);
      if (target) {
        const rewritten = new URL(target, request.url);
        const upstream = await handler.fetch(new Request(rewritten, request));
        return asMarkdownResponse(upstream);
      }
    }

    // /{slug}.md  →  /api/raw/{slug}
    // 让 AI 检索 / 引用工具能直接拿到原始 markdown（与 src/middleware.ts 保持一致，
    // 这里是 Cloudflare 边缘的冗余兜底）
    const mdMatch = url.pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9._-]*)\.md$/);
    if (mdMatch && !["/llms.md", "/llms-full.md"].includes(url.pathname)) {
      const slug = mdMatch[1];
      const rewritten = new URL(`/api/raw/${slug}`, request.url);
      return handler.fetch(new Request(rewritten, request));
    }

    // Image optimization via Cloudflare Images binding
    if (url.pathname === "/_vinext/image") {
      const imageUrl = url.searchParams.get("url");
      if (!imageUrl) {
        return new Response("Missing url parameter", { status: 400 });
      }

      // Fetch the source image from assets
      const source = await env.ASSETS.fetch(new Request(new URL(imageUrl, request.url)));
      if (!source.ok || !source.body) {
        return new Response("Image not found", { status: 404 });
      }

      // For now, just serve the original image without transformation
      const headers = new Headers(source.headers);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      headers.set("Vary", "Accept");
      return new Response(source.body, { status: 200, headers });
    }

    // Delegate everything else to vinext, then inject agent-discovery Link headers
    // (no-op on non-HTML responses, see agent-adapter.ts)
    const response = await handler.fetch(request);
    return withAgentLinkHeaders(response);
  },
};

export default worker;
