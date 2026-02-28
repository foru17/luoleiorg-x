import { CategoryNav } from "@/components/category-nav";
import { PaginationNav } from "@/components/pagination-nav";

interface LoadingProps {
  params?: Promise<{ page: string }>;
}

export default async function Loading({ params }: LoadingProps) {
  const routeParams = params ? await params : { page: "1" };
  const page = parseInt(routeParams.page, 10) || 1;

  // Generate skeleton cards - 布局与 ArticleList 完全一致
  const skeletonCards = Array.from({ length: 12 }, (_, i) => (
    <li key={i} className="flex flex-col">
      <article className="group flex h-full flex-col rounded-lg bg-white dark:bg-zinc-800 shadow-lg overflow-hidden">
        {/* 图片区域 - 与实际卡片尺寸一致 */}
        <div className="block relative h-60 w-full md:h-40 lg:h-40 flex-shrink-0 bg-zinc-100 dark:bg-neutral-900 overflow-hidden">
          <div className="absolute inset-0 animate-pulse bg-zinc-200 dark:bg-zinc-700" />
        </div>

        {/* 内容区域 - 与实际卡片一致 */}
        <div className="flex-1 flex flex-col px-6 py-5">
          {/* 标题骨架 */}
          <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />

          {/* 日期栏骨架 - 使用 mt-auto 与实际卡片一致 */}
          <div className="flex items-center justify-between mt-auto pt-4">
            <div className="h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-3 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
          </div>
        </div>
      </article>
    </li>
  ));

  return (
    <main className="pb-8 pt-2">
      <CategoryNav />
      <div className="mx-auto max-w-[1240px] px-4 sm:px-4 md:px-6 lg:px-2">
        <ul className="grid grid-cols-1 gap-6 pt-3 sm:grid-cols-2 md:pt-6 lg:grid-cols-3 xl:grid-cols-4">
          {skeletonCards}
        </ul>
      </div>
      <PaginationNav page={page} pageTotal={page + 1} />
    </main>
  );
}
