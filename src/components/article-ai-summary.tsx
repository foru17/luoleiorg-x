"use client";

import { useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { ArticleShareDialog } from "@/components/article-share-dialog";

interface ArticleAISummaryProps {
  summary: {
    summary: string;
    abstract: string;
    tags: string[];
  };
  share: {
    slug: string;
    title: string;
    articleUrl: string;
  };
}

export function ArticleAISummary({ summary, share }: ArticleAISummaryProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="my-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition-all hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span>AI 摘要</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
        <ArticleShareDialog
          slug={share.slug}
          title={share.title}
          articleUrl={share.articleUrl}
        />
      </div>

      {isOpen && (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-white/80 px-6 py-5 backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-800/60">
          <p className="text-base leading-[1.9] text-zinc-600 dark:text-zinc-400 ">
            {summary.abstract}
          </p>

          {summary.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-700/60">
              {summary.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
