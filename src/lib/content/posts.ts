import { cache } from "react";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import readingTime from "reading-time";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import type { Element, Root } from "hast";
import { visit } from "unist-util-visit";
import type { SearchDocument } from "@luoleiorg/search-core";
import type { PostDetail, PostFrontmatter, PostItem } from "./types";
import {
  formatDate,
  formatShowDate,
  getArticleLazyImage,
  getOriginalImage,
} from "./utils";

const POSTS_DIR = path.join(process.cwd(), "content/posts");

function ensurePostsDir() {
  if (!fs.existsSync(POSTS_DIR)) {
    fs.mkdirSync(POSTS_DIR, { recursive: true });
  }
}

function listMarkdownFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
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

function parseTagAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /(\w+)=("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null = regex.exec(raw);
  while (match) {
    attrs[match[1]] = match[3] ?? match[4] ?? "";
    match = regex.exec(raw);
  }
  return attrs;
}

function renderTweetCard(attrs: Record<string, string>): string {
  const twitterId = attrs.twitterId ?? "";
  const author = attrs.author ?? twitterId;
  const content = attrs.content ?? "";
  const time = attrs.time ?? "";
  const avatar = attrs.avatar ?? "";
  const image = attrs.image ?? "";
  const tweetId = attrs.tweetId ?? "";

  const avatarImg = avatar
    ? `<img class="rounded-full border border-transparent" src="${avatar}" alt="${author}" width="48" height="48" />`
    : "";
  const imageHtml = image
    ? `<img class="pt-2 w-full h-auto rounded-xl border-0" src="${image}" alt="tweet image" />`
    : "";

  return `<div class="tweet-card px-2 mb-12 rounded-xl"><div class="relative m-auto flex h-full w-full max-w-[32rem] flex-col gap-2 overflow-hidden rounded-xl border p-4 backdrop-blur-md shadow-xl dark:border-zinc-600"><div class="flex flex-row justify-between tracking-tight"><div class="flex items-center space-x-2"><a href="https://x.com/${twitterId}" target="_blank" rel="noreferrer">${avatarImg}</a><div><a href="https://x.com/${twitterId}" target="_blank" rel="noreferrer" class="flex items-center font-semibold whitespace-nowrap text-black dark:text-slate-200">${author}</a><div class="text-sm text-gray-500">@${twitterId}</div></div></div><a href="https://x.com/${twitterId}/status/${tweetId}" target="_blank" rel="noreferrer" class="text-current dark:text-slate-200">𝕏</a></div><div class="text-base tracking-wider leading-normal whitespace-pre-wrap break-words">${content}</div>${imageHtml}<p class="py-0 text-sm leading-none my-4 text-gray-500 dark:text-slate-400">${time}</p></div></div>`;
}

function renderGearCard(attrs: Record<string, string>): string {
  const product = attrs.product ?? "";
  const image = attrs.image ?? attrs.cover ?? "";
  const prize = attrs.prize ?? "";
  const originalPrice = attrs.originalPrice ?? "";

  return `<div class="tweet-card"><div class="relative m-auto w-fit"><div class="relative flex flex-row h-48 px-4 overflow-hidden bg-white border rounded-lg shadow-lg border-gray-50 dark:border-zinc-700 dark:bg-zinc-800"><div class="relative flex w-48 h-full overflow-hidden rounded-xl"><img class="object-cover w-48 h-full" src="${image}" alt="${product}" /></div><div class="px-5 pb-5 mt-4"><h5 class="text-base tracking-tight text-slate-900 max-w-64 line-clamp-1 dark:text-slate-100">${product}</h5><p class="mt-2 text-xs text-slate-900 dark:text-slate-400">入手价格: ¥${prize}</p><p class="text-xs line-through text-slate-500">原价: ¥${originalPrice}</p></div></div></div></div>`;
}

function transformCustomCards(content: string): string {
  const tweetPattern = /<TweetCard([\s\S]*?)\/>/g;
  const gearPattern = /<GearCard([\s\S]*?)\/>/g;

  const withTweets = content.replace(
    tweetPattern,
    (_match, attrsRaw: string) => {
      const attrs = parseTagAttributes(attrsRaw);
      return renderTweetCard(attrs);
    },
  );

  return withTweets.replace(gearPattern, (_match, attrsRaw: string) => {
    const attrs = parseTagAttributes(attrsRaw);
    return renderGearCard(attrs);
  });
}

