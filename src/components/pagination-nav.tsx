import Link from "next/link";

interface PaginationNavProps {
  category?: string;
  page: number;
  pageTotal: number;
}

function makeLink(page: number, category?: string) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  params.set("page", String(page));
  return `/?${params.toString()}`;
}

export function PaginationNav({
  category,
  page,
  pageTotal,
}: PaginationNavProps) {
  const hasPrev = page > 1;
  const hasNext = page < pageTotal;

  return (
    <div className="mt-8 flex items-center justify-center pb-4">
      {hasPrev ? (
        <Link
          className="inline-flex h-8 w-24 items-center justify-center whitespace-nowrap rounded bg-white px-2 text-sm font-medium uppercase leading-normal text-neutral-500 shadow-md transition duration-150 ease-in-out hover:bg-neutral-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          href={makeLink(page - 1, category)}
        >
          上一页
        </Link>
      ) : (
        <span className="inline-flex h-8 w-24 items-center justify-center whitespace-nowrap rounded bg-gray-100 px-2 text-sm font-medium uppercase leading-normal text-neutral-300 dark:bg-zinc-900 dark:text-zinc-600">
          第一页
        </span>
      )}
      <p className="w-16 text-center text-sm font-medium">
        <span className="inline-block text-neutral-500 underline decoration-pink-500 dark:text-slate-400">
          {page}
        </span>
        <span className="text-neutral-900 dark:text-slate-400">/</span>
        <span className="inline-block text-neutral-500 underline decoration-indigo-500 dark:text-slate-400">
          {Math.max(1, pageTotal)}
        </span>
      </p>
      {hasNext ? (
        <Link
          className="inline-flex h-8 w-24 items-center justify-center whitespace-nowrap rounded bg-white px-4 text-sm font-medium uppercase leading-normal text-neutral-500 shadow-md transition duration-150 ease-in-out hover:bg-neutral-100 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          href={makeLink(page + 1, category)}
        >
          下一页
        </Link>
      ) : (
        <span className="inline-flex h-8 w-24 items-center justify-center whitespace-nowrap rounded bg-gray-100 px-4 text-sm font-medium uppercase leading-normal text-neutral-300 dark:bg-zinc-900 dark:text-zinc-600">
          结束
        </span>
      )}
    </div>
  );
}
