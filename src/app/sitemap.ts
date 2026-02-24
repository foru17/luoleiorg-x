import type { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/content/posts";
import { siteConfig } from "@/lib/site-config";

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = getAllPosts();
  return [
    {
      url: siteConfig.siteUrl,
      lastModified: new Date(),
    },
    ...posts.map((post) => ({
      url: `${siteConfig.siteUrl}/${post.slug}`,
      lastModified: new Date(post.dateTime),
    })),
  ];
}
