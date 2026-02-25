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
    <div className="mx-auto -mt-4 max-w-[1240px] px-4 sm:px-4 md:px-6 lg:px-2">
      <ul className="-mx-3 flex flex-wrap justify-between pt-6 sm:mx-1 md:mx-0 md:pt-12">
        {posts.map((post) => (
          <li
            key={post.slug}
            className="flex w-full flex-shrink flex-grow flex-col px-4 py-3 sm:w-1/2 sm:px-3 md:w-1/4"
          >
            <ArticleCard
              post={post}
              hits={hitsMap?.get(post.slug) ?? 0}
              hitsLoading={hitsLoading}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
