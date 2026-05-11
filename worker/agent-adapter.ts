/**
 * Agent Adapter —— 在 Cloudflare 边缘为 AI Agent 客户端补齐发现协议层。
 *
 * 涵盖 4 件事，且全部不影响浏览器 / 现有路由的行为：
 *
 *  1. /.well-known/mcp/server-card.json   →  MCP Server Card（Anthropic MCP discovery）
 *  2. /.well-known/agent-skills/index.json →  Agent Skills index（agent 可调用能力清单）
 *  3. Accept: text/markdown 内容协商       →  把 /、/{slug} 改写到现成 markdown 端点
 *  4. HTML 响应注入 Link / Vary 头          →  让 agent 通过响应头直接发现以上资源
 *
 * 设计原则：
 *  - 浏览器请求不会走到 markdown 改写分支（必须显式 Accept: text/markdown 才触发）
 *  - 只追加响应头，不改 body / 不改状态码 / 不改原有 content-type
 *  - .well-known 资源只在精确匹配命中时短路返回，否则透传 vinext
 */

const SITE_URL = "https://luolei.org";

const COMMON_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=3600",
  "X-Robots-Tag": "all",
};

/** 解析 Accept 头：客户端是否显式接受 text/markdown，且优先级不低于 html */
export function prefersMarkdown(request: Request): boolean {
  const accept = request.headers.get("accept");
  if (!accept) return false;

  // 浏览器从不发 text/markdown，所以只要里面写了就视为 agent 客户端
  // 但仍按 q 值做兜底，避免 */* 把所有请求都吞掉
  const entries = accept.split(",").map((part) => {
    const [media, ...params] = part.trim().split(";").map((s) => s.trim());
    const qParam = params.find((p) => p.startsWith("q="));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    return { media: media.toLowerCase(), q: Number.isFinite(q) ? q : 0 };
  });

  const md = entries.find((e) => e.media === "text/markdown");
  if (!md) return false;

  const html = entries.find((e) => e.media === "text/html");
  // 没显式 html 时只看 markdown 是否非零；显式 html 时要求 markdown 不低于 html
  return html ? md.q >= html.q : md.q > 0;
}

/* ─────────────────────────  /.well-known/* 静态资源  ───────────────────────── */

function serveMcpServerCard(): Response {
  // 遵循 modelcontextprotocol.io 的 well-known 资源约定 + Anthropic MCP server card 草案：
  // 描述本站对外暴露的只读能力，让 MCP 客户端（Claude/Cursor/Cline）能直接拿来用。
  const card = {
    schemaVersion: "2025-06-18",
    name: "luolei.org",
    title: "罗磊的独立博客 · MCP Server Card",
    description:
      "Read-only access to the personal blog of 罗磊 (luolei.org): article markdown, AI-generated summaries, full search and author profile.",
    publisher: {
      name: "罗磊",
      url: SITE_URL,
      contact: "i@luolei.org",
    },
    capabilities: {
      resources: [
        {
          uri: `${SITE_URL}/llms.txt`,
          name: "llms-index",
          description: "Site overview, categories, key entry points (text/plain).",
          mimeType: "text/plain",
        },
        {
          uri: `${SITE_URL}/llms-full.txt`,
          name: "llms-full",
          description:
            "Every published article with AI-generated summary, URL and markdown link.",
          mimeType: "text/plain",
        },
        {
          uriTemplate: `${SITE_URL}/{slug}.md`,
          name: "article-markdown",
          description:
            "Full markdown of a single article (also reachable by setting Accept: text/markdown on /{slug}).",
          mimeType: "text/markdown",
        },
        {
          uri: `${SITE_URL}/sitemap.xml`,
          name: "sitemap",
          description: "Canonical URL list for the entire site.",
          mimeType: "application/xml",
        },
      ],
      endpoints: [
        {
          name: "search-articles",
          description: "Full-text + AI-tag search across all blog articles.",
          method: "GET",
          url: `${SITE_URL}/api/search/docs`,
          params: {
            q: "Search keywords (UTF-8)",
            limit: "Max results, 1–50 (default 20)",
            related: "Slug to find semantically related articles for",
          },
        },
        {
          name: "fetch-author-profile",
          description:
            "Structured author profile (bio, social, AI-generated highlights, stats).",
          method: "GET",
          url: `${SITE_URL}/api/profile`,
        },
        {
          name: "fetch-article-markdown",
          description: "Get the markdown source of an article by slug.",
          method: "GET",
          urlTemplate: `${SITE_URL}/api/raw/{slug}`,
        },
      ],
    },
    license: "CC BY-NC-ND 4.0",
    documentation: `${SITE_URL}/llms.txt`,
    botPolicy: `${SITE_URL}/robots.txt`,
  };

  return jsonResponse(card);
}

