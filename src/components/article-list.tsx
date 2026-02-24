import type { PostItem } from "@/lib/content/types";
import { ArticleCard } from "./article-card";

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
  return (
    <ul className="mx-auto -mt-4 grid w-full max-w-[1240px] grid-cols-1 gap-x-2 gap-y-6 px-4 pt-6 sm:grid-cols-2 md:px-6 lg:grid-cols-4 lg:px-2 md:pt-12">
      {posts.map((post) => (
        <li key={post.slug}>
          <ArticleCard
            post={post}
            hits={hitsMap?.get(post.slug) ?? 0}
            hitsLoading={hitsLoading}
          />
        </li>
      ))}
    </ul>
  );
}
