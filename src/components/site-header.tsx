import Link from "next/link";
import Image from "next/image";
import { siteConfig } from "@/lib/site-config";
import { SearchCommand } from "./search-command";
import { ThemeToggle } from "./theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between px-4 md:px-8">
        <Link
          href="/"
          className="home-nav-title flex items-center gap-2 text-base font-semibold tracking-wide"
        >
          <Image
            src="/legacy/logo.png"
            alt="luolei logo"
            width={24}
            height={24}
            className="h-6 w-6 rounded-sm"
          />
          罗磊的独立博客
        </Link>
        <nav className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-300">
          <a href={siteConfig.social.youtube} target="_blank" rel="noreferrer">
            ZUOLUOTV
          </a>
          <a href="/rss.xml" target="_blank" rel="noreferrer">
            RSS
          </a>
          <a href={siteConfig.social.github} target="_blank" rel="noreferrer">
            关于
          </a>
          <SearchCommand />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
