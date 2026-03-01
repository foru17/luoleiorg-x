"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface TocHeading {
  id: string;
  text: string;
  level: number;
}

interface TocSection {
  heading: TocHeading;
  children: TocHeading[];
}

interface ArticleTocProps {
  headings: TocHeading[];
}

export function ArticleToc({ headings }: ArticleTocProps) {
  const tocHeadings = useMemo(
    () => headings.filter((h) => h.level === 2 || h.level === 3),
    [headings],
  );

  // 将扁平 heading 列表分组为 h2 → h3[] 树形结构
  const sections = useMemo(() => {
    const result: TocSection[] = [];
    for (const heading of tocHeadings) {
      if (heading.level === 2) {
        result.push({ heading, children: [] });
      } else if (heading.level === 3 && result.length > 0) {
        result[result.length - 1].children.push(heading);
      }
    }
    return result;
  }, [tocHeadings]);

  const [activeId, setActiveId] = useState(tocHeadings[0]?.id ?? "");
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const isClickScrolling = useRef(false);
  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 当前激活的 h2 section（用于展开/收起）
  const expandedSectionId = useMemo(() => {
    for (const section of sections) {
      if (section.heading.id === activeId) return section.heading.id;
      if (section.children.some((c) => c.id === activeId))
        return section.heading.id;
    }
    return sections[0]?.heading.id ?? "";
  }, [activeId, sections]);

  // 滚动检测
  useEffect(() => {
    if (!tocHeadings.length) return;

    const updateActiveHeading = () => {
      if (isClickScrolling.current) return;

      const offset = 110;
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
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, [tocHeadings]);

  // Marker 位置计算
  const updateMarker = useCallback(() => {
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

  useEffect(() => {
    updateMarker();
    // 展开/收起动画结束后重新计算 marker 位置
    const timer = setTimeout(updateMarker, 300);
    return () => clearTimeout(timer);
  }, [updateMarker, expandedSectionId]);

  const handleClick = (id: string) => {
    isClickScrolling.current = true;
    setActiveId(id);

    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
    }

    clickTimeoutRef.current = setTimeout(() => {
      isClickScrolling.current = false;
    }, 1000);
  };

  if (!sections.length) {
    return null;
  }

  return (
    <div className="hidden lg:block lg:w-[220px] lg:flex-shrink-0">
      <div className="toc-scroll fixed top-[110px] w-[220px] max-h-[calc(100vh-140px)] overflow-y-auto">
        <div className="article-toc">
          <span
            aria-hidden="true"
            ref={markerRef}
            className="article-toc-marker"
          />
          <p className="article-toc-title">本文导览</p>
          <ul className="space-y-1">
            {sections.map((section) => (
              <li key={section.heading.id}>
                <a
                  href={`#${section.heading.id}`}
                  data-toc-id={section.heading.id}
                  className={`article-toc-link ${
                    activeId === section.heading.id ? "is-active" : ""
                  }`}
                  onClick={() => handleClick(section.heading.id)}
                >
                  {section.heading.text}
                </a>
                {section.children.length > 0 && (
                  <div
                    className={`toc-children-wrapper ${
                      expandedSectionId === section.heading.id
                        ? "is-expanded"
                        : ""
                    }`}
                  >
                    <ul className="toc-children-inner">
                      {section.children.map((child) => (
                        <li key={child.id}>
                          <a
                            href={`#${child.id}`}
                            data-toc-id={child.id}
                            className={`article-toc-link toc-h3 ${
                              activeId === child.id ? "is-active" : ""
                            }`}
                            onClick={() => handleClick(child.id)}
                          >
                            {child.text}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
