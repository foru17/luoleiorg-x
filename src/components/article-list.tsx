import type { PostItem } from "@/lib/content/types";
import { ArticleListClient } from "./article-list-client";

interface ArticleListProps {
  posts: PostItem[];
  hitsMap?: Map<string, number>;
  hitsLoading?: boolean;
}

export function ArticleList({
  posts,
  hitsMap,
  hitsLoading = false,
}: ArticleListProps) {
  const initialHits = Object.fromEntries(
    posts.map((post) => [post.slug, hitsMap?.get(post.slug) ?? 0]),
  );

  return (
    <ArticleListClient
      posts={posts}
      initialHits={initialHits}
      hitsLoading={hitsLoading}
    />
  );
}
