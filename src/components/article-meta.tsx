"use client";

import type { PostDetail } from "@/lib/content/types";
import { getBannerImage } from "@/lib/content/utils";
import { usePageHits } from "@/hooks/use-article-hits";
import { IconCalendar, IconEye, IconLoading } from "@/components/icons";

interface ArticleMetaProps {
  post: PostDetail;
}

export function ArticleMeta({ post }: ArticleMetaProps) {
  const banner = getBannerImage(post.cover);
  const { loading, hits } = usePageHits(post.slug);

  return (
    <section className="overflow-hidden rounded-md">
      <div
        className="h-64 bg-zinc-200 bg-cover bg-center dark:bg-zinc-800"
        style={banner ? { backgroundImage: `url(${banner})` } : undefined}
      >
        <div className="flex h-full items-center bg-black/30 px-5 md:px-10">
          <div>
            <h1 className="line-clamp-3 max-w-xl break-normal text-xl font-bold leading-10 text-white md:line-clamp-2 md:text-2xl">
              {post.title}
            </h1>
            <p className="mt-2 flex items-center font-mono text-xs leading-none text-neutral-100 md:text-sm">
              <IconCalendar className="mr-1 h-3 w-3 text-neutral-100" />
              <span className="mr-2">{post.date}</span>
              <IconEye className="mr-1 h-3 w-3 text-neutral-100" />
              {loading ? (
                <IconLoading className="-mt-1 mr-2 h-2 w-2 animate-spin text-gray-200 dark:text-slate-600" />
              ) : (
                <i className="not-italic">{hits.toLocaleString()}</i>
              )}
              <span className="ml-2">{post.readingTime}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
