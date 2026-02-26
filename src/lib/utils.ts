import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parsePositivePage(pageParam?: string): number {
  if (!pageParam) return 1;
  const parsed = Number(pageParam);
  if (!Number.isFinite(parsed)) return 1;
  const integer = Math.trunc(parsed);
  return integer > 0 ? integer : 1;
}

export function normalizeCategory(category: string): string {
  return decodeURIComponent(category).trim().toLowerCase();
}

export function extractSlug(page: string): string {
  let path = page;

  if (path.includes("://")) {
    try {
      const url = new URL(path);
      path = url.pathname;
    } catch {
      // If URL parsing fails, treat as path
    }
  }

  // Remove leading slash and extract only the first segment
  // This ensures /slug/amp/ and /slug/ both map to "slug"
  const segments = path.replace(/^\//, "").split("/");
  return segments[0] || "";
}

export function categoryUrl(category: string): string {
  return `/category/${encodeURIComponent(category)}`;
}

export function categoryPageUrl(category: string, page: number): string {
  if (page <= 1) {
    return `/category/${encodeURIComponent(category)}`;
  }
  return `/category/${encodeURIComponent(category)}/page/${page}`;
}
