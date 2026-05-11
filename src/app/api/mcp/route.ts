/**
 * MCP server (Model Context Protocol) — JSON-RPC 2.0 over HTTP.
 *
 * 暴露 luolei.org 的只读能力给任何 MCP 客户端（Claude Desktop、Cursor、Cline 等）。
 * 用户可以把 https://luolei.org/api/mcp 当作 streamable-http MCP server 挂上，
 * 然后直接对话：「搜一下罗磊关于 RSC 的文章」「读 luolei-ai 这篇全文」。
 *
 * 协议参考：
 *  - https://modelcontextprotocol.io/specification/2025-06-18
 *  - https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127 (server card)
 *
 * 设计要点：
 *  - 完全只读，无副作用
 *  - 不通过 fetch 自调，直接复用同进程内的 posts / search-core 模块（零网络）
 *  - 不持有会话状态——每次请求独立处理
 */

import {
  createSearchIndex,
  searchDocuments,
  type SearchDocument,
  type SearchIndexedDocument,
} from "@luoleiorg/search-core";
import { getAISummary } from "@/lib/content/ai-data";
import {
  getAllPosts,
  getPostRawContent,
  getPostSummaryBySlug,
  getSearchDocuments,
} from "@/lib/content/posts";
import { siteConfig } from "@/lib/site-config";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_NAME = "luolei.org";
const SERVER_VERSION = "1.0.0";

// JSON-RPC 2.0 标准错误码
const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
}

const TOOLS = [
  {
    name: "search_articles",
    description:
      "Full-text search across all luolei.org blog articles. Returns title, URL, excerpt, AI key points and categories for each match. Use this when the user asks about topics the author may have written about (programming, AI, photography, travel, running, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search keywords. UTF-8 (Chinese or English).",
        },
        limit: {
          type: "number",
          description: "Max results, 1–50. Default 10.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_article",
    description:
      "Fetch the full markdown content of one luolei.org article by its slug (the URL path segment). Returns frontmatter (title, URL, date, categories, license) plus the article body.",
    inputSchema: {
      type: "object",
      properties: {
        slug: {
          type: "string",
          description:
            "Article slug from the URL, e.g. 'luolei-ai' for https://luolei.org/luolei-ai",
        },
      },
      required: ["slug"],
    },
  },
  {
    name: "list_recent_articles",
    description:
      "List the most recently published articles on luolei.org in reverse-chronological order.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max results, 1–50. Default 10.",
        },
      },
    },
  },
];

const SAFE_LIMIT = (n: unknown, def = 10): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.min(50, Math.max(1, Math.floor(v)));
};

let cachedDocs: SearchDocument[] | null = null;
let cachedIndex: SearchIndexedDocument[] | null = null;
function loadSearch() {
  if (cachedDocs && cachedIndex) return { docs: cachedDocs, index: cachedIndex };
  cachedDocs = getSearchDocuments();
  cachedIndex = createSearchIndex(cachedDocs);
  return { docs: cachedDocs, index: cachedIndex };
}

function toResultPayload(doc: SearchDocument, score?: number) {
  return {
    slug: doc.id,
    title: doc.title,
    url: doc.url,
    date: new Date(doc.dateTime).toISOString().slice(0, 10),
    categories: doc.categories,
    excerpt: doc.excerpt,
    keyPoints: doc.keyPoints ?? [],
    ...(score !== undefined ? { score } : {}),
  };
}

