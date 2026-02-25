import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

const postsDir = path.resolve(process.cwd(), "content/posts");
const outputFile = path.resolve(process.cwd(), "public/search-index.json");
const cfImageProxyHost = "https://img.is26.com";

function listMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
      continue;
    }

    if (entry.name.endsWith(".md")) files.push(fullPath);
  }

  return files;
}

function stripMarkdown(content) {
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

function extractExcerpt(content) {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith("!["));

  return lines[0]?.slice(0, 180) ?? "";
}

function getPreviewImage(url) {
  if (!url) return "";
  const source = String(url).trim();
  if (!source) return "";
  if (source.startsWith("data:") || source.startsWith("blob:")) return source;
  if (source.startsWith("/") && !source.startsWith("//")) return source;

  const normalized = source.startsWith("//") ? `https:${source}` : source;
  const stripTransform = normalized.replace(/\/w=[^/?#]+(?:,[^/?#]+)*$/, "");

  if (stripTransform.startsWith(`${cfImageProxyHost}/`)) {
    return `${stripTransform}/w=320`;
  }

  const raw = normalized.startsWith("http")
    ? normalized
    : normalized.replace(/^\/+/, "");
  return `${cfImageProxyHost}/${raw}/w=320`;
}

if (!fs.existsSync(postsDir)) {
  console.error(`Posts directory missing: ${postsDir}`);
  process.exit(1);
}

const docs = listMarkdownFiles(postsDir)
  .map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);

    if (!data?.title || !data?.date || data?.hide) return null;

    const slug = path.basename(filePath, ".md");
    const searchableContent = stripMarkdown(content).slice(0, 4000);
    return {
      id: slug,
      title: data.title,
      url: `/${slug}`,
      cover: getPreviewImage(data.cover),
      excerpt: data.description ?? extractExcerpt(content),
      content: searchableContent,
      categories: Array.isArray(data.categories) ? data.categories : [],
      dateTime: new Date(data.date).getTime(),
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.dateTime - a.dateTime);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(
  outputFile,
  JSON.stringify({ generatedAt: Date.now(), results: docs }),
  "utf-8",
);

console.log(`Generated search index with ${docs.length} documents`);
