import { getPostRawContent, getPostSummaryBySlug } from "@/lib/content/posts";
import { siteConfig } from "@/lib/site-config";

export const dynamicParams = false;

export async function generateStaticParams() {
  // 与 [slug]/page.tsx 保持一致：只为已发布文章生成路由
  const { getAllPosts } = await import("@/lib/content/posts");
  return getAllPosts().map((post) => ({ slug: post.slug }));
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const post = getPostSummaryBySlug(slug);
  const raw = getPostRawContent(slug);

  if (!post || !raw) {
    return new Response("Not Found\n", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // 在文件顶部加一段 YAML frontmatter 风格的元信息，方便 AI 引用时直接拿到 URL/日期
  const header = [
    "---",
    `title: ${JSON.stringify(post.title)}`,
    `url: ${siteConfig.siteUrl}/${post.slug}`,
    `date: ${new Date(post.dateTime).toISOString().slice(0, 10)}`,
    post.categories.length > 0
      ? `categories: [${post.categories.join(", ")}]`
      : null,
    "source: https://luolei.org",
    "license: CC BY-NC-ND 4.0",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return new Response(`${header}\n${raw}`, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "X-Robots-Tag": "all",
    },
  });
}
