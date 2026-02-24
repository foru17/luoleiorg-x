import Link from "next/link";
import {
  IconCalendar,
  IconEye,
  IconFire,
  IconLoading,
  IconYouTube,
} from "@/components/icons";
import type { PostItem } from "@/lib/content/types";
import { getPreviewImage } from "@/lib/content/utils";
import { hotArticleViews } from "@/lib/site-config";

interface ArticleCardProps {
  post: PostItem;
  hits?: number;
  hitsLoading?: boolean;
}

export function ArticleCard({
  post,
  hits = 0,
  hitsLoading = false,
}: ArticleCardProps) {
  const imageUrl = getPreviewImage(post.cover);
  const isVideo = post.categories.includes("zuoluotv");
  const isHot = hits > hotArticleViews;

  return (
    <article className="overflow-hidden flex h-full flex-col rounded-t bg-white shadow-lg transition duration-300 ease-in-out hover:shadow-2xl dark:bg-zinc-800">
      <Link href={post.url} className="block relative">
        <div
          className="h-60 w-full bg-zinc-100 bg-cover bg-center transition duration-300 ease-in hover:scale-105 md:h-40"
          style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
        />
        {isVideo ? (
          <IconYouTube className="absolute bottom-2 left-6 h-7 w-7 md:h-5 md:w-5" />
        ) : null}
      </Link>
      <div className="px-6 mt-5 w-full flex-1">
        <Link
          href={post.url}
          className="line-clamp-2 text-base font-medium text-gray-800 break-normal dark:text-slate-300"
        >
          {post.title}
        </Link>
      </div>
      <div className="mt-auto h-12 bg-white px-6 py-3 shadow-lg dark:bg-zinc-800">
        <div className="flex items-center justify-between">
          <p className="mb-3 flex items-center font-mono text-sm text-slate-500 dark:text-slate-400">
            <IconCalendar className="mr-1 h-3 w-3" />
            {post.formatShowDate}
          </p>
          <div className="flex items-center text-sm text-gray-400 dark:text-slate-400">
            {hitsLoading ? (
              <IconLoading className="mr-1 h-3 w-3 animate-spin text-gray-200 dark:text-gray-600" />
            ) : isHot ? (
              <IconFire className="mr-1 h-3 w-3 text-red-400 dark:text-red-500" />
            ) : (
              <IconEye className="mr-1 h-3 w-3 text-gray-400 dark:text-slate-400" />
            )}
            <span className={isHot ? "text-red-400 dark:text-red-500" : ""}>
              {hits.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
