import { getAllPosts } from "@/lib/content/posts";
import { siteConfig } from "@/lib/site-config";

export const dynamic = "force-static";

export async function GET() {
  const posts = getAllPosts().slice(0, 15);

  const items = posts
    .map(
      (post) => `
  <item>
    <title><![CDATA[${post.title}]]></title>
    <link>${siteConfig.siteUrl}/${post.slug}</link>
    <guid>${siteConfig.siteUrl}/${post.slug}</guid>
    <pubDate>${new Date(post.dateTime).toUTCString()}</pubDate>
    <description><![CDATA[${post.excerpt}]]></description>
  </item>`,
    )
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title><![CDATA[${siteConfig.title}]]></title>
  <description><![CDATA[${siteConfig.description}]]></description>
  <link>${siteConfig.siteUrl}</link>
  <language>zh-CN</language>
  ${items}
</channel>
</rss>`;

  return new Response(rss, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
}
