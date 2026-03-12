#!/usr/bin/env node
/**
 * build-fact-registry.mjs
 *
 * 从 source-docs + structured-facts-aggregated.json 构建可验证的事实注册表。
 * 每条 fact 都带 source_ids 和 confidence，只有经过验证的条目才能进入高优先级。
 *
 * 输入：
 *   - data/structured-facts-aggregated.json（自动提取的原始事实）
 *   - data/source-docs/posts.jsonl（canonical source docs）
 *
 * 输出：
 *   - data/fact-registry.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");
const OVERRIDES_PATH = path.join(DATA_DIR, "fact-registry-overrides.json");
const READING_FACT_TITLE_RE = /读|书|阅读|书单|kindle|paperwhite/i;

// ─── Helpers ──────────────────────────────────────────

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function urlToSourceId(url) {
  const slug = url.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
  return `post:${slug}`;
}

function readOverrides() {
  if (!fs.existsSync(OVERRIDES_PATH)) {
    return new Map();
  }

  const data = readJson(OVERRIDES_PATH);
  const overrides = Array.isArray(data?.overrides) ? data.overrides : [];
  return new Map(
    overrides
      .filter((item) => item?.fact_id && typeof item.fact_id === "string")
      .map((item) => [item.fact_id, item]),
  );
}

function cloneAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function deriveConfidence(sourceValidation, reviewStatus) {
  if (reviewStatus === "verified") {
    return "verified";
  }
  if (reviewStatus === "rejected") {
    return "uncertain";
  }
  return sourceValidation === "validated" ? "likely" : "uncertain";
}

function mergeFactOverride(fact, overrides) {
  const override = overrides.get(fact.fact_id);
  const reviewStatus =
    override?.review_status === "verified" || override?.review_status === "rejected"
      ? override.review_status
      : "pending";
  const attributes = {
    ...cloneAttributes(fact.attributes),
    ...cloneAttributes(override?.attributes_patch),
  };

  return {
    ...fact,
    attributes,
    review_status: reviewStatus,
    review_note: typeof override?.note === "string" ? override.note : undefined,
    reviewed_by: typeof override?.reviewed_by === "string" ? override.reviewed_by : undefined,
    reviewed_at: typeof override?.reviewed_at === "string" ? override.reviewed_at : undefined,
    confidence:
      typeof override?.confidence === "string" && override.confidence.length > 0
        ? override.confidence
        : deriveConfidence(fact.source_validation, reviewStatus),
  };
}

// ─── Travel Facts ─────────────────────────────────────

function buildTravelFacts(raw, postIndex) {
  const facts = [];

  for (const country of raw.travel?.countries || []) {
    const sourceIds = (country.evidence || [])
      .map((e) => urlToSourceId(e.url))
      .filter((id) => postIndex.has(id));

    // 只有 evidence 中能匹配到 source doc 的才是 validated
    const sourceValidation = sourceIds.length > 0 ? "validated" : "unvalidated";

    facts.push({
      fact_id: `travel:${country.name}`,
      fact_type: "travel_destination",
      category: "travel",
      value: country.name,
      source_validation: sourceValidation,
      provenance: "derived_from_sources",
      source_ids: sourceIds,
      attributes: {
        kind: "country",
        trip_count_min: country.tripCount || null,
        count_mode: country.countMode || "unknown",
      },
    });
  }

  for (const region of raw.travel?.regions || []) {
    const sourceIds = (region.evidence || [])
      .map((e) => urlToSourceId(e.url))
      .filter((id) => postIndex.has(id));

    facts.push({
      fact_id: `travel:${region.name}`,
      fact_type: "travel_destination",
      category: "travel",
      value: region.name,
      source_validation: sourceIds.length > 0 ? "validated" : "unvalidated",
      provenance: "derived_from_sources",
      source_ids: sourceIds,
      attributes: {
        kind: "region",
        trip_count_min: region.tripCount || null,
        count_mode: region.countMode || "unknown",
      },
    });
  }

  return facts;
}

// ─── Race Facts ───────────────────────────────────────

function buildRaceFacts(raw, postIndex) {
  const facts = [];

  for (const race of raw.races?.completedEvents || []) {
    const sourceId = urlToSourceId(race.url);
    const hasSource = postIndex.has(sourceId);

    facts.push({
      fact_id: `race:${race.name}-${race.date}`.replace(/\s+/g, "-"),
      fact_type: "marathon_event",
      category: "race",
      value: race.name,
      source_validation: hasSource ? "validated" : "unvalidated",
      provenance: "derived_from_sources",
      source_ids: hasSource ? [sourceId] : [],
      attributes: {
        date: race.date || null,
        result: race.result || null,
        location: race.location || null,
      },
    });
  }

  return facts;
}

// ─── Reading Facts ────────────────────────────────────

function buildReadingFacts(raw, postIndex) {
  const facts = [];

  // 阅读总结文章（高置信度，因为来源是真实的读书总结帖）
  for (const post of raw.reading?.roundupPosts || []) {
    const sourceId = urlToSourceId(post.url);
    const hasSource = postIndex.has(sourceId);

    // 只保留标题上就能明确判断为阅读/书单/阅读设备相关的公开内容。
    // 文章里顺手提到某本书，不应自动升级成 reading fact。
    const isReadingPost = READING_FACT_TITLE_RE.test(post.title);
    if (!isReadingPost || !hasSource) continue;

    facts.push({
      fact_id: `reading:${post.date || "unknown"}-${post.title.slice(0, 20)}`.replace(/\s+/g, "-"),
      fact_type: "reading_roundup",
      category: "reading",
      value: post.title,
      source_validation: hasSource ? "validated" : "unvalidated",
      provenance: "derived_from_sources",
      source_ids: hasSource ? [sourceId] : [],
      attributes: {
        date: post.date || null,
        url: post.url,
        book_count: post.bookCount || null,
        books: post.books || [],
      },
    });
  }

  return facts;
}

// ─── Main ─────────────────────────────────────────────

function main() {
  console.log("📋 构建 Fact Registry...\n");

  // 读取输入
  const rawFactsPath = path.join(DATA_DIR, "structured-facts-aggregated.json");
  if (!fs.existsSync(rawFactsPath)) {
    console.error("❌ structured-facts-aggregated.json 不存在");
    process.exit(1);
  }
  const rawFacts = readJson(rawFactsPath);
  const overrides = readOverrides();

  // 构建 post source id 索引用于验证
  const postDocs = readJsonl(path.join(DATA_DIR, "source-docs/posts.jsonl"));
  const postIndex = new Set(postDocs.map((p) => p.source_id));
  console.log(`  📖 已加载 ${postIndex.size} 个 post source ids`);

  // 构建各类 facts
  const travelFacts = buildTravelFacts(rawFacts, postIndex);
  const raceFacts = buildRaceFacts(rawFacts, postIndex);
  const readingFacts = buildReadingFacts(rawFacts, postIndex);

  const allFacts = [...travelFacts, ...raceFacts, ...readingFacts]
    .map((fact) => mergeFactOverride(fact, overrides));
  const verified = allFacts.filter((f) => f.confidence === "verified");
  const likely = allFacts.filter((f) => f.confidence === "likely");
  const uncertain = allFacts.filter((f) => f.confidence === "uncertain");
  const pendingReview = allFacts.filter((f) => f.review_status === "pending");
  const rejected = allFacts.filter((f) => f.review_status === "rejected");

  // 输出
  const registry = {
    $schema: "fact-registry-v1",
    generatedAt: new Date().toISOString(),
    stats: {
      total: allFacts.length,
      verified: verified.length,
      likely: likely.length,
      uncertain: uncertain.length,
      pending_review: pendingReview.length,
      rejected: rejected.length,
      by_category: {
        travel: travelFacts.length,
        race: raceFacts.length,
        reading: readingFacts.length,
      },
    },
    facts: allFacts,
  };

  const outputPath = path.join(DATA_DIR, "fact-registry.json");
  fs.writeFileSync(outputPath, JSON.stringify(registry, null, 2), "utf-8");

  console.log(`\n✅ Fact Registry 构建完成`);
  console.log(`  📊 总计 ${allFacts.length} 条事实`);
  console.log(`  ✅ verified: ${verified.length}`);
  console.log(`  🟡 likely: ${likely.length}`);
  console.log(`  ⚪ uncertain: ${uncertain.length}`);
  console.log(`  📝 pending review: ${pendingReview.length}`);
  console.log(`  🗂️ 分类: 旅行 ${travelFacts.length} / 赛事 ${raceFacts.length} / 阅读 ${readingFacts.length}`);
}

main();
