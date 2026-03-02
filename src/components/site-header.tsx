"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Menu, Sparkles } from "lucide-react";
import { siteConfig } from "@/lib/site-config";
import { IconGitHub, IconX } from "@/components/icons";
import { SearchCommand } from "./search-command";
import { ThemeToggle } from "./theme-toggle";

function NavAboutLink({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (pathname === "/about") {
      localStorage.setItem("about_visited", "1");
      return;
    }
    if (!localStorage.getItem("about_visited")) {
      setPulse(true);
      const id = setTimeout(() => setPulse(false), 8000);
      return () => clearTimeout(id);
    }
  }, [pathname]);

  if (mobile) {
    return (
      <Link
        href="/about"
        className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles
            className={`h-3 w-3 text-violet-500 dark:text-violet-400${pulse ? " animate-[about-sparkle_1.5s_ease-in-out_4]" : ""}`}
          />
          关于
        </span>
        <span className="text-[10px] font-medium tracking-wider text-violet-500/60 dark:text-violet-400/60">
          AI
        </span>
      </Link>
    );
  }

  return (
    <Link
      href="/about"
      className={`group relative inline-flex items-center gap-1 rounded-full border border-violet-200/50 bg-linear-to-r from-violet-50/80 to-indigo-50/80 px-2.5 py-0.5 text-sm text-zinc-600 transition-all duration-300 hover:border-violet-300/60 hover:from-violet-100 hover:to-indigo-100 hover:text-violet-700 hover:shadow-[0_0_12px_rgba(139,92,246,0.15)] dark:border-violet-500/20 dark:from-violet-500/10 dark:to-indigo-500/10 dark:text-zinc-300 dark:hover:border-violet-400/40 dark:hover:from-violet-500/20 dark:hover:to-indigo-500/20 dark:hover:text-violet-300 dark:hover:shadow-[0_0_12px_rgba(139,92,246,0.2)]${pulse ? " animate-[about-glow_2s_ease-in-out_3]" : ""}`}
    >
      <Sparkles
        className={`h-3 w-3 text-violet-500 transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110 dark:text-violet-400${pulse ? " animate-[about-sparkle_1.5s_ease-in-out_4]" : ""}`}
      />
      <span>关于</span>
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  // 文章页：单段路径且非首页/分页/分类
  const isArticlePage =
    pathname !== "/" &&
    !pathname.startsWith("/page/") &&
    !pathname.startsWith("/category/");

  // SSR 和客户端首次渲染都使用相同逻辑，避免 hydration mismatch
  // 滚动效果通过 CSS 和 data 属性实现
  const [scrolled, setScrolled] = useState(false);
  const [mobileHidden, setMobileHidden] = useState(false);

  useEffect(() => {
    const mobileMedia = window.matchMedia("(max-width: 767px)");

    const onScroll = () => {
      const currentY = window.scrollY;
      setScrolled(currentY > 10);

      // 移动端文章阅读模式：离开顶部后固定隐藏顶栏，回到顶部再显示
      if (!mobileMedia.matches || !isArticlePage) {
        setMobileHidden(false);
        return;
      }

      setMobileHidden(currentY > 20);
    };

    onScroll(); // 初始检查
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [isArticlePage]);

  // 基础样式（SSR 和客户端一致）
  const baseClasses = "fixed left-0 right-0 top-0 z-50 bg-[color:var(--vp-c-bg)]/95 backdrop-blur-sm transition-[border-color,box-shadow,transform] duration-300 ease-out dark:bg-[color:var(--vp-c-bg)]/90";
  // 文章页总是有边框
  const articleClasses = "border-b border-zinc-200/80 shadow-sm dark:border-zinc-800/80";
  // 非文章页默认无边框，滚动后通过 CSS 处理
  const homeClasses = "border-b border-transparent";
  const hiddenClasses =
    mobileHidden && isArticlePage
      ? "-translate-y-full pointer-events-none md:pointer-events-auto"
      : "translate-y-0";

  return (
    <header
      data-scrolled={scrolled}
      data-mobile-hidden={mobileHidden}
      className={`${baseClasses} ${isArticlePage ? articleClasses : homeClasses} ${hiddenClasses}`}
    >
      <div className="mx-auto flex h-[60px] w-full max-w-[1280px] items-center justify-between px-4 md:px-8">
        <Link
          href="/"
          className="home-nav-title flex items-center gap-2.5 whitespace-nowrap text-base font-semibold tracking-wide"
        >
          <Image
            src="/legacy/logo.png"
            alt="luolei logo"
            width={28}
            height={28}
            className="h-7 w-7"
          />
          <span>罗磊的独立博客</span>
        </Link>
        <nav className="flex items-center text-sm text-zinc-600 dark:text-zinc-300">
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
              <NavAboutLink />
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
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <IconX className="h-5 w-5" />
              </a>
              <a
                href={siteConfig.social.github}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub"
                title="GitHub"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
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
                <NavAboutLink mobile />
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
