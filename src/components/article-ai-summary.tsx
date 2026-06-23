"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { ArticleShareDialog } from "@/components/article-share-dialog";

interface ArticleAISummaryProps {
  summary: {
    summary: string;
    abstract: string;
    tags: string[];
  };
  share: {
    slug: string;
    title: string;
    articleUrl: string;
  };
}

// 每秒揭示的字符数：贴近 AI 对话的打字机节奏，又不至于太慢。
const CHARS_PER_SECOND = 55;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  const mql = window.matchMedia(REDUCED_MOTION_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/**
 * 打字机正文。关键点：未揭示的文字以 `text-transparent` 的形式始终留在文档流中，
 * 因此整段文字的高度从一开始就被占满 —— 揭示过程只改变颜色/不透明度，
 * 不会逐字触发回流，从而避免下方正文反复抖动重绘。
 */
function TypewriterText({
  text,
  done,
  visibleCount,
}: {
  text: string;
  done: boolean;
  visibleCount: number;
}) {
  const revealed = text.slice(0, visibleCount);
  const remaining = text.slice(visibleCount);

  return (
    <p className="whitespace-pre-wrap text-base leading-[1.9] text-zinc-600 dark:text-zinc-400">
      <span>{revealed}</span>
      {!done && (
        // 零宽度容器：外层 w-0 不占据排版空间，内层流动波浪线 overflow 可见，
        // 动效叠加在「即将出现的透明文字」之上，不改变换行、杜绝微抖动。
        <span aria-hidden className="inline-block w-0 overflow-visible align-baseline">
          <svg
            className="ml-3 inline-block translate-y-[-0.12em] text-zinc-300 dark:text-zinc-600"
            width="46"
            height="10"
            viewBox="0 0 46 10"
            fill="none"
          >
            <g style={{ animation: "summary-wave 1.4s linear infinite" }}>
              <path
                d="M0 5 Q5.75 2 11.5 5 T23 5 T34.5 5 T46 5 T57.5 5 T69 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </g>
          </svg>
        </span>
      )}
      <span aria-hidden className="text-transparent">
        {remaining}
      </span>
    </p>
  );
}

export function ArticleAISummary({ summary, share }: ArticleAISummaryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [visibleCount, setVisibleCount] = useState(0);
  const prefersReducedMotion = usePrefersReducedMotion();

  const abstract = summary.abstract;
  const rafRef = useRef<number | null>(null);

  // 减少动效偏好下直接揭示全文，否则跟随逐字状态。
  const effectiveCount = prefersReducedMotion ? abstract.length : visibleCount;
  const typingDone = effectiveCount >= abstract.length;

  // 首次展开时驱动打字机；之后再开合直接保持已揭示状态，不再重放。
  useEffect(() => {
    if (!isOpen || !hasOpened || prefersReducedMotion) return;
    if (visibleCount >= abstract.length) return;

    let start: number | null = null;
    const from = visibleCount;

    const tick = (ts: number) => {
      if (start === null) start = ts;
      const elapsed = (ts - start) / 1000;
      const next = Math.min(
        abstract.length,
        from + Math.floor(elapsed * CHARS_PER_SECOND),
      );
      setVisibleCount(next);
      if (next < abstract.length) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hasOpened, prefersReducedMotion]);

  const handleToggle = () => {
    if (!hasOpened) setHasOpened(true);
    setIsOpen((prev) => !prev);
  };

  return (
    <div className="my-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={isOpen}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition-all hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
        >
          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          <span>AI 摘要</span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
        <ArticleShareDialog
          slug={share.slug}
          title={share.title}
          articleUrl={share.articleUrl}
        />
      </div>

      {/* 用 grid-rows 0fr→1fr 做平滑高度过渡；内层一次性占满最终高度，
          配合上面的透明占位文字，整体只在展开瞬间产生一次高度变化。 */}
      <div
        className={`grid transition-all duration-300 ease-out motion-reduce:transition-none ${
          isOpen
            ? "mt-3 grid-rows-[1fr] opacity-100"
            : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {hasOpened && (
            <div className="rounded-lg border border-zinc-200 bg-white/80 px-6 py-5 backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-800/60">
              <TypewriterText
                text={abstract}
                done={typingDone}
                visibleCount={effectiveCount}
              />

              {summary.tags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-700/60">
                  {summary.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-block rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 dark:bg-zinc-700/60 dark:text-zinc-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
