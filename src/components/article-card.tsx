"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
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
  const isRemoteImage = /^https?:\/\//.test(imageUrl);
  const isVideo = post.categories.includes("zuoluotv");
  const isHot = hits > hotArticleViews;
  const [imageLoaded, setImageLoaded] = useState(isRemoteImage || !imageUrl);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!imageUrl) {
      setImageLoaded(true);
      setImageError(true);
      return;
    }

    if (isRemoteImage) {
      setImageLoaded(true);
      setImageError(false);
      return;
    }

    setImageLoaded(false);
    setImageError(false);
  }, [imageUrl, isRemoteImage]);

  useEffect(() => {
    if (!imageUrl || imageLoaded || isRemoteImage) return;

    const timer = window.setTimeout(() => {
      setImageError(true);
      setImageLoaded(true);
    }, 15000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [imageLoaded, imageUrl, isRemoteImage]);

  return (
    <article className="group flex h-full flex-col">
      <div className="overflow-hidden flex-1 h-full rounded-t bg-white shadow-lg duration-300 ease-in-out group-hover:shadow-2xl dark:bg-zinc-800">
        <div className="flex min-h-60 flex-wrap no-underline hover:no-underline md:min-h-40 lg:min-h-40">
          <Link
            href={post.url}
            className="block overflow-hidden relative h-60 w-full bg-zinc-100 dark:bg-neutral-900 md:h-40 lg:h-40"
          >
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={post.title}
                fill
                unoptimized
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                className={`absolute top-0 left-0 h-full w-full object-cover duration-300 ease-in hover:scale-105 ${
                  imageLoaded && !imageError ? "opacity-100" : "opacity-0"
                }`}
                onLoad={() => {
                  setImageError(false);
                  setImageLoaded(true);
                }}
                onError={() => {
                  setImageError(true);
                  setImageLoaded(true);
                }}
              />
            ) : null}

            {isVideo ? (
              <IconYouTube className="absolute bottom-2 left-6 h-7 w-7 md:h-5 md:w-5" />
            ) : null}

            {!imageLoaded || imageError ? (
              <div
                className={`absolute top-0 left-0 flex h-full w-full space-x-4 p-2 pt-6 ${
                  imageLoaded ? "" : "animate-pulse"
                }`}
              >
                {imageError ? (
                  <div className="mt-1 h-0 w-0 border-l-[20px] border-r-[20px] border-t-[30px] border-l-transparent border-r-transparent border-t-slate-200 dark:border-t-slate-600" />
                ) : (
                  <span className="relative flex h-10 w-10">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-100 opacity-75" />
                    <span className="relative inline-flex h-10 w-10 rounded-full bg-slate-200 dark:bg-slate-600" />
                  </span>
                )}

                <div className="flex-1 space-y-6 py-1">
                  <div className="h-8 rounded bg-slate-200 dark:bg-slate-600 md:h-4" />
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="col-span-2 h-8 rounded bg-slate-200 dark:bg-slate-600 md:h-4" />
                      <div className="col-span-1 h-8 rounded bg-slate-200 dark:bg-slate-600 md:h-4" />
                    </div>
                    <div className="h-8 rounded bg-slate-200 dark:bg-slate-600 md:h-4" />
                  </div>
                </div>
              </div>
            ) : null}
          </Link>

          <div className="mt-5 w-full px-6">
            <Link
              href={post.url}
              className="line-clamp-2 h-auto break-normal text-base antialiased font-medium text-gray-800 dark:!text-slate-300 sm:text-lg md:h-12 md:text-base"
            >
              {post.title}
            </Link>
          </div>
        </div>
      </div>

      <div className="overflow-hidden mt-auto h-12 flex-none rounded-b rounded-t-none bg-white px-6 py-3 shadow-lg dark:bg-zinc-800">
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