function asTextContent(payload: unknown) {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "search_articles") {
    const query = String(args.query ?? "").trim();
    if (!query) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, "query is required");
    }
    const { index } = loadSearch();
    const limit = SAFE_LIMIT(args.limit, 10);
    const results = searchDocuments(index, query, limit).map((r) =>
      toResultPayload(r, r.score),
    );
    return asTextContent({ query, total: results.length, results });
  }

  if (name === "read_article") {
    const slug = String(args.slug ?? "").trim();
    if (!slug) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, "slug is required");
    }
    const post = getPostSummaryBySlug(slug);
    const raw = getPostRawContent(slug);
    if (!post || !raw) {
      throw new RpcError(
        RPC_ERRORS.INVALID_PARAMS,
        `Article '${slug}' not found`,
      );
    }
    const summary = getAISummary(slug);
    const header = [
      "---",
      `title: ${JSON.stringify(post.title)}`,
      `url: ${siteConfig.siteUrl}/${post.slug}`,
      `date: ${new Date(post.dateTime).toISOString().slice(0, 10)}`,
      post.categories.length > 0
        ? `categories: [${post.categories.join(", ")}]`
        : null,
      summary?.summary ? `summary: ${JSON.stringify(summary.summary)}` : null,
      "source: https://luolei.org",
      "license: CC BY-NC-ND 4.0",
      "---",
      "",
    ]
      .filter(Boolean)
      .join("\n");
    return asTextContent(`${header}\n${raw}`);
  }

  if (name === "list_recent_articles") {
    const limit = SAFE_LIMIT(args.limit, 10);
    const posts = getAllPosts()
      .slice()
      .sort((a, b) => b.dateTime - a.dateTime)
      .slice(0, limit)
      .map((p) => {
        const summary = getAISummary(p.slug);
        return {
          slug: p.slug,
          title: p.title,
          url: `${siteConfig.siteUrl}/${p.slug}`,
          date: new Date(p.dateTime).toISOString().slice(0, 10),
          categories: p.categories,
          excerpt: p.excerpt,
          summary: summary?.summary ?? null,
        };
      });
    return asTextContent({ total: posts.length, articles: posts });
  }

  throw new RpcError(RPC_ERRORS.METHOD_NOT_FOUND, `Unknown tool: ${name}`);
}

class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) {
    super(message);
  }
}

function makeResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function rpcResponse(id: string | number | null | undefined, body: unknown) {
  return makeResponse({ jsonrpc: "2.0", id: id ?? null, ...(body as object) });
}

async function dispatch(req: JsonRpcRequest): Promise<Response | null> {
  const { id, method, params } = req;

  try {
    switch (method) {
      case "initialize":
        return rpcResponse(id, {
          result: {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            capabilities: { tools: { listChanged: false } },
          },
        });

      case "ping":
        return rpcResponse(id, { result: {} });

      case "tools/list":
        return rpcResponse(id, { result: { tools: TOOLS } });

      case "tools/call": {
        const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (!p.name) {
          throw new RpcError(RPC_ERRORS.INVALID_PARAMS, "missing tool name");
        }
        const out = await callTool(p.name, p.arguments ?? {});
        return rpcResponse(id, { result: out });
      }

      // 通知 (notification) 没有 id，不需要响应
      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      default:
        return rpcResponse(id, {
          error: { code: RPC_ERRORS.METHOD_NOT_FOUND, message: `Method not found: ${method}` },
        });
    }
  } catch (err) {
    if (err instanceof RpcError) {
      return rpcResponse(id, {
        error: { code: err.code, message: err.message, ...(err.data ? { data: err.data } : {}) },
      });
    }
    return rpcResponse(id, {
      error: {
        code: RPC_ERRORS.INTERNAL_ERROR,
        message: err instanceof Error ? err.message : "Internal error",
      },
    });
  }
}

export async function POST(request: Request) {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return makeResponse(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: RPC_ERRORS.PARSE_ERROR, message: "Parse error" },
      },
      400,
    );
  }

  // 支持批量请求 (JSON-RPC batch)
  if (Array.isArray(parsed)) {
    const responses = await Promise.all(
      parsed.map((r) => dispatch(r as JsonRpcRequest)),
    );
    const filtered = responses.filter((r): r is Response => r !== null);
    if (filtered.length === 0) {
      // 全部是通知，无返回
      return new Response(null, { status: 204 });
    }
    const bodies = await Promise.all(filtered.map((r) => r.json()));
    return makeResponse(bodies);
  }

  const result = await dispatch(parsed as JsonRpcRequest);
  return result ?? new Response(null, { status: 204 });
}

// 用 GET 返回一个简短的人类可读说明 + 服务器信息，避免 MCP 客户端首次连接 /
// 浏览器访问 /api/mcp 时返回 405 让人迷惑
export function GET() {
  return makeResponse({
    jsonrpc: "2.0",
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    protocolVersion: PROTOCOL_VERSION,
    transport: { type: "streamable-http", url: `${siteConfig.siteUrl}/api/mcp` },
    capabilities: { tools: { listChanged: false } },
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
    note: "Send JSON-RPC 2.0 POST requests to this endpoint. See /.well-known/mcp/server-card.json for the server card.",
  });
}
