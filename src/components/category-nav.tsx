import Link from "next/link";
import { categoryMap } from "@/lib/site-config";

interface CategoryNavProps {
  currentCategory?: string;
  categoryCounts: Map<string, number>;
}

export function CategoryNav({
  currentCategory,
  categoryCounts,
}: CategoryNavProps) {
  return (
    <div className="mx-auto max-w-7xl px-1 md:px-0 md:px-4">
      <div className="mt-3 h-16 w-full px-4">
        <div className="flex w-full items-center justify-between">
          <div className="m-auto flex flex-wrap items-center text-sm md:text-base">
            <Link
              href="/"
              className={`home-nav-title relative ml-0 mr-0 rounded-xl px-3 py-1 text-center hover:text-rose-400 md:ml-1 md:mr-2 ${
                currentCategory
                  ? "text-zinc-700 dark:text-zinc-300"
                  : "font-semibold text-rose-400"
              }`}
            >
              最新
              <i className="ml-3 hidden text-gray-400 dark:text-slate-500 md:inline-block">
                /
              </i>
            </Link>
            {categoryMap
              .filter((category) => category.isHome)
              .map((category, index, arr) => {
                const active = currentCategory === category.text;
                const count = categoryCounts.get(category.text) ?? 0;

                return (
                  <Link
                    key={category.text}
                    href={`/?category=${category.text}&page=1`}
                    className={`home-nav-title ml-0 mr-0 inline-block rounded-xl px-3 py-1 text-center hover:text-rose-400 md:ml-1 md:mr-2 ${
                      active
                        ? "font-semibold text-rose-400"
                        : "text-zinc-700 hover:text-rose-400 dark:text-zinc-300"
                    }`}
                  >
                    {category.name}
                    <span className="ml-1 text-xs text-zinc-400">
                      ({count})
                    </span>
                    <i
                      className={`ml-3 hidden text-gray-400 dark:text-slate-500 md:inline-block ${
                        index === arr.length - 1 ? "md:hidden" : ""
                      }`}
                    >
                      /
                    </i>
                  </Link>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
