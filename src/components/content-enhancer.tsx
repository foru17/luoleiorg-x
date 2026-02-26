"use client";

import { useEffect } from "react";
import mediumZoom from "medium-zoom";
import { createRoot, type Root } from "react-dom/client";
import { TweetCard } from "./tweet-card";

function getFaviconUrl(domain: string) {
  return `https://img.is26.com/https://static.is26.com/favicon/${domain}/w=32`;
}

// 渲染 TweetCard 到占位符
function hydrateTweetCards(roots: Root[]) {
  const placeholders = document.querySelectorAll(".tweet-card-placeholder");

  placeholders.forEach((placeholder) => {
    const tweetId = placeholder.getAttribute("data-tweet-id");
    if (!tweetId) return;

    // 检查是否已经 hydrate
    if (placeholder.hasAttribute("data-hydrated")) return;

    // 创建 React root 并渲染 TweetCard
    const root = createRoot(placeholder);
    roots.push(root);
    root.render(<TweetCard tweetId={tweetId} />);

    placeholder.setAttribute("data-hydrated", "true");
  });
}

export function ContentEnhancer() {
  useEffect(() => {
    const roots: Root[] = [];

    const zoom = mediumZoom(".article-body img", {
      background: "var(--vp-c-bg)",
      margin: 24,
    });

    // 处理文章内链接
    const links =
      document.querySelectorAll<HTMLAnchorElement>(".article-body a");
    
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (
        !href ||
        !href.startsWith("http") ||
        link.querySelector("img.favicon")
      ) {
        return;
      }

      const domain = href.split("/")[2];
      if (!domain) return;

      // 创建 favicon 容器
      const faviconWrapper = document.createElement("span");
      faviconWrapper.className = "favicon-wrapper";
      
      link.classList.add("pending-favicon");
      
      const img = document.createElement("img");
      img.className = "favicon";
      img.src = getFaviconUrl(domain);
      img.alt = "";
      img.loading = "lazy";

      img.onload = () => {
        link.classList.remove("pending-favicon");
        link.classList.add("has-favicon");
      };

      img.onerror = () => {
        link.classList.remove("pending-favicon");
        link.classList.add("err-favicon");
        // 失败后移除 favicon
        faviconWrapper.remove();
      };

      faviconWrapper.appendChild(img);
      link.prepend(faviconWrapper);
    });

    // Hydrate TweetCards
    hydrateTweetCards(roots);

    return () => {
      zoom.detach();
      for (const root of roots) {
        root.unmount();
      }
    };
  }, []);

  return null;
}
