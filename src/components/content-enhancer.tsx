"use client";

import { useEffect } from "react";
import mediumZoom from "medium-zoom";

function getFaviconUrl(domain: string) {
  return `https://img.is26.com/https://static.is26.com/favicon/${domain}/w=32`;
}

export function ContentEnhancer() {
  useEffect(() => {
    const zoom = mediumZoom(".article-body img", {
      background: "var(--vp-c-bg)",
      margin: 24,
    });

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

      link.classList.add("pending-favicon");
      const img = document.createElement("img");
      img.className = "favicon";
      img.src = getFaviconUrl(domain);
      img.alt = "";

      img.onload = () => {
        link.classList.remove("pending-favicon");
        link.classList.add("has-favicon");
      };

      img.onerror = () => {
        link.classList.remove("pending-favicon");
        link.classList.add("err-favicon");
      };

      link.prepend(img);
    });

    return () => {
      zoom.detach();
    };
  }, []);

  return null;
}
