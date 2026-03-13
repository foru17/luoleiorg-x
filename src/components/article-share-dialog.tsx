"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, Download, Image as ImageIcon, Share2, X } from "lucide-react";
import { useThemeMode } from "@/hooks/use-theme-mode";

interface ArticleShareDialogProps {
  slug: string;
  title: string;
  articleUrl: string;
}

type CopyState = "idle" | "copied" | "error";
type ShareImageState = "idle" | "loading" | "ready" | "error";

const SHARE_IMAGE_WIDTH = 1080;
const SHARE_IMAGE_HEIGHT = 1350;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = url;
  });
}

async function renderSvgToPngBlob(svgText: string): Promise<Blob> {
  const svgBlob = new Blob([svgText], {
    type: "image/svg+xml;charset=utf-8",
  });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement("canvas");
    canvas.width = SHARE_IMAGE_WIDTH;
    canvas.height = SHARE_IMAGE_HEIGHT;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas context unavailable");
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Failed to convert image"));
        }
      }, "image/png");
    });

    return pngBlob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function ArticleShareDialog({
  slug,
  articleUrl,
  title,
}: ArticleShareDialogProps) {
  const [open, setOpen] = useState(false);
  const [copyLinkState, setCopyLinkState] = useState<CopyState>("idle");
  const [copyImageState, setCopyImageState] = useState<CopyState>("idle");
  const [shareImageState, setShareImageState] = useState<ShareImageState>("idle");
  const [pngBlob, setPngBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const { isDark } = useThemeMode();
  const shareCardTheme = isDark ? "dark" : "light";

  const shareCardSourceUrl = useMemo(
    () => `/api/share/article/${slug}?theme=${shareCardTheme}`,
    [shareCardTheme, slug],
  );
  const activeSourceUrlRef = useRef(shareCardSourceUrl);

  useEffect(() => {
    activeSourceUrlRef.current = shareCardSourceUrl;
  }, [shareCardSourceUrl]);

  useEffect(() => {
    setPngBlob(null);
    setShareImageState("idle");
    setPreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
      }

      return null;
    });
  }, [shareCardSourceUrl]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const ensurePngImage = useCallback(async () => {
    if (pngBlob && previewUrl) {
      return { blob: pngBlob, url: previewUrl };
    }

    const requestSourceUrl = shareCardSourceUrl;
    setShareImageState("loading");

    try {
      const response = await fetch(requestSourceUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch share source");
      }

      const svgText = await response.text();
      const blob = await renderSvgToPngBlob(svgText);
      const nextPreviewUrl = URL.createObjectURL(blob);

      if (requestSourceUrl !== activeSourceUrlRef.current) {
        URL.revokeObjectURL(nextPreviewUrl);
        return null;
      }

      setPreviewUrl((currentPreviewUrl) => {
        if (currentPreviewUrl) {
          URL.revokeObjectURL(currentPreviewUrl);
        }
        return nextPreviewUrl;
      });
      setPngBlob(blob);
      setShareImageState("ready");

      return { blob, url: nextPreviewUrl };
    } catch {
      if (requestSourceUrl === activeSourceUrlRef.current) {
        setShareImageState("error");
      }
      return null;
    }
  }, [pngBlob, previewUrl, shareCardSourceUrl]);

  useEffect(() => {
    if (open && shareImageState === "idle") {
      void ensurePngImage();
    }
  }, [ensurePngImage, open, shareImageState]);

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(articleUrl);
      setCopyLinkState("copied");
      window.setTimeout(() => setCopyLinkState("idle"), 1800);
    } catch {
      setCopyLinkState("error");
      window.setTimeout(() => setCopyLinkState("idle"), 1800);
    }
  }

  async function handleCopyImage() {
    if (
      typeof ClipboardItem === "undefined" ||
      !navigator.clipboard ||
      typeof navigator.clipboard.write !== "function"
    ) {
      setCopyImageState("error");
      window.setTimeout(() => setCopyImageState("idle"), 1800);
      return;
    }

    try {
      const result = await ensurePngImage();
      if (!result) {
        throw new Error("PNG image unavailable");
      }

      await navigator.clipboard.write([
        new ClipboardItem({
          [result.blob.type]: result.blob,
        }),
      ]);
      setCopyImageState("copied");
      window.setTimeout(() => setCopyImageState("idle"), 1800);
    } catch {
      setCopyImageState("error");
      window.setTimeout(() => setCopyImageState("idle"), 1800);
    }
  }

  async function handleDownloadImage() {
    const result = await ensurePngImage();
    if (!result) return;

    const anchor = document.createElement("a");
    anchor.href = result.url;
    anchor.download = `${slug}-share-card.png`;
    anchor.click();
  }

  const isImageBusy = shareImageState === "loading";

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition-all hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
          aria-label="打开文章分享卡片"
        >
          <Share2 className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
          <span>分享</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
          <div className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Dialog.Title className="truncate text-lg font-semibold text-zinc-950 dark:text-white">
                  分享图片
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  直接复制 PNG 或下载后分享。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  aria-label="关闭分享弹窗"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="mt-4">
              <div className="mx-auto w-full max-w-[360px] sm:max-w-[400px]">
                <div className="overflow-hidden rounded-[26px] border border-zinc-200 bg-[radial-gradient(circle_at_top,#f8f7f3_0%,#ece8df_100%)] p-2.5 shadow-[0_18px_48px_rgba(15,23,42,0.16)] dark:border-zinc-800 dark:bg-[radial-gradient(circle_at_top,#1b2230_0%,#0b0f16_100%)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
                  <div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[20px] bg-transparent">
                    {previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={`${title} 分享卡片预览`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-3 px-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                        <ImageIcon className="h-6 w-6" />
                        <span>
                          {shareImageState === "error"
                            ? "分享图片生成失败"
                            : "正在生成 PNG 分享图..."}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-2 sm:mt-7 sm:grid-cols-3">
              <button
                type="button"
                onClick={handleCopyImage}
                disabled={isImageBusy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                <Copy className="h-4 w-4" />
                {isImageBusy
                  ? "生成图片中..."
                  : copyImageState === "copied"
                    ? "已复制图片"
                    : copyImageState === "error"
                      ? "复制失败"
                      : "复制分享图片"}
              </button>

              <button
                type="button"
                onClick={handleDownloadImage}
                disabled={isImageBusy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                <Download className="h-4 w-4" />
                下载 PNG
              </button>

              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                <Copy className="h-4 w-4" />
                {copyLinkState === "copied"
                  ? "已复制链接"
                  : copyLinkState === "error"
                    ? "复制失败"
                    : "复制文章链接"}
              </button>
            </div>

          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
