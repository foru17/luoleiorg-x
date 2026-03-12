#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");
const FACT_REGISTRY_PATH = path.join(DATA_DIR, "fact-registry.json");
const SOURCE_DOCS_PATH = path.join(DATA_DIR, "source-docs/posts.jsonl");
const OUTPUT_PATH = path.join(DATA_DIR, "fact-registry-audit-report.json");

const READING_SIGNAL_RE = /读|书|阅读|书单|read|kindle|paperwhite/i;

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

function compact(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function getChineseTokens(value) {
  return Array.from(String(value ?? "").matchAll(/[\p{Script=Han}]{2,}/gu)).map((match) => match[0]);
}

function getRaceTokens(value) {
  const normalized = String(value ?? "")
    .replace(/\d{4,}/g, " ")
    .replace(/国际长跑节|马拉松|半马|全马/gu, " ")
    .trim();
  return getChineseTokens(normalized);
}

function hasReadingSignal(text) {
  return READING_SIGNAL_RE.test(String(text ?? ""));
}

function buildSourceIndex() {
  const index = new Map();
  for (const record of readJsonl(SOURCE_DOCS_PATH)) {
    index.set(record.source_id, record);
  }
  return index;
}

function flagReadingFact(fact, sourceTitles) {
  const reasons = [];
  const valueHasSignal = hasReadingSignal(fact.value);
  const sourceHasSignal = sourceTitles.some((title) => hasReadingSignal(title));
  const bookCount = Number(fact.attributes?.book_count ?? 0);

  if (!valueHasSignal && !sourceHasSignal) {
    reasons.push("weak_reading_signal");
  }

  if ((!valueHasSignal || !sourceHasSignal) && bookCount > 0 && bookCount <= 2) {
    reasons.push("incidental_book_mention");
  }

  return reasons;
}

function flagTravelFact(fact) {
  const reasons = [];
  const tripCount = Number(fact.attributes?.trip_count_min ?? 0);
  const sourceCount = Array.isArray(fact.source_ids) ? fact.source_ids.length : 0;

  if (tripCount > 1 && sourceCount > 0 && tripCount > sourceCount) {
    reasons.push("trip_count_exceeds_source_count");
  }

  return reasons;
}

function flagRaceFact(fact, sourceTitles) {
  const reasons = [];
  const raceTokens = getRaceTokens(fact.value);
  const normalizedTitles = sourceTitles.map((title) => compact(title));
  const matchedToken = raceTokens.some((token) => {
    const normalizedToken = compact(token);
    return normalizedTitles.some((title) => title.includes(normalizedToken));
  });

  if (sourceTitles.length > 0 && raceTokens.length > 0 && !matchedToken) {
    reasons.push("indirect_race_source");
  }

  return reasons;
}

function main() {
  if (!fs.existsSync(FACT_REGISTRY_PATH)) {
    console.error("fact-registry.json not found");
    process.exit(1);
  }

  const registry = readJson(FACT_REGISTRY_PATH);
  const sourceIndex = buildSourceIndex();
  const facts = Array.isArray(registry.facts) ? registry.facts : [];
  const flaggedFacts = [];

  for (const fact of facts) {
    if (fact.review_status === "verified") {
      continue;
    }

    const sourceIds = Array.isArray(fact.source_ids) ? fact.source_ids : [];
    const sourceTitles = sourceIds
      .map((sourceId) => sourceIndex.get(sourceId)?.title)
      .filter((title) => typeof title === "string" && title.length > 0);

    const reasons = [];
    if (fact.category === "reading") {
      reasons.push(...flagReadingFact(fact, sourceTitles));
    }
    if (fact.category === "travel") {
      reasons.push(...flagTravelFact(fact));
    }
    if (fact.category === "race") {
      reasons.push(...flagRaceFact(fact, sourceTitles));
    }

    if (reasons.length === 0) continue;

    flaggedFacts.push({
      fact_id: fact.fact_id,
      category: fact.category,
      value: fact.value,
      confidence: fact.confidence ?? "missing",
      review_status: fact.review_status ?? "pending",
      reason_codes: Array.from(new Set(reasons)),
      source_ids: sourceIds,
      source_titles: sourceTitles,
      attributes: fact.attributes ?? {},
    });
  }

  const reasonCounts = flaggedFacts.reduce((acc, fact) => {
    for (const reason of fact.reason_codes) {
      acc[reason] = (acc[reason] ?? 0) + 1;
    }
    return acc;
  }, {});

  const report = {
    generatedAt: new Date().toISOString(),
    registrySummary: {
      totalFacts: facts.length,
      confidenceValues: Array.from(
        new Set(facts.map((fact) => fact.confidence ?? "missing")),
      ).sort(),
      reviewStatusValues: Array.from(
        new Set(facts.map((fact) => fact.review_status ?? "pending")),
      ).sort(),
    },
    schemaWarnings: [
      "Audit report only lists non-verified facts. Verified facts are assumed to be already reviewed.",
    ],
    flaggedCount: flaggedFacts.length,
    flaggedByCategory: flaggedFacts.reduce((acc, fact) => {
      acc[fact.category] = (acc[fact.category] ?? 0) + 1;
      return acc;
    }, {}),
    flaggedByReason: reasonCounts,
    flaggedFacts,
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  console.log(`Saved audit report to ${OUTPUT_PATH}`);
  console.log(
    JSON.stringify(
      {
        totalFacts: report.registrySummary.totalFacts,
        flaggedCount: report.flaggedCount,
        flaggedByCategory: report.flaggedByCategory,
        flaggedByReason: report.flaggedByReason,
      },
      null,
      2,
    ),
  );
}

main();
