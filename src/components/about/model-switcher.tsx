"use client";

import { useState } from "react";
import Image from "next/image";
import type { ModelEntry } from "@/lib/content/author-profile";
import { getFaviconUrlForSite } from "@/lib/favicon";

interface ModelSwitcherProps {
  models: ModelEntry[];
  activeModelId: string;
  onModelChange: (modelId: string) => void;
}

const MODEL_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  openai: {
    bg: "bg-zinc-100 dark:bg-zinc-800/40",
    border: "border-zinc-300 dark:border-zinc-700",
    text: "text-zinc-800 dark:text-zinc-200",
  },
  gemini: {
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-700 dark:text-blue-300",
  },
  qwen: {
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
    text: "text-violet-700 dark:text-violet-300",
  },
  kimi: {
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  minimax: {
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "border-indigo-200 dark:border-indigo-800",
    text: "text-indigo-700 dark:text-indigo-300",
  },
  deepseek: {
    bg: "bg-cyan-50 dark:bg-cyan-950/30",
    border: "border-cyan-200 dark:border-cyan-800",
    text: "text-cyan-700 dark:text-cyan-300",
  },
  doubao: {
    bg: "bg-sky-50 dark:bg-sky-950/30",
    border: "border-sky-200 dark:border-sky-800",
    text: "text-sky-700 dark:text-sky-300",
  },
  zhipu: {
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
  },
};

function getModelColors(icon: string) {
  return MODEL_COLORS[icon] ?? {
    bg: "bg-zinc-50 dark:bg-zinc-900/30",
    border: "border-zinc-200 dark:border-zinc-800",
    text: "text-zinc-700 dark:text-zinc-300",
  };
}

export function ModelSwitcher({
  models,
  activeModelId,
  onModelChange,
}: ModelSwitcherProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-zinc-200/80 bg-zinc-50/80 p-1 dark:border-zinc-800/80 dark:bg-zinc-900/40">
      {models.map((model) => {
        const isActive = model.id === activeModelId;
        const colors = getModelColors(model.icon);
        const faviconUrl = getFaviconUrlForSite(model.providerSite);

        return (
          <button
            key={model.id}
            type="button"
            onClick={() => onModelChange(model.id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-200 ${
              isActive
                ? `${colors.bg} ${colors.border} ${colors.text} border shadow-sm`
                : "border border-transparent text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-800/60"
            }`}
            aria-pressed={isActive}
          >
            <ProviderFavicon url={faviconUrl} />
            <span>{model.name}</span>
            {model.generatedBy === "ai" && (
              <span className="ml-0.5 text-[10px] opacity-60">AI</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Provider Favicon (uses the same API as article external links) ───

function ProviderFavicon({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return <FallbackIcon />;
  }

  return (
    <Image
      src={url}
      alt=""
      width={16}
      height={16}
      sizes="16px"
      className="h-4 w-4 shrink-0 rounded-sm object-contain"
      onError={() => setFailed(true)}
    />
  );
}

function FallbackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}
