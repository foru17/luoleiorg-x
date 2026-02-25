import Link from "next/link";
import Image from "next/image";
import { Menu } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { IconGitHub, IconX } from "@/components/icons";
import { SearchCommand } from "./search-command";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-[color:var(--vp-c-bg)]/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-[color:var(--vp-c-bg)]/90">
      <div className="mx-auto flex h-[52px] w-full max-w-[1280px] items-center justify-between px-4 md:px-8">
        <Link
          href="/"
          className="home-nav-title flex items-center gap-2 whitespace-nowrap text-[15px] font-medium tracking-wide"
        >
          <Image
            src="/legacy/logo.png"
            alt="luolei logo"
            width={24}
            height={24}
            className="h-6 w-6 rounded-sm"
          />
          <span className="hidden sm:inline">罗磊的独立博客</span>
        </Link>
        <nav className="flex items-center text-[13px] text-zinc-600 dark:text-zinc-300">
          <div className="hidden items-center md:flex">
            <div className="flex items-center gap-2.5">
              <a
                href={siteConfig.social.youtube}
                target="_blank"
                rel="noopener noreferrer"
                className="px-1 py-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                ZUOLUOTV
              </a>
              <a
                href="/rss.xml"
                target="_blank"
                rel="noopener noreferrer"
                className="px-1 py-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                RSS
              </a>
              <a
                href={siteConfig.social.github}
                target="_blank"
                rel="noopener noreferrer"
                className="px-1 py-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                关于
              </a>
            </div>

            <span className="mx-3 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

            <div className="flex items-center gap-1">
              <ThemeToggle />
              <a
                href={siteConfig.social.twitter}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X"
                title="X"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-all duration-150 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-700"
              >
                <IconX className="h-5 w-5" />
              </a>
              <a
                href={siteConfig.social.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                title="GitHub"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-600 transition-all duration-150 hover:-translate-y-0.5 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-700"
              >
                <IconGitHub className="h-5 w-5" />
              </a>
            </div>

            <div className="ml-3">
              <SearchCommand />
            </div>
          </div>

          <div className="flex items-center gap-1 md:hidden">
            <SearchCommand />
            <ThemeToggle />

            <details className="relative [&_summary::-webkit-details-marker]:hidden">
              <summary
                className="inline-flex h-8 w-8 list-none cursor-pointer items-center justify-center rounded-md border border-transparent bg-transparent text-zinc-600 transition-all duration-150 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 dark:border-transparent dark:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 dark:focus-visible:ring-zinc-700"
                aria-label="打开顶部菜单"
                title="菜单"
              >
                <Menu className="h-4 w-4" />
              </summary>

              <div className="absolute right-0 top-10 z-40 w-44 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <a
                  href={siteConfig.social.youtube}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <span>ZUOLUOTV</span>
                </a>
                <a
                  href="/rss.xml"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <span>RSS</span>
                </a>
                <a
                  href={siteConfig.social.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <span>关于</span>
                </a>
                <a
                  href={siteConfig.social.twitter}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <span>X</span>
                  <IconX className="h-4 w-4" />
                </a>
                <a
                  href={siteConfig.social.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  <span>GitHub</span>
                  <IconGitHub className="h-4 w-4" />
                </a>
              </div>
            </details>
          </div>
        </nav>
      </div>
    </header>
  );
}
