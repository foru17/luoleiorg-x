"use client";

import Image from "next/image";
import { IconGitHub, IconLlms } from "@/components/icons";
import {
  countryCodeToEmoji,
  formatAnalyticsNumber,
  formatRelativeTime,
  getCountryName,
} from "@/lib/analytics/summary";
import { useAnalyticsSummary } from "@/hooks/use-analytics-summary";
import { siteConfig } from "@/lib/site-config";
const siteHostname = new URL(siteConfig.siteUrl).hostname.toUpperCase();

function CountryFlag({ countryCode }: { countryCode: string }) {
  const emoji = countryCodeToEmoji(countryCode);
  return (
    <span className="inline-block text-sm" title={getCountryName(countryCode.toUpperCase())}>
      {emoji}
    </span>
  );
}

function AnalyticsDisplay() {
  const { summary, showLoading } = useAnalyticsSummary();

  // 有缓存数据时直接显示，不再显示 loading
  if (!summary) {
    // 真正首次加载才显示 loading
    return showLoading ? (
      <div className="flex items-center gap-x-3 text-[13px] text-zinc-300 dark:text-zinc-600">
        <span className="inline-flex items-center gap-1">
          <svg className="h-3 w-3 animate-spin opacity-60" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span className="opacity-60">加载中...</span>
        </span>
      </div>
    ) : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-400 dark:text-zinc-500">
      <span className="inline-flex items-center gap-1.5">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        总浏览量: {formatAnalyticsNumber(summary.totalPageViews)}
      </span>
      <span className="hidden md:inline text-zinc-300 dark:text-zinc-700">·</span>
      {summary.recentVisitor && summary.recentVisitor.country ? (
        <span className="inline-flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          近期访客:
          <CountryFlag countryCode={summary.recentVisitor.country} />
          <span>{getCountryName(summary.recentVisitor.country)} {formatRelativeTime(summary.recentVisitor.lastAt)}</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          近期访客: 未知
        </span>
      )}
    </div>
  );
}


export function SiteFooter() {
  return (
    <footer className="site-footer mt-12 border-t border-zinc-200/80 py-6 dark:border-zinc-800/80">
      <div className="mx-auto w-full max-w-[1280px] px-4 md:px-8">
        {/* 第一行：技术栈 - 左右对齐 */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* 左边：技术栈信息 */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-400 dark:text-zinc-500">
            <a href="https://www.cloudflare.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-300">
              <Image
                src="/icons/cloudflare-icon.svg"
                alt="Cloudflare"
                width={14}
                height={14}
                className="inline-block h-3.5 w-3.5 opacity-60 grayscale transition-all duration-300 hover:opacity-100 hover:grayscale-0"
              />
              Cloudflare
            </a>
            <span className="hidden md:inline text-zinc-300 dark:text-zinc-700">·</span>
            <span>
              Powered by{" "}
              <a href="https://github.com/cloudflare/vinext" target="_blank" rel="noreferrer" className="hover:text-zinc-600 dark:hover:text-zinc-300">
                vinext
              </a>
            </span>
            <span className="hidden md:inline text-zinc-300 dark:text-zinc-700">·</span>
            <a
              href={`https://github.com/${siteConfig.contentRepo.owner}/${siteConfig.contentRepo.repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <IconGitHub className="inline-block h-3.5 w-3.5" />
              Open Source
            </a>
          </div>
          {/* 右边：版权 + ICP */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-400 dark:text-zinc-500">
            <span>
              &copy; {new Date().getFullYear()}{" "}
              <a href={siteConfig.siteUrl} className="hover:text-zinc-600 dark:hover:text-zinc-300">
                {siteHostname}
              </a>
            </span>
            <span className="hidden md:inline text-zinc-300 dark:text-zinc-700">·</span>
            <a href="http://beian.miit.gov.cn/" target="_blank" rel="noreferrer" className="hover:text-zinc-600 dark:hover:text-zinc-300">
              {siteConfig.beian}
            </a>
            <span className="hidden md:inline text-zinc-300 dark:text-zinc-700">·</span>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noreferrer"
              title="面向 AI 的站点元数据 (llms.txt)"
              className="inline-flex items-center gap-1 font-mono hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              <IconLlms className="inline-block h-3.5 w-3.5" />
              llms.txt
            </a>
          </div>
        </div>
        
        {/* 第二行：统计数据 */}
        <div className="mt-3">
          <AnalyticsDisplay />
        </div>
      </div>
    </footer>
  );
}
