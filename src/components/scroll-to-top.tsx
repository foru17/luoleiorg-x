"use client";

import { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      aria-label="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`fixed bottom-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-white/74 text-zinc-700 shadow-[0_10px_24px_-14px_rgba(15,23,42,0.5),0_8px_18px_-14px_rgba(15,23,42,0.28)] ring-1 ring-black/6 backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/86 hover:shadow-[0_14px_30px_-16px_rgba(15,23,42,0.55),0_10px_20px_-16px_rgba(15,23,42,0.32)] hover:text-zinc-900 sm:bottom-6 sm:right-6 dark:bg-zinc-900/76 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-zinc-900/88 dark:hover:text-zinc-100 ${
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0"
      }`}
    >
      <ChevronUp className="h-[18px] w-[18px]" />
    </button>
  );
}
