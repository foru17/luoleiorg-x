"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import {
  ROUTE_TRANSITION_COMPLETE_EVENT,
  ROUTE_TRANSITION_START_EVENT,
  dispatchRouteTransitionStart,
} from "@/lib/route-transition";
import { cn } from "@/lib/utils";

const SHOW_DELAY_MS = 80;
const HIDE_DELAY_MS = 220;
const FAILSAFE_TIMEOUT_MS = 12000;

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey;
}

function getCurrentHref(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getTrackedHref(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.dataset.noRouteProgress === "true") return null;

  const nextUrl = new URL(anchor.href, window.location.href);
  if (nextUrl.origin !== window.location.origin) return null;
  if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") return null;

  const nextHref = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  if (nextHref === getCurrentHref()) return null;

  return nextHref;
}

export function RouteTransitionProgress() {
  const [visible, setVisible] = useState(false);
  const [settling, setSettling] = useState(false);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const failsafeTimerRef = useRef<number | null>(null);
  const activeHrefRef = useRef<string | null>(null);

  const clearTimer = useCallback((timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearAllTimers = useEffectEvent(() => {
    clearTimer(showTimerRef);
    clearTimer(hideTimerRef);
    clearTimer(failsafeTimerRef);
  });

  const finishProgress = useEffectEvent(() => {
    activeHrefRef.current = null;
    clearTimer(showTimerRef);
    clearTimer(failsafeTimerRef);

    if (!visible) {
      setSettling(false);
      setVisible(false);
      return;
    }

    setSettling(true);
    clearTimer(hideTimerRef);
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      setSettling(false);
      hideTimerRef.current = null;
    }, HIDE_DELAY_MS);
  });

  const startProgress = useEffectEvent((href?: string | null) => {
    if (href) {
      activeHrefRef.current = href;
    }

    clearAllTimers();
    setSettling(false);

    showTimerRef.current = window.setTimeout(() => {
      setVisible(true);
      showTimerRef.current = null;
    }, SHOW_DELAY_MS);

    failsafeTimerRef.current = window.setTimeout(() => {
      finishProgress();
    }, FAILSAFE_TIMEOUT_MS);
  });

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!isPlainLeftClick(event)) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const href = getTrackedHref(anchor);
      if (!href) return;

      dispatchRouteTransitionStart({ href });
    };

    const handlePopState = () => {
      dispatchRouteTransitionStart({ href: getCurrentHref() });
    };

    const handleStart = (event: Event) => {
      const detail = (event as CustomEvent<{ href?: string }>).detail;
      startProgress(detail?.href ?? null);
    };

    const handleComplete = () => {
      finishProgress();
    };

    window.addEventListener("click", handleClick, true);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener(ROUTE_TRANSITION_START_EVENT, handleStart as EventListener);
    window.addEventListener(ROUTE_TRANSITION_COMPLETE_EVENT, handleComplete);

    return () => {
      window.removeEventListener("click", handleClick, true);
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener(ROUTE_TRANSITION_START_EVENT, handleStart as EventListener);
      window.removeEventListener(ROUTE_TRANSITION_COMPLETE_EVENT, handleComplete);
      clearAllTimers();
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[70] h-[3px] transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="h-full w-full overflow-hidden">
        <div
          className={cn(
            "h-full w-[42%] rounded-r-full bg-[linear-gradient(90deg,#ea580c_0%,#f97316_45%,#fb7185_100%)] shadow-[0_0_18px_rgba(249,115,22,0.35)] will-change-transform",
            settling
              ? "w-full opacity-0 transition-[width,opacity] duration-200 ease-out"
              : "animate-[route-progress_1.15s_cubic-bezier(0.22,1,0.36,1)_infinite]",
          )}
        />
      </div>
    </div>
  );
}
