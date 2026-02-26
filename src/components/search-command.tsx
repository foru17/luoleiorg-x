"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FileText, LoaderCircle, Search } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

interface SearchItem {
  id: string;
  title: string;
  url: string;
  cover?: string;
  excerpt: string;
  content: string;
  score: number;
}

interface SearchResponse {
  results: SearchItem[];
}

interface PagefindData {
  url: string;
  excerpt?: string;
  content?: string;
  meta?: {
    title?: string;
    cover?: string;
  };
}

interface PagefindResult {
  id: string;
  score: number;
  data: () => Promise<PagefindData>;
}

interface PagefindSearchResponse {
  results: PagefindResult[];
}

interface PagefindApi {
  search: (
    query: string,
    options?: { limit?: number },
  ) => Promise<PagefindSearchResponse>;
  options?: (options: { bundlePath?: string; baseUrl?: string }) => void;
}

function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(url: string): string {
  if (!url) return "/";

  let value = url;
  try {
    value = new URL(url, "http://localhost").pathname;
  } catch {
    value = url;
  }

  value = value.replace(/^\/pagefind(?=\/|$)/, "") || "/";
  value = value.replace(/\/index\.html$/, "") || "/";

  if (!value.startsWith("/")) {
    value = `/${value}`;
  }

  const clean =
    value.endsWith("/") && value !== "/" ? value.slice(0, -1) : value;
  return clean === "/home" ? "/" : clean;
}

async function loadPagefind(): Promise<PagefindApi | null> {
  try {
    const pagefindPath = "/pagefind/pagefind.js";
    const mod = (await import(
      /* @vite-ignore */ pagefindPath
    )) as Partial<PagefindApi>;
    if (typeof mod.search !== "function") return null;
    if (typeof mod.options === "function") {
      mod.options({ bundlePath: "/pagefind/", baseUrl: "/" });
    }
    return mod as PagefindApi;
  } catch {
    return null;
  }
}

async function fetchFromApi(
  query: string,
  signal: AbortSignal,
): Promise<SearchItem[]> {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  params.set("limit", "24");

  const res = await fetch(`/api/search/docs?${params.toString()}`, {
    signal,
    cache: "no-store",
  });
  const data = (await res.json()) as SearchResponse;
  return Array.isArray(data.results) ? data.results : [];
}

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const cacheRef = useRef(new Map<string, SearchItem[]>());
  const pagefindRef = useRef<PagefindApi | null>(null);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    const normalized = value.trim().toLowerCase();
    const cached = cacheRef.current.get(normalized);
    if (cached) {
      setResults(cached);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    const normalized = query.trim().toLowerCase();
    const controller = new AbortController();

    const timer = setTimeout(() => {
      const run = async () => {
        const cached = cacheRef.current.get(normalized);
        if (cached) {
          setResults(cached);
          return;
        }

        setLoading(true);

        try {
          if (!normalized) {
            const latest = await fetchFromApi("", controller.signal);
            cacheRef.current.set(normalized, latest);
            setResults(latest);
            return;
          }

          if (!pagefindRef.current) {
            pagefindRef.current = await loadPagefind();
          }

          if (pagefindRef.current) {
            const found = await pagefindRef.current.search(normalized, {
              limit: 24,
            });

            const mapped = await Promise.all(
              found.results.map(async (entry) => {
                const data = await entry.data();
                const excerpt = stripHtml(data.excerpt ?? "");
                const content = stripHtml(data.content ?? "");

                return {
                  id: entry.id,
                  title: data.meta?.title?.trim() || normalizeUrl(data.url),
                  url: normalizeUrl(data.url),
                  cover: data.meta?.cover?.trim() || "",
                  excerpt,
                  content,
                  score: entry.score,
                } satisfies SearchItem;
              }),
            );

            cacheRef.current.set(normalized, mapped);
            setResults(mapped);
            return;
          }

          const fallback = await fetchFromApi(normalized, controller.signal);
          cacheRef.current.set(normalized, fallback);
          setResults(fallback);
        } catch (error: unknown) {
          if (error instanceof Error && error.name === "AbortError") return;
          const fallback = await fetchFromApi(
            normalized,
            controller.signal,
          ).catch(() => []);
          cacheRef.current.set(normalized, fallback);
          setResults(fallback);
        } finally {
          setLoading(false);
        }
      };

      void run();
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 w-8 items-center justify-center gap-2 rounded-md border border-transparent bg-transparent text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-transparent dark:text-zinc-300 dark:hover:bg-zinc-800 sm:w-auto sm:justify-start sm:border-zinc-200 sm:bg-transparent sm:px-2 sm:py-1 sm:dark:border-zinc-700"
        aria-label="Open search"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search</span>
        <span className="hidden rounded border border-zinc-300 px-1 text-[10px] text-zinc-400 lg:inline dark:border-zinc-600">
          ⌘K
        </span>
      </button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={handleQueryChange}
            placeholder="搜索文章标题或正文内容..."
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-zinc-500">
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                正在搜索...
              </div>
            ) : null}

            {!loading ? (
              <>
                <CommandEmpty>没有找到相关内容</CommandEmpty>
                <CommandGroup heading="Articles">
                  {results.map((item) => (
                    <CommandItem
                      key={`${item.id}-${item.url}`}
                      value={`${item.title} ${item.excerpt} ${item.content}`}
                      onSelect={() => {
                        setOpen(false);
                        setQuery("");
                        router.push(item.url);
                      }}
                    >
                      {item.cover ? (
                        <Image
                          src={item.cover}
                          alt=""
                          width={64}
                          height={48}
                          className="h-12 w-16 shrink-0 rounded object-cover"
                          unoptimized
                        />
                      ) : (
                        <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-zinc-100 dark:bg-zinc-800">
                          <FileText className="h-4 w-4 text-zinc-400" />
                        </div>
                      )}
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-zinc-800 dark:text-zinc-100">
                          {item.title}
                        </span>
                        <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {item.excerpt || item.content.slice(0, 80)}
                        </span>
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
