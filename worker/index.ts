/**
 * Cloudflare Worker entry point
 */
import handler from "vinext/server/app-router-entry";

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
  // GA4 secrets (set via `wrangler secret put`)
  GA4_CLIENT_EMAIL?: string;
  GA4_PRIVATE_KEY?: string;
  GA4_PROPERTY_ID?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Inject Cloudflare secrets into process.env so server-side code can access them.
    // In Workers, secrets are only available via the env parameter, not process.env.
    if (env.GA4_CLIENT_EMAIL) process.env.GA4_CLIENT_EMAIL = env.GA4_CLIENT_EMAIL;
    if (env.GA4_PRIVATE_KEY) process.env.GA4_PRIVATE_KEY = env.GA4_PRIVATE_KEY;
    if (env.GA4_PROPERTY_ID) process.env.GA4_PROPERTY_ID = env.GA4_PROPERTY_ID;

    const url = new URL(request.url);

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

    // Delegate everything else to vinext
    return handler.fetch(request);
  },
};