function imageTransformPlugin() {
  return function transformer(tree: Root) {
    visit(tree, "element", (node) => {
      const element = node as Element;
      if (element.tagName !== "img") return;
      const src = String(element.properties?.src ?? "");
      if (!src) return;
      element.properties = {
        ...element.properties,
        "data-src": src,
        "data-original-src": src,
        "data-zoom-src": getOriginalImage(src),
        src: getArticleLazyImage(src),
        loading: "lazy",
      };
    });
  };
}

function extractHeadingsFromMarkdown(content: string): PostDetail["headings"] {
  const lines = content.split("\n");
  const headings: PostDetail["headings"] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      const text = trimmed.replace(/^##\s+/, "").trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5\s-]/g, "")
        .replace(/\s+/g, "-");
      headings.push({ id, text, level: 2 });
    }
    if (trimmed.startsWith("### ")) {
      const text = trimmed.replace(/^###\s+/, "").trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5\s-]/g, "")
        .replace(/\s+/g, "-");
      headings.push({ id, text, level: 3 });
    }
  }

  return headings;
}

function parsePostFile(filePath: string): PostItem | null {
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const frontmatter = data as PostFrontmatter;

  if (!frontmatter.title || !frontmatter.date || frontmatter.hide) {
    return null;
  }

  const slug = path.basename(filePath, ".md");
  const stats = readingTime(content);

  return {
    slug,
    url: `/${slug}`,
    title: frontmatter.title,
    date: formatDate(frontmatter.date),
    dateTime: new Date(frontmatter.date).getTime(),
    formatShowDate: formatShowDate(frontmatter.date),
    cover: frontmatter.cover,
    categories: frontmatter.categories ?? [],
    excerpt: frontmatter.description ?? extractExcerpt(content),
    readingTime: `${Math.max(1, Math.round(stats.minutes))} min read`,
  };
}

export const getAllPosts = cache((): PostItem[] => {
  ensurePostsDir();
  const files = listMarkdownFiles(POSTS_DIR);
  return files
    .map((filePath) => parsePostFile(filePath))
    .filter((post): post is PostItem => Boolean(post))
    .sort((a, b) => b.dateTime - a.dateTime);
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
  ensurePostsDir();
  const files = listMarkdownFiles(POSTS_DIR);

  return files
    .map((filePath) => {
      const raw = fs.readFileSync(filePath, "utf-8");
      const { data, content } = matter(raw);
      const frontmatter = data as PostFrontmatter;

      if (!frontmatter.title || !frontmatter.date || frontmatter.hide) {
        return null;
      }

      const slug = path.basename(filePath, ".md");
      const searchableContent = stripMarkdown(content).slice(0, 4000);
      return {
        id: slug,
        title: frontmatter.title,
        url: `/${slug}`,
        excerpt: frontmatter.description ?? extractExcerpt(content),
        content: searchableContent,
        categories: frontmatter.categories ?? [],
        dateTime: new Date(frontmatter.date).getTime(),
      };
    })
    .filter((item): item is SearchDocument => Boolean(item));
});

export async function getPostBySlug(slug: string): Promise<PostDetail | null> {
  const filePath = path.join(POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  const frontmatter = data as PostFrontmatter;
  if (!frontmatter.title || !frontmatter.date || frontmatter.hide) return null;

  const headings = extractHeadingsFromMarkdown(content);
  const transformedContent = transformCustomCards(content);
  const rendered = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: "wrap",
      properties: {
        className: ["article-anchor"],
      },
    })
    .use(imageTransformPlugin)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(transformedContent);

  const stats = readingTime(content);

  return {
    slug,
    url: `/${slug}`,
    title: frontmatter.title,
    date: formatDate(frontmatter.date),
    dateTime: new Date(frontmatter.date).getTime(),
    formatShowDate: formatShowDate(frontmatter.date),
    cover: frontmatter.cover,
    categories: frontmatter.categories ?? [],
    excerpt: frontmatter.description ?? extractExcerpt(content),
    readingTime: `${Math.max(1, Math.round(stats.minutes))} min read`,
    headings,
    html: String(rendered),
  };
}

export function getPostSiblings(slug: string) {
  const posts = getAllPosts();
  const index = posts.findIndex((post) => post.slug === slug);
  return {
    prev: index >= 0 ? posts[index - 1] ?? null : null,
    next: index >= 0 ? posts[index + 1] ?? null : null,
  };
}
