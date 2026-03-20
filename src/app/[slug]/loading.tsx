export default function Loading() {
  const skeletonParagraphs = Array.from({ length: 7 }, (_, index) => (
    <div key={index} className="space-y-3">
      <div className="h-4 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      <div className="h-4 w-[92%] animate-pulse rounded bg-zinc-200/90 dark:bg-zinc-700/90" />
      <div className="h-4 w-[78%] animate-pulse rounded bg-zinc-200/75 dark:bg-zinc-700/75" />
    </div>
  ));

  return (
    <main className="mx-auto w-full max-w-[1220px] px-4 pb-12 pt-6 md:px-6">
      <div className="flex flex-col lg:flex-row lg:gap-12">
        <section className="min-w-0 flex-1 lg:max-w-[860px]">
          <div className="relative h-48 overflow-hidden rounded-md bg-zinc-200 sm:h-56 md:h-64 dark:bg-zinc-800">
            <div className="absolute inset-0 animate-pulse bg-zinc-300/70 dark:bg-zinc-700/80" />
            <div className="relative flex h-full items-end px-5 pb-6 md:px-10">
              <div className="w-full max-w-xl space-y-3">
                <div className="h-7 w-3/4 animate-pulse rounded bg-white/35 dark:bg-white/10" />
                <div className="h-7 w-2/5 animate-pulse rounded bg-white/25 dark:bg-white/8" />
                <div className="flex gap-3 pt-2">
                  <div className="h-3 w-20 animate-pulse rounded bg-white/25 dark:bg-white/10" />
                  <div className="h-3 w-16 animate-pulse rounded bg-white/20 dark:bg-white/8" />
                  <div className="h-3 w-14 animate-pulse rounded bg-white/20 dark:bg-white/8" />
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 space-y-8 pb-6 lg:pb-12">
            <div className="rounded-2xl border border-zinc-200/80 bg-white/90 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
              <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="mt-4 space-y-3">
                <div className="h-4 w-full animate-pulse rounded bg-zinc-200/90 dark:bg-zinc-700/90" />
                <div className="h-4 w-[88%] animate-pulse rounded bg-zinc-200/75 dark:bg-zinc-700/75" />
              </div>
            </div>

            {skeletonParagraphs}
          </div>
        </section>

        <aside className="hidden w-[260px] shrink-0 lg:block">
          <div className="sticky top-[92px] rounded-2xl border border-zinc-200/70 bg-white/80 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
            <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            <div className="mt-5 space-y-3">
              {Array.from({ length: 8 }, (_, index) => (
                <div
                  key={index}
                  className="h-3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700"
                  style={{ width: `${72 - index * 4}%` }}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
