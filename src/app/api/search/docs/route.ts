import fs from "node:fs";
import path from "node:path";
import {
  createSearchIndex,
  searchDocuments,
  type SearchDocument,
  type SearchIndexedDocument,
} from "@luoleiorg/search-core";
import { getSearchDocuments } from "@/lib/content/posts";

export const dynamic = "force-dynamic";

const SEARCH_INDEX_PATH = path.join(process.cwd(), "public/search-index.json");
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

let cachedDocs: SearchDocument[] | null = null;
let cachedIndex: SearchIndexedDocument[] | null = null;
let cachedMtime = -1;

function toSafeLimit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value)));
}

function loadSearchData() {
  try {
    const stat = fs.statSync(SEARCH_INDEX_PATH);
    if (cachedDocs && cachedIndex && cachedMtime === stat.mtimeMs) {
      return { docs: cachedDocs, index: cachedIndex };
    }

    const raw = fs.readFileSync(SEARCH_INDEX_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { results?: SearchDocument[] };
    const docs = Array.isArray(parsed.results) ? parsed.results : [];
    const index = createSearchIndex(docs);

    cachedMtime = stat.mtimeMs;
    cachedDocs = docs;
    cachedIndex = index;

    return { docs, index };
  } catch {
    const docs = getSearchDocuments();
    const index = createSearchIndex(docs);
    return { docs, index };
  }
}

function toPayload(item: SearchDocument) {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    excerpt: item.excerpt,
    content: item.content.slice(0, 320),
    categories: item.categories,
    dateTime: item.dateTime,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") ?? "";
  const limit = toSafeLimit(Number(searchParams.get("limit") ?? DEFAULT_LIMIT));

  const { docs, index } = loadSearchData();

  if (!query.trim()) {
    const latest = docs
      .slice()
      .sort((a, b) => b.dateTime - a.dateTime)
      .slice(0, limit)
      .map((item) => ({ ...toPayload(item), score: 0 }));

    return Response.json({
      query,
      total: latest.length,
      results: latest,
    });
  }

  const results = searchDocuments(index, query, limit).map((item) => ({
    ...toPayload(item),
    score: item.score,
  }));

  return Response.json({
    query,
    total: results.length,
    results,
  });
}
