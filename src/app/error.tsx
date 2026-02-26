"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="mb-4 text-4xl font-bold text-zinc-800 dark:text-zinc-100">
        出了点问题
      </h1>
      <p className="mb-8 max-w-md text-zinc-500 dark:text-zinc-400">
        {error.message || "页面加载时发生了意外错误，请稍后重试。"}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-zinc-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-800 dark:hover:bg-zinc-300"
      >
        重试
      </button>
    </main>
  );
}
