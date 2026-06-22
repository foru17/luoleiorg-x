// ─── Types ──────────────────────────────────────────────────

export interface ProfileMeta {
  lastUpdated: string;
  model: string;
  modelName: string;
  provider: string;
  generatedBy: "ai" | "rule-based";
  sources: string[];
}

export interface IdentityCard {
  name: string;
  description: string;
  evidence: string;
  link?: string;
}

export interface StrengthGroup {
  title: string;
  points: string[];
}

export interface StyleItem {
  trait: string;
  description: string;
}

export interface ProofItem {
  title: string;
  url: string;
  reason: string;
  date?: string;
}

export interface ProfileReport {
  hero: {
    title: string;
    summary: string;
    intro?: string;
  };
  tags?: string[];
  identities: IdentityCard[];
  strengths: StrengthGroup[];
  styles: StyleItem[];
  proofs: {
    posts: ProofItem[];
    tweets: ProofItem[];
    projects: ProofItem[];
  };
  disclaimer: string;
}

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  providerSite: string;
  icon: string;
  generatedAt: string;
  generatedBy: "ai" | "rule-based";
}

export interface ModelReport {
  model: ModelEntry;
  meta: ProfileMeta;
  report: ProfileReport;
}

export interface ProfileManifest {
  defaultModel: string;
  models: ModelEntry[];
}

export interface MultiModelProfileData {
  manifest: ProfileManifest;
  reports: ModelReport[];
}

// ─── Helpers ─────────────────────────────────────────────────

function ensureString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function ensureStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function ensureProofList(value: unknown): ProofItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const obj = (item ?? {}) as Record<string, unknown>;
      const title = ensureString(obj.title);
      const url = ensureString(obj.url);
      const reason = ensureString(obj.reason);
      const date = ensureString(obj.date);
      if (!title || !url || !reason) return null;
      return { title, url, reason, ...(date ? { date } : {}) };
    })
    .filter((item): item is ProofItem => item !== null);
}

function sanitizeReport(raw: unknown): ProfileReport | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const reportInput = (input.report ?? input) as Record<string, unknown>;
  const heroInput = (reportInput.hero ?? {}) as Record<string, unknown>;
  const proofsInput = (reportInput.proofs ?? {}) as Record<string, unknown>;

  const title = ensureString(heroInput.title);
  const summary = ensureString(heroInput.summary);
  if (!title || !summary) return null;

  const identities = Array.isArray(reportInput.identities)
    ? reportInput.identities
        .map((item) => {
          const obj = (item ?? {}) as Record<string, unknown>;
          const name = ensureString(obj.name);
          const description = ensureString(obj.description);
          const evidence = ensureString(obj.evidence);
          const link = ensureString(obj.link);
          if (!name || !description || !evidence) return null;
          return { name, description, evidence, ...(link ? { link } : {}) };
        })
        .filter((item): item is IdentityCard => item !== null)
    : [];

  const strengths = Array.isArray(reportInput.strengths)
    ? reportInput.strengths
        .map((item) => {
          const obj = (item ?? {}) as Record<string, unknown>;
          const groupTitle = ensureString(obj.title);
          const points = ensureStringArray(obj.points);
          if (!groupTitle || points.length === 0) return null;
          return { title: groupTitle, points };
        })
        .filter((item): item is StrengthGroup => item !== null)
    : [];

  const styles = Array.isArray(reportInput.styles)
    ? reportInput.styles
        .map((item) => {
          const obj = (item ?? {}) as Record<string, unknown>;
          const trait = ensureString(obj.trait);
          const description = ensureString(obj.description);
          if (!trait || !description) return null;
          return { trait, description };
        })
        .filter((item): item is StyleItem => item !== null)
    : [];

  const tags = ensureStringArray(reportInput.tags);

  return {
    hero: {
      title,
      summary,
      intro: ensureString(heroInput.intro) || undefined,
    },
    ...(tags.length > 0 ? { tags } : {}),
    identities,
    strengths,
    styles,
    proofs: {
      posts: ensureProofList(proofsInput.posts),
      tweets: ensureProofList(proofsInput.tweets),
      projects: ensureProofList(proofsInput.projects),
    },
    disclaimer:
      ensureString(reportInput.disclaimer) ||
      "该页面由 AI 生成，仅供参考，请以原始内容为准。",
  };
}

