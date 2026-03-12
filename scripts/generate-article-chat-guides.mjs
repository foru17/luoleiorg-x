import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import crypto from "node:crypto";
import { buildArticleChatGuideContent } from "../src/lib/content/article-chat-guide-utils.js";

const postsDir = path.resolve(process.cwd(), "content/posts");
const aiSummariesFile = path.resolve(process.cwd(), "data/ai-summaries.json");
const aiChatGuidesFile = path.resolve(process.cwd(), "data/ai-article-chat-guides.json");
const outputFile = path.resolve(process.cwd(), "data/article-chat-guides.json");

function listMarkdownFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

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

function buildSimilarityTerms(article) {
  return new Set(
    [...new Set([
      ...(article.categories || []),
      ...((article.tags || []).slice(0, 5)),
      ...((article.keyPoints || []).slice(0, 4)),
    ].map((value) => String(value || "").trim()).filter(Boolean))],
  );
}

function computeRelatedSlugs(current, articles) {
  const currentTerms = buildSimilarityTerms(current);
  return articles
    .filter((candidate) => candidate.slug !== current.slug)
    .map((candidate) => {
      const candidateTerms = buildSimilarityTerms(candidate);
      let score = 0;

      for (const category of current.categories || []) {
        if ((candidate.categories || []).includes(category)) score += 3;
      }
      for (const term of currentTerms) {
        if (candidateTerms.has(term)) score += 2;
      }

      return { slug: candidate.slug, score, dateTime: candidate.dateTime };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.dateTime - a.dateTime)
    .slice(0, 4)
    .map((item) => item.slug);
}

if (!fs.existsSync(postsDir)) {
  console.error(`Posts directory missing: ${postsDir}`);
  process.exit(1);
}

let aiSummaries = {};
if (fs.existsSync(aiSummariesFile)) {
  try {
    aiSummaries = JSON.parse(fs.readFileSync(aiSummariesFile, "utf-8")).articles || {};
  } catch {
    aiSummaries = {};
  }
}

let aiChatGuides = {};
if (fs.existsSync(aiChatGuidesFile)) {
  try {
    aiChatGuides = JSON.parse(fs.readFileSync(aiChatGuidesFile, "utf-8")).articles || {};
  } catch {
    aiChatGuides = {};
  }
}

const articles = listMarkdownFiles(postsDir)
  .map((filePath) => {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, content } = matter(raw);
    if (!data?.title || !data?.date || data?.hide) return null;
    const normalizedContent = content.trim();

    const slug = filePath
      .replace(`${postsDir}${path.sep}`, "")
      .replace(/\.md$/, "")
      .replace(/[\\/]/g, "-");
    const summaryEntry = aiSummaries[slug]?.data || {};
    const categories = Array.isArray(data.categories) ? data.categories : [];
    const contentHash = crypto.createHash("md5").update(normalizedContent).digest("hex").slice(0, 8);

    return {
      slug,
      title: data.title,
      categories,
      summary: summaryEntry.summary || stripMarkdown(normalizedContent).slice(0, 120),
      abstract:
        summaryEntry.abstract || summaryEntry.summary || stripMarkdown(normalizedContent).slice(0, 260),
      keyPoints: Array.isArray(summaryEntry.keyPoints) ? summaryEntry.keyPoints.slice(0, 4) : [],
      tags: Array.isArray(summaryEntry.tags) ? summaryEntry.tags.slice(0, 5) : [],
      contentHash,
      dateTime: new Date(data.date).getTime(),
      processedAt: new Date().toISOString(),
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.dateTime - a.dateTime);

const guideEntries = {};
let aiGeneratedCount = 0;
let fallbackCount = 0;
for (const article of articles) {
  const aiGuideEntry = aiChatGuides[article.slug];
  const aiGuideData =
    aiGuideEntry?.contentHash === article.contentHash ? aiGuideEntry.data : undefined;
  const guideContent = buildArticleChatGuideContent(
    {
      title: article.title,
      categories: article.categories,
      keyPoints: article.keyPoints,
      summary: article.summary,
      abstract: article.abstract,
    },
    aiGuideData,
  );

  if (aiGuideData) {
    aiGeneratedCount++;
  } else {
    fallbackCount++;
  }

  guideEntries[article.slug] = {
    slug: article.slug,
    title: article.title,
    categories: article.categories,
    summary: article.summary,
    abstract: article.abstract,
    keyPoints: article.keyPoints,
    focusQuestions: guideContent.focusQuestions,
    extensionTopics: guideContent.extensionTopics,
    relatedSlugs: computeRelatedSlugs(article, articles),
    openingLine: guideContent.openingLine,
    autoOpenEnabled: true,
    autoOpenDelayMs: 7000,
    contentHash: article.contentHash,
    processedAt: aiGuideEntry?.processedAt ?? article.processedAt,
  };
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(
  outputFile,
  JSON.stringify(
    {
      meta: {
        generatedAt: new Date().toISOString(),
        totalArticles: Object.keys(guideEntries).length,
        version: 3,
      },
      articles: guideEntries,
    },
    null,
    2,
  ),
  "utf-8",
);

console.log(
  `Generated article chat guides for ${Object.keys(guideEntries).length} articles (ai=${aiGeneratedCount}, fallback=${fallbackCount})`,
);
