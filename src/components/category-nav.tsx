import Link from "next/link";
import { categoryMap } from "@/lib/site-config";

interface CategoryNavProps {
  currentCategory?: string;
}

export function CategoryNav({ currentCategory }: CategoryNavProps) {
  return (
    <div className="mx-auto max-w-7xl px-1 md:px-4 md:px-0">
      <div className="mt-3 h-16 w-full px-4">
        <div className="flex w-full items-center justify-between">
          <div className="m-auto flex items-center text-black dark:text-slate-300">
            <Link
              href="/"
              className={`home-nav-title relative ml-0 mr-0 rounded-xl px-3 py-1 text-center text-sm hover:text-rose-400 md:ml-1 md:mr-2 md:text-base ${
                currentCategory
                  ? "!text-black dark:!text-slate-300"
                  : "!text-rose-400 !font-semibold dark:!text-rose-400"
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

                return (
                  <Link
                    key={category.text}
                    href={`/?category=${category.text}&page=1`}
                    className={`home-nav-title ml-0 mr-0 inline-block rounded-xl px-3 py-1 text-center text-sm hover:text-rose-400 md:ml-1 md:mr-2 md:px-3 md:text-base ${
                      active
                        ? "!text-rose-400 !font-semibold dark:!text-rose-400"
                        : ""
                    }`}
                  >
                    {category.name}
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
