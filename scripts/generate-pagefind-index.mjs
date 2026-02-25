import fs from "node:fs";
import path from "node:path";
import * as pagefind from "pagefind";

const searchIndexPath = path.resolve(process.cwd(), "public/search-index.json");
const outputPath = path.resolve(process.cwd(), "public/pagefind");
const tempSitePath = path.resolve(process.cwd(), ".cache/pagefind-site");

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeUrl(url) {
  if (!url || url === "/") return "home";
  return url.replace(/^\//, "").replace(/\/$/, "") || "home";
}

if (!fs.existsSync(searchIndexPath)) {
  console.error(`Missing search index file: ${searchIndexPath}`);
  process.exit(1);
}

const raw = fs.readFileSync(searchIndexPath, "utf-8");
const parsed = JSON.parse(raw);
const docs = Array.isArray(parsed.results) ? parsed.results : [];

fs.rmSync(tempSitePath, { recursive: true, force: true });
fs.rmSync(outputPath, { recursive: true, force: true });
fs.mkdirSync(tempSitePath, { recursive: true });

for (const doc of docs) {
  const routeDir = normalizeUrl(doc.url);
  const targetDir = path.join(tempSitePath, routeDir);
  fs.mkdirSync(targetDir, { recursive: true });

  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(doc.title)}</title>
    <meta data-pagefind-meta="cover[content]" content="${escapeHtml(
      doc.cover ?? "",
    )}" property="og:image" />
  </head>
  <body>
    <main data-pagefind-body>
      <h1 data-pagefind-meta="title">${escapeHtml(doc.title)}</h1>
      <p>${escapeHtml(doc.excerpt ?? "")}</p>
      <article>${escapeHtml(doc.content ?? "")}</article>
    </main>
  </body>
</html>`;

  fs.writeFileSync(path.join(targetDir, "index.html"), html, "utf-8");
}

const { index } = await pagefind.createIndex();
await index.addDirectory({ path: tempSitePath });
await index.writeFiles({ outputPath });

fs.rmSync(tempSitePath, { recursive: true, force: true });

console.log(`Generated Pagefind index with ${docs.length} documents`);
