"use client";

import type { PostItem } from "@/lib/content/types";
import { useArticleHits } from "@/hooks/use-article-hits";
import { ArticleCard } from "./article-card";

interface ArticleListClientProps {
  posts: PostItem[];
  initialHits: Record<string, number>;
  hitsLoading?: boolean;
}

export function ArticleListClient({
  posts,
  initialHits,
  hitsLoading = false,
}: ArticleListClientProps) {
  const needsClientHits = hitsLoading;
  const {
    loading: clientHitsLoading,
    map: clientHitsMap,
  } = useArticleHits(needsClientHits);

  const resolvedHitsLoading = needsClientHits && clientHitsLoading;

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-4 md:px-6 lg:px-2">
      <ul className="grid grid-cols-1 gap-6 pt-3 sm:grid-cols-2 md:pt-6 lg:grid-cols-3 xl:grid-cols-4">
        {posts.map((post, index) => {
          const hydratedHits = clientHitsMap.get(post.slug);
          const hits = hydratedHits ?? initialHits[post.slug] ?? 0;

          return (
            <li key={post.slug} className="flex flex-col">
              <ArticleCard
                post={post}
                hits={hits}
                hitsLoading={resolvedHitsLoading}
                priority={index < 4}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
