import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-[860px] flex-col items-center justify-center px-4">
      <h1 className="text-4xl font-bold">404 Page Not Found</h1>
      <p className="mt-3 text-zinc-500 dark:text-zinc-400">
        你访问的页面不存在或已被迁移。
      </p>
      <Link
        href="/"
        className="mt-5 rounded bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        返回首页
      </Link>
    </main>
  );
}
