"use client";

import { useEffect } from "react";
import type { ArticleChatContext } from "@/lib/ai/chat-context";
import { hasArticleChatAutoOpened, isArticleChatDismissed, markArticleChatAutoOpened } from "@/lib/ai/article-chat-state";
import { useAIChat } from "./ai-chat-provider";

const DESKTOP_AUTO_OPEN_MEDIA = "(min-width: 1280px)";
const MIN_SCROLL_PROGRESS = 0.12;

function getScrollProgress(): number {
  const documentElement = document.documentElement;
  const scrollTop = window.scrollY || documentElement.scrollTop || 0;
  const scrollableHeight = documentElement.scrollHeight - window.innerHeight;
  if (scrollableHeight <= 0) return 0;
  return scrollTop / scrollableHeight;
}

interface ArticleChatBootstrapProps {
  guide: ArticleChatContext;
}

export function ArticleChatBootstrap({ guide }: ArticleChatBootstrapProps) {
  const {
    open,
    setOpen,
    setEntryContext,
    resetEntryContext,
    hasUserInteracted,
  } = useAIChat();

  useEffect(() => {
    setEntryContext({ scope: "article", article: guide });
  }, [guide, setEntryContext]);

  useEffect(() => {
    return () => {
      setOpen(false);
      resetEntryContext();
    };
  }, [resetEntryContext, setOpen]);

  useEffect(() => {
    if (!guide.autoOpenEnabled) return;
    if (!guide.slug) return;
    if (open || hasUserInteracted) return;
    if (isArticleChatDismissed(guide.slug) || hasArticleChatAutoOpened(guide.slug)) return;

    const mediaQuery = window.matchMedia(DESKTOP_AUTO_OPEN_MEDIA);
    if (!mediaQuery.matches) return;

    let disposed = false;
    let delayReady = false;
    let progressReady = getScrollProgress() >= MIN_SCROLL_PROGRESS;

    const tryOpen = () => {
      if (disposed || open || hasUserInteracted) return;
      if (!delayReady || !progressReady) return;

      markArticleChatAutoOpened(guide.slug);
      setOpen(true);
      disposed = true;
      window.removeEventListener("scroll", handleScroll);
    };

    const handleScroll = () => {
      progressReady = getScrollProgress() >= MIN_SCROLL_PROGRESS;
      tryOpen();
    };

    const timerId = window.setTimeout(() => {
      delayReady = true;
      tryOpen();
    }, guide.autoOpenDelayMs ?? 7000);

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [guide.autoOpenDelayMs, guide.autoOpenEnabled, guide.slug, hasUserInteracted, open, setOpen]);

  return null;
}
