import { cache } from "react";
import matter from "gray-matter";
import readingTime from "reading-time";
import type { SearchDocument } from "@luoleiorg/search-core";
import type { PostDetail, PostFrontmatter, PostItem } from "./types";
import { getAISummary } from "./ai-data";
import { renderPostHtml } from "./post-markdown";
import {
  formatDate,
  formatShowDate,
  getPreviewImage,
} from "./utils";

// Use Vite's import.meta.glob to load markdown files at build time
const markdownFiles = import.meta.glob("/content/posts/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

interface PostSource {
  slug: string;
  title: string;
  date: string;
  dateTime: number;
  formatShowDate: string;
  cover?: string;
  categories: string[];
  excerpt: string;
  readingTime: string;
  rawContent: string;
}

function extractExcerpt(content: string): string {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith("!["));

  return lines[0]?.slice(0, 180) ?? "";
}

function stripMarkdown(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filePathToSlug(filePath: string): string {
  return filePath
    .replace("/content/posts/", "")
    .replace(/\.md$/, "")
    .replace(/\//g, "-");
}

function parsePostSource(filePath: string, raw: string): PostSource | null {
  const { data, content } = matter(raw);
  const frontmatter = data as PostFrontmatter;

  if (!frontmatter.title || !frontmatter.date || frontmatter.hide) {
    return null;
  }

  // Extract slug from file path
  const slug = filePathToSlug(filePath);
  const stats = readingTime(content);

  return {
    slug,
    title: frontmatter.title,
    date: formatDate(frontmatter.date),
    dateTime: new Date(frontmatter.date).getTime(),
    formatShowDate: formatShowDate(frontmatter.date),
    cover: frontmatter.cover,
    categories: frontmatter.categories ?? [],
    excerpt: frontmatter.description ?? extractExcerpt(content),
    readingTime: `${Math.max(1, Math.round(stats.minutes))} 分钟`,
    rawContent: content,
  };
}

function toPostItem(source: PostSource): PostItem {
  return {
    slug: source.slug,
    url: `/${source.slug}`,
    title: source.title,
    date: source.date,
    dateTime: source.dateTime,
    formatShowDate: source.formatShowDate,
    cover: source.cover,
    categories: source.categories,
    excerpt: source.excerpt,
    readingTime: source.readingTime,
  };
}

const postCatalog = (() => {
  const sources: PostSource[] = [];
  const sourceMap = new Map<string, PostSource>();

  for (const [filePath, content] of Object.entries(markdownFiles)) {
    const source = parsePostSource(filePath, content as string);
    if (source) {
      sources.push(source);
      sourceMap.set(source.slug, source);
    }
  }

  sources.sort((a, b) => b.dateTime - a.dateTime);

  return {
    sources,
    sourceMap,
  };
})();

export const getAllPosts = cache((): PostItem[] => {
  return postCatalog.sources.map((source) => toPostItem(source));
});

export const getCategoryMeta = cache(() => {
  const map = new Map<string, number>();
  for (const post of getAllPosts()) {
    for (const category of post.categories) {
      map.set(category, (map.get(category) ?? 0) + 1);
    }
  }
  return map;
});

export const getSearchDocuments = cache((): SearchDocument[] => {
  const docs: SearchDocument[] = [];

  for (const source of postCatalog.sources) {
    const searchableContent = stripMarkdown(source.rawContent).slice(0, 4000);
    const aiSummary = getAISummary(source.slug);
    docs.push({
      id: source.slug,
      title: source.title,
      url: `/${source.slug}`,
      cover: source.cover ? getPreviewImage(source.cover) : undefined,
      excerpt: source.excerpt,
      content: searchableContent,
      categories: source.categories,
      dateTime: source.dateTime,
      keyPoints: aiSummary?.keyPoints,
    });
  }

  return docs;
});

const postItemMap = cache(() => {
  return new Map(getAllPosts().map((post) => [post.slug, post]));
});

const postDetailCache = new Map<string, Promise<PostDetail | null>>();

export function getPostSummaryBySlug(slug: string): PostItem | null {
  return postItemMap().get(slug) ?? null;
}

export async function getPostBySlug(slug: string): Promise<PostDetail | null> {
  const cached = postDetailCache.get(slug);
  if (cached) {
    return cached;
  }

  const source = postCatalog.sourceMap.get(slug);
  if (!source) {
    return null;
  }

  const promise = renderPostHtml(source.rawContent)
    .then(({ html, headings }) => ({
      ...toPostItem(source),
      headings,
      html,
    }))
    .catch((error) => {
      postDetailCache.delete(slug);
      throw error;
    });

  postDetailCache.set(slug, promise);

  return promise;
}

/**
 * Get raw markdown content for a post by slug (used by RSS feed)
 */
export function getPostRawContent(slug: string): string | null {
  return postCatalog.sourceMap.get(slug)?.rawContent ?? null;
}

export function getPostSiblings(slug: string) {
  const posts = getAllPosts();
  const index = posts.findIndex((post) => post.slug === slug);
  return {
    prev: index >= 0 ? (posts[index - 1] ?? null) : null,
    next: index >= 0 ? (posts[index + 1] ?? null) : null,
  };
}
