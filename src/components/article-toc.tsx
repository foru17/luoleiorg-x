"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface TocHeading {
  id: string;
  text: string;
  level: number;
}

interface ArticleTocProps {
  headings: TocHeading[];
}

export function ArticleToc({ headings }: ArticleTocProps) {
  const tocHeadings = useMemo(
    () =>
      headings.filter((heading) => heading.level === 2 || heading.level === 3),
    [headings],
  );
  const [activeId, setActiveId] = useState(tocHeadings[0]?.id ?? "");
  const markerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!tocHeadings.length) return;

    const updateActiveHeading = () => {
      const offset = 120;
      let currentId = tocHeadings[0]?.id ?? "";

      for (const heading of tocHeadings) {
        const element = document.getElementById(heading.id);
        if (!element) continue;
        if (element.getBoundingClientRect().top - offset <= 0) {
          currentId = heading.id;
        }
      }

      setActiveId(currentId);
    };

    updateActiveHeading();
    window.addEventListener("scroll", updateActiveHeading, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateActiveHeading);
    };
  }, [tocHeadings]);

  useEffect(() => {
    if (!tocHeadings.length) return;

    const markerHeight = 36;
    const current = activeId || tocHeadings[0]?.id;
    if (!current) return;

    const marker = markerRef.current;
    if (!marker) return;

    const el = document.querySelector<HTMLAnchorElement>(
      `a[data-toc-id="${current}"]`,
    );
    if (!el) return;

    const top = el.offsetTop + (el.offsetHeight - markerHeight) / 2;
    marker.style.transform = `translateY(${Math.max(0, top)}px)`;
  }, [activeId, tocHeadings]);

  if (!tocHeadings.length) {
    return null;
  }

  return (
    <aside className="hidden lg:block lg:self-stretch">
      <div className="article-toc-shell sticky top-[110px] max-h-[calc(100vh-120px)]">
        <div className="article-toc h-full overflow-y-auto">
          <span
            aria-hidden="true"
            ref={markerRef}
            className="article-toc-marker"
          />
          <p className="article-toc-title">本文导览</p>
          <ul className="space-y-1">
            {tocHeadings.map((heading) => (
              <li key={heading.id}>
                <a
                  href={`#${heading.id}`}
                  data-toc-id={heading.id}
                  className={`article-toc-link ${
                    heading.level === 3 ? "pl-3" : ""
                  } ${activeId === heading.id ? "is-active" : ""}`}
                  onClick={() => setActiveId(heading.id)}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