function serveAgentSkillsIndex(): Response {
  // 参考 isitagentready.com 自身发布的 agent-skills index 结构，列出本站
  // agent 可调用的能力清单。每条 skill 给出 name / description / 调用入口，
  // 不依赖任何 SDK，纯 HTTP/JSON 即可消费。
  const index = {
    schemaVersion: "2025-09-30",
    name: "luolei.org agent skills",
    description:
      "Agent-callable skills exposed by luolei.org. All endpoints are public, read-only and return JSON or markdown.",
    publisher: {
      name: "罗磊",
      url: SITE_URL,
    },
    skills: [
      {
        id: "read-article-markdown",
        name: "Read article markdown",
        description:
          "Fetch the full markdown of a single article (with frontmatter: title, URL, date, categories, license).",
        invocation: {
          method: "GET",
          urlTemplate: `${SITE_URL}/{slug}.md`,
          alternativeUrlTemplate: `${SITE_URL}/api/raw/{slug}`,
          contentType: "text/markdown",
        },
        examples: [`${SITE_URL}/luolei-ai.md`],
      },
      {
        id: "search-blog",
        name: "Search blog articles",
        description:
          "Full-text + AI-tag search across all published articles. Returns titles, URLs, excerpts, key points and AI summaries.",
        invocation: {
          method: "GET",
          url: `${SITE_URL}/api/search/docs`,
          params: { q: "string", limit: "1-50", related: "slug (optional)" },
          contentType: "application/json",
        },
      },
      {
        id: "list-all-articles",
        name: "List all articles with summaries",
        description:
          "Get every published article in reverse-chronological order with AI-generated summary and markdown link.",
        invocation: {
          method: "GET",
          url: `${SITE_URL}/llms-full.txt`,
          contentType: "text/plain",
        },
      },
      {
        id: "fetch-author-profile",
        name: "Fetch author profile",
        description:
          "Structured author profile aggregated from blog history, X timeline and GitHub activity (AI-generated highlights, projects, stats).",
        invocation: {
          method: "GET",
          url: `${SITE_URL}/api/profile`,
          contentType: "application/json",
        },
      },
      {
        id: "fetch-rss-feed",
        name: "Subscribe to RSS feed",
        description: "Full-text RSS feed for the blog.",
        invocation: {
          method: "GET",
          url: `${SITE_URL}/rss.xml`,
          contentType: "application/rss+xml",
        },
      },
    ],
    contentSignals: {
      search: "yes",
      "ai-input": "no",
      "ai-train": "no",
      reference: `${SITE_URL}/robots.txt`,
    },
  };

  return jsonResponse(index);
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...COMMON_HEADERS,
    },
  });
}

/**
 * 路由表：精确匹配返回静态 JSON；其它路径返回 null，由 worker 继续走 vinext。
 */
export function serveWellKnown(pathname: string): Response | null {
  switch (pathname) {
    case "/.well-known/mcp/server-card.json":
      return serveMcpServerCard();
    case "/.well-known/agent-skills/index.json":
      return serveAgentSkillsIndex();
    default:
      return null;
  }
}

/* ─────────────────────────  Accept: text/markdown 内容协商  ───────────────────────── */

/**
 * 把 path 映射到对应的 markdown 端点。返回 null 表示该 path 没有 markdown 视图，
 * 应继续返回 HTML（不破坏现有行为）。
 *
 *   "/"            →  "/llms.txt"           （需要把 Content-Type 重写为 text/markdown）
 *   "/{slug}"      →  "/api/raw/{slug}"     （/api/raw 路由原生返回 text/markdown）
 *
 * 已经是 .md / api / .well-known / 静态资源的路径都不动。
 */
export function resolveMarkdownTarget(pathname: string): string | null {
  if (pathname === "/") return "/llms.txt";

  // 已带 .md 后缀 → 透传给 worker 现有的 .md 重写逻辑
  if (pathname.endsWith(".md")) return null;
  // API、静态资源、内部路由：永远不做 markdown 协商
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/_") ||
    pathname.startsWith("/static/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/icons/")
  ) {
    return null;
  }

  // 单段 slug（无斜杠、无点号）：当作文章 → /api/raw/{slug}
  const slugMatch = pathname.match(/^\/([A-Za-z0-9][A-Za-z0-9._-]{0,200})\/?$/);
  if (slugMatch && !slugMatch[1].includes(".")) {
    return `/api/raw/${slugMatch[1]}`;
  }

  // 列表页 / 分类页 / about 等：暂不提供 markdown 视图
  return null;
}

/**
 * 包装一个返回 markdown 内容的 Response：
 * - 把任何 text/plain → text/markdown
 * - 加 Vary: Accept，避免 CDN 拿 HTML 缓存命中 markdown 请求
 * - 保留原响应的其它头与 body
 */
export async function asMarkdownResponse(upstream: Response): Promise<Response> {
  const headers = new Headers(upstream.headers);
  const contentType = headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("text/markdown")) {
    headers.set("Content-Type", "text/markdown; charset=utf-8");
  }
  const vary = headers.get("vary");
  headers.set("Vary", vary ? mergeVary(vary, "Accept") : "Accept");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

function mergeVary(existing: string, addition: string): string {
  const parts = existing
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === addition.toLowerCase())) {
    return existing;
  }
  parts.push(addition);
  return parts.join(", ");
}

/* ─────────────────────────  HTML 响应注入 Link / Vary 头  ───────────────────────── */

const AGENT_LINK_HEADER = [
  `<${SITE_URL}/sitemap.xml>; rel="sitemap"; type="application/xml"`,
  `<${SITE_URL}/llms.txt>; rel="alternate"; type="text/markdown"; title="llms.txt"`,
  `<${SITE_URL}/llms-full.txt>; rel="alternate"; type="text/plain"; title="All articles with summaries"`,
  `<${SITE_URL}/.well-known/mcp/server-card.json>; rel="service-desc"; type="application/json"`,
  `<${SITE_URL}/.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"`,
].join(", ");

/**
 * 给 HTML 响应追加 Link 头与 Vary: Accept。
 * - 仅对 text/html 响应生效，避免污染图片、JSON、字体等
 * - 用 append 保留 vinext 可能已设置的其它 Link 头
 */
export function withAgentLinkHeaders(response: Response): Response {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return response;
  }

  const headers = new Headers(response.headers);
  const existingLink = headers.get("link");
  if (existingLink) {
    headers.set("Link", `${existingLink}, ${AGENT_LINK_HEADER}`);
  } else {
    headers.set("Link", AGENT_LINK_HEADER);
  }

  const vary = headers.get("vary");
  headers.set("Vary", vary ? mergeVary(vary, "Accept") : "Accept");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
