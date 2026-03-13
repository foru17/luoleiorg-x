import { getAISummary, getAISeo } from "@/lib/content/ai-data";
import { getAllPosts } from "@/lib/content/posts";
import { getPreviewImage } from "@/lib/content/utils";
import {
  type ArticleShareCardTheme,
  buildArticleShareCardSvg,
  prepareArticleShareCardData,
} from "@/lib/share/article-share-card";
import { siteConfig } from "@/lib/site-config";

export const revalidate = 3600;

function toAbsoluteUrl(url: string, baseUrl?: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  const normalizedPath = url.startsWith("/") ? url : `/${url}`;
  return `${baseUrl ?? siteConfig.siteUrl}${normalizedPath}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

async function fetchAsDataUrl(url?: string): Promise<string | undefined> {
  if (!url) return undefined;

  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;

    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";
    const buffer = await response.arrayBuffer();
    return `data:${contentType};base64,${arrayBufferToBase64(buffer)}`;
  } catch {
    return undefined;
  }
}

interface RouteContext {
  params: Promise<{ slug: string }>;
}

function resolveShareCardTheme(value: string | null): ArticleShareCardTheme {
  return value === "dark" ? "dark" : "light";
}

export async function GET(request: Request, { params }: RouteContext) {
  const { slug } = await params;
  const post = getAllPosts().find((item) => item.slug === slug);

  if (!post) {
    return new Response("Article not found", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const aiSummary = getAISummary(slug);
  const aiSeo = getAISeo(slug);
  const requestUrl = new URL(request.url);
  const shareTheme = resolveShareCardTheme(requestUrl.searchParams.get("theme"));
  const assetBaseUrl = requestUrl.origin;
  const articleUrl = `${siteConfig.siteUrl}/${post.slug}`;
  const coverUrl = post.cover
    ? toAbsoluteUrl(getPreviewImage(post.cover))
    : undefined;
  const shareSummary = aiSummary?.summary ?? aiSeo?.ogDescription ?? post.excerpt;
  const content = prepareArticleShareCardData({
    title: post.title,
    summary: shareSummary,
    articleUrl,
    publishedAt: post.date,
  });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=0&format=png&data=${encodeURIComponent(articleUrl)}`;

  const [logoSrc, avatarSrc, coverSrc, qrSrc] = await Promise.all([
    fetchAsDataUrl(toAbsoluteUrl("/legacy/logo.png", assetBaseUrl)),
    fetchAsDataUrl(toAbsoluteUrl("/images/avatar.jpg", assetBaseUrl)),
    fetchAsDataUrl(coverUrl),
    fetchAsDataUrl(qrUrl),
  ]);

  const svg = buildArticleShareCardSvg(content, {
    logoSrc,
    avatarSrc,
    coverSrc,
    qrSrc,
  }, shareTheme);

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