function sanitizeMeta(raw: unknown): ProfileMeta | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const lastUpdated = ensureString(input.lastUpdated);
  const model = ensureString(input.model);
  if (!lastUpdated || !model) return null;

  return {
    lastUpdated,
    model,
    modelName: ensureString(input.modelName) || model,
    provider: ensureString(input.provider) || "Unknown",
    generatedBy:
      ensureString(input.generatedBy) === "ai" ? "ai" : "rule-based",
    sources: ensureStringArray(input.sources),
  };
}

// ─── Data Loading via import.meta.glob ───────────────────────

// 使用 Vite 的 import.meta.glob 在构建时加载 data/reports/ 下的所有 JSON
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Vite-specific API
const reportModules = import.meta.glob("/data/reports/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

function loadManifest(): ProfileManifest {
  const raw = reportModules["/data/reports/manifest.json"] as
    | Record<string, unknown>
    | undefined;

  if (!raw) {
    return { defaultModel: "", models: [] };
  }

  return {
    defaultModel: ensureString(raw.defaultModel),
    models: Array.isArray(raw.models)
      ? raw.models
          .map((m) => {
            const obj = (m ?? {}) as Record<string, unknown>;
            return {
              id: ensureString(obj.id),
              name: ensureString(obj.name),
              provider: ensureString(obj.provider),
              providerSite: ensureString(obj.providerSite),
              icon: ensureString(obj.icon),
              generatedAt: ensureString(obj.generatedAt),
              generatedBy:
                ensureString(obj.generatedBy) === "ai"
                  ? ("ai" as const)
                  : ("rule-based" as const),
            };
          })
          .filter((m) => m.id && m.name)
      : [],
  };
}

function loadReport(
  modelId: string,
): { meta: ProfileMeta; report: ProfileReport } | null {
  const raw = reportModules[`/data/reports/${modelId}.json`] as
    | Record<string, unknown>
    | undefined;

  if (!raw) return null;

  const meta = sanitizeMeta(raw.meta);
  const report = sanitizeReport(raw);
  if (!meta || !report) return null;
  return { meta, report };
}

// ─── Public API ──────────────────────────────────────────────

let _cache: MultiModelProfileData | null = null;

export function getMultiModelProfileData(): MultiModelProfileData {
  if (_cache) return _cache;

  const manifest = loadManifest();
  const reports: ModelReport[] = [];

  for (const model of manifest.models) {
    const data = loadReport(model.id);
    if (data) {
      reports.push({ model, meta: data.meta, report: data.report });
    }
  }

  // 如果没有任何报告，创建一个最小 fallback
  if (reports.length === 0) {
    const fallbackModel: ModelEntry = {
      id: "fallback",
      name: "Default",
      provider: "Local",
      providerSite: "",
      icon: "default",
      generatedAt: new Date(0).toISOString(),
      generatedBy: "rule-based",
    };
    reports.push({
      model: fallbackModel,
      meta: {
        lastUpdated: new Date(0).toISOString(),
        model: "fallback",
        modelName: "Default",
        provider: "Local",
        generatedBy: "rule-based",
        sources: [],
      },
      report: {
        hero: {
          title: "AI 视角下的罗磊",
          summary:
            "一个把技术折腾、工具优化和生活方式都写进博客的前端开发者。",
        },
        identities: [],
        strengths: [],
        styles: [],
        proofs: { posts: [], tweets: [], projects: [] },
        disclaimer: "报告数据暂未生成，请运行 pnpm profile:all 生成报告。",
      },
    });
    manifest.defaultModel = "fallback";
    manifest.models = [fallbackModel];
  }

  // 自愈默认模型：若配置的默认报告是规则模板兜底（某个模型 API 临时不可用），
  // 但存在真正由 AI 生成的报告，则把默认切到第一个 AI 报告，避免首屏展示"AI 味"模板。
  const defaultReport = reports.find((r) => r.model.id === manifest.defaultModel);
  if (!defaultReport || defaultReport.meta.generatedBy !== "ai") {
    const firstAiReport = reports.find((r) => r.meta.generatedBy === "ai");
    if (firstAiReport) {
      manifest.defaultModel = firstAiReport.model.id;
    }
  }

  _cache = { manifest, reports };
  return _cache;
}
