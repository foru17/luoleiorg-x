"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { FileText, Search } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SKELETON_ROWS } from "@/lib/constants";
import { dispatchRouteTransitionStart } from "@/lib/route-transition";
import { useSearchCommandState } from "@/hooks/use-search-command";

export function SearchCommand() {
  const router = useRouter();
  const {
    open,
    query,
    results,
    loading,
    currentSlug,
    handleOpenChange,
    handleQueryChange,
    resetQuery,
  } = useSearchCommandState();

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        className="inline-flex h-8 w-8 items-center justify-center gap-2 rounded-md border border-transparent bg-transparent text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-transparent dark:text-zinc-300 dark:hover:bg-zinc-800 sm:w-auto sm:justify-start sm:border-zinc-200 sm:bg-transparent sm:px-2 sm:py-1 sm:dark:border-zinc-700"
        aria-label="Open search"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">搜索</span>
        <span className="hidden rounded border border-zinc-300 px-1 text-[10px] text-zinc-400 lg:inline dark:border-zinc-600">
          ⌘K
        </span>
      </button>

      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={handleQueryChange}
            placeholder={currentSlug ? "搜索更多文章..." : "搜索文章标题或正文内容..."}
          />
          <CommandList>
            {loading ? (
              <CommandGroup
                heading={!query.trim() && currentSlug ? "相关推荐" : "文章"}
              >
                {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                  <div
                    key={`skeleton-${index}`}
                    aria-hidden="true"
                    className="flex items-center gap-2 rounded-md px-2 py-2"
                  >
                    <div className="h-12 w-16 shrink-0 rounded bg-zinc-200/80 animate-pulse dark:bg-zinc-700/80" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="h-3 w-4/5 rounded bg-zinc-200/85 animate-pulse dark:bg-zinc-700/85" />
                      <div className="h-3 w-full rounded bg-zinc-200/60 animate-pulse dark:bg-zinc-700/60" />
                    </div>
                  </div>
                ))}
              </CommandGroup>
            ) : null}

            {!loading ? (
              <>
                <CommandEmpty>没有找到相关内容</CommandEmpty>
                <CommandGroup heading={!query.trim() && currentSlug ? "相关推荐" : "文章"}>
                  {results.map((item) => (
                    <CommandItem
                      key={`${item.id}-${item.url}`}
                      value={`${item.title} ${item.excerpt} ${item.content}`}
                      onSelect={() => {
                        handleOpenChange(false);
                        resetQuery();
                        dispatchRouteTransitionStart({ href: item.url });
                        router.push(item.url);
                      }}
                    >
                      <div className="relative flex h-12 w-16 shrink-0 items-center justify-center rounded bg-zinc-100 dark:bg-zinc-800">
                        <FileText className="h-4 w-4 text-zinc-400" />
                        {item.cover && (
                          <Image
                            src={item.cover}
                            alt=""
                            width={64}
                            height={48}
                            className="absolute inset-0 h-full w-full rounded object-cover"
                            unoptimized
                          />
                        )}
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-zinc-800 dark:text-zinc-100">
                          {item.title}
                        </span>
                        {item.keyPoints && item.keyPoints.length > 0 ? (
                          <span className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                            {item.keyPoints.slice(0, 2).join(" · ")}
                          </span>
                        ) : (
                          <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {item.excerpt || item.content.slice(0, 80)}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
