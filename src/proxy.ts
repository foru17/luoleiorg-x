import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 把 /{slug}.md 重写到 /api/raw/{slug}，让 AI 助手 / 爬虫能获取原始 markdown，
// 同时人类访问 https://luolei.org/foo.md 也能直接看到带 YAML frontmatter 的源文件。
//
// 在 Next.js 16 / vinext 中，原 middleware.ts 已重命名为 proxy.ts。
const SLUG_PATTERN = /^\/([A-Za-z0-9][A-Za-z0-9._-]*)\.md$/;

const SKIP_PATHS = new Set(["/llms.md", "/llms-full.md"]);

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (SKIP_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const match = pathname.match(SLUG_PATTERN);
  if (!match) {
    return NextResponse.next();
  }

  const slug = match[1];
  const url = request.nextUrl.clone();
  url.pathname = `/api/raw/${slug}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: [
    "/((?!_next/|_vinext/|api/|images/|icons/|legacy/|pagefind/|favicon|sitemap\\.xml|robots\\.txt|llms\\.txt|llms-full\\.txt|manifest\\.json|opensearch\\.xml|rss\\.xml|feed\\.xml).*)",
  ],
};
