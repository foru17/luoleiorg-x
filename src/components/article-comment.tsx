"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    Artalk?: {
      init: (config: Record<string, unknown>) => void;
    };
  }
}

interface ArticleCommentProps {
  slug: string;
  title: string;
}

export function ArticleComment({ slug, title }: ArticleCommentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const scriptId = "artalk-js";
    const styleId = "artalk-css";

    const init = () => {
      if (!window.Artalk || !containerRef.current) return;
      window.Artalk.init({
        el: containerRef.current,
        pageKey: `https://luolei.org/${slug}/`,
        pageTitle: title,
        server: "https://artalk.is26.com",
        site: "罗磊的独立博客",
        gravatar: {
          mirror: "https://cravatar.cn/avatar/",
        },
      });
    };

    if (!document.getElementById(styleId)) {
      const css = document.createElement("link");
      css.id = styleId;
      css.rel = "stylesheet";
      css.href = "https://cdn.jsdelivr.net/npm/artalk/dist/Artalk.css";
      document.head.appendChild(css);
    }

    const existed = document.getElementById(scriptId);
    if (existed) {
      init();
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "https://cdn.jsdelivr.net/npm/artalk/dist/Artalk.js";
    script.async = true;
    script.onload = () => init();
    document.body.appendChild(script);
  }, [slug, title]);

  return <div id="Comments" ref={containerRef} className="mt-6" />;
}
