"use client";

import { useEffect, useRef, useState } from "react";
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
  excerpt: string;
  content: string;
  score: number;
}

interface SearchResponse {
  results: SearchItem[];
}

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const cacheRef = useRef(new Map<string, SearchItem[]>());

  const handleQueryChange = (value: string) => {
    setQuery(value);
    const normalized = value.trim().toLowerCase();
    if (cacheRef.current.has(normalized)) {
      setResults(cacheRef.current.get(normalized) ?? []);
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
    if (cacheRef.current.has(normalized)) return;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (normalized) params.set("q", normalized);
      params.set("limit", "24");

      fetch(`/api/search/docs?${params.toString()}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then((res) => res.json() as Promise<SearchResponse>)
        .then((data) => {
          const nextResults = Array.isArray(data.results) ? data.results : [];
          cacheRef.current.set(normalized, nextResults);
          setResults(nextResults);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "AbortError") return;
          setResults([]);
        })
        .finally(() => {
          setLoading(false);
        });
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
        className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="Open search"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search</span>
        <span className="hidden rounded border border-zinc-300 px-1 text-[10px] text-zinc-400 md:inline dark:border-zinc-600">
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
                      key={item.id}
                      value={`${item.title} ${item.excerpt} ${item.content}`}
                      onSelect={() => {
                        setOpen(false);
                        setQuery("");
                        router.push(item.url);
                      }}
                    >
                      <FileText className="h-4 w-4 text-zinc-400" />
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
