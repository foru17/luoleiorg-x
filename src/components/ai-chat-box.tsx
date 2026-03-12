"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import {
  Sparkles,
  Send,
  RotateCcw,
  Loader2,
  Minimize2,
  ChevronDown,
} from "lucide-react";
import { dismissArticleChat } from "@/lib/ai/article-chat-state";
import {
  getChatEntryContextKey,
  isArticleChatEntryContext,
  toChatRequestContext,
  type ChatEntryContext,
} from "@/lib/ai/chat-context";
import { isChatStatusData, type ChatStatusData } from "@/lib/ai/chat-status";
import { MAX_TWEET_CARDS_PER_MESSAGE, MIN_SEND_INTERVAL_MS } from "@/lib/constants";
import { IconX } from "@/components/icons";
import { siteConfig } from "@/lib/site-config";
import { useAIChat } from "./ai-chat-provider";
import { renderInlineMarkdown } from "./chat/chat-markdown";
import { ChatTweetCard } from "./chat/chat-tweet";

const PLACEHOLDERS = siteConfig.ai.placeholders;
const MOBILE_LAUNCHER_MEDIA_QUERY = "(max-width: 639px)";
const MOBILE_LAUNCHER_MIN_PROGRESS = 0.08;
const MOBILE_LAUNCHER_DELAY_MS = 1200;

function getPageScrollProgress(): number {
  const documentElement = document.documentElement;
  const scrollTop = window.scrollY || documentElement.scrollTop || 0;
  const scrollableHeight = documentElement.scrollHeight - window.innerHeight;
  if (scrollableHeight <= 0) return 0;
  return scrollTop / scrollableHeight;
}

function buildWelcomeMessage(entryContext: ChatEntryContext): UIMessage {
  if (!isArticleChatEntryContext(entryContext)) {
    return {
      id: "welcome",
      role: "assistant",
      parts: [{ type: "text", text: siteConfig.ai.welcomeText }],
    };
  }

  const article = entryContext.article;
  return {
    id: "welcome",
    role: "assistant",
    parts: [
      {
        type: "text",
        text: `我在结合《${article.title}》陪你阅读。\n你可以让我总结这篇文章、解释某个观点，或者顺着这篇文章继续延伸到相关主题。`,
      },
    ],
  };
}

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getTextFromMessage(message: UIMessage): string {
  return message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function AuthorAvatar({
  size = 28,
  badgeTone = "accent",
  badgeVariant = "label",
  compactBadge = false,
}: {
  size?: number;
  badgeTone?: "accent" | "neutral";
  badgeVariant?: "label" | "dot" | "none";
  compactBadge?: boolean;
}) {
  const isCompact = size <= 32;
  const badgeClassName = badgeVariant === "dot"
    ? badgeTone === "neutral"
      ? "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-zinc-900 shadow-[0_0_0_2px_rgba(255,255,255,0.95)] dark:bg-zinc-100 dark:shadow-[0_0_0_2px_rgba(24,24,27,0.95)]"
      : "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-violet-500 shadow-[0_0_0_2px_rgba(255,255,255,0.95)] dark:shadow-[0_0_0_2px_rgba(24,24,27,0.95)]"
    : compactBadge
      ? badgeTone === "neutral"
        ? "absolute -right-0.5 -top-0.5 flex h-3 min-w-4 items-center justify-center rounded-full bg-zinc-900/92 px-1 text-[6px] font-semibold leading-none text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-900"
        : "absolute -right-0.5 -top-0.5 flex h-3 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 text-[6px] font-semibold leading-none text-white shadow-sm"
    : badgeTone === "neutral"
      ? isCompact
        ? "absolute -right-0.5 -top-0.5 flex h-3 min-w-3 items-center justify-center rounded-full bg-zinc-900/92 px-0.5 text-[6px] font-semibold leading-none text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-900"
        : "absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-zinc-900/92 px-1 text-[7px] font-semibold leading-none text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-900"
      : "absolute -right-1 -top-1 flex h-3.5 items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold leading-none text-white";

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <Image
        src="/images/avatar.jpg"
        alt={siteConfig.author.name}
        width={size}
        height={size}
        className="rounded-full object-cover"
      />
      {badgeVariant === "none" ? null : (
        <span className={badgeClassName}>
          {badgeVariant === "label" ? "AI" : null}
        </span>
      )}
    </div>
  );
}

function MessageContent({ message }: { message: UIMessage }) {
  const text = getTextFromMessage(message);
  const [showTweetCards, setShowTweetCards] = useState(false);
  if (!text) return null;

  const paragraphs = text.split("\n").filter((line) => line.trim());
  const parsedParagraphs = paragraphs.map((paragraph) => renderInlineMarkdown(paragraph));

  const tweetCards: string[] = [];
  if (message.role === "assistant") {
    const seenTweetIds = new Set<string>();
    for (const parsed of parsedParagraphs) {
      for (const tweetId of parsed.tweetIds) {
        if (tweetCards.length >= MAX_TWEET_CARDS_PER_MESSAGE) break;
        if (seenTweetIds.has(tweetId)) continue;
        seenTweetIds.add(tweetId);
        tweetCards.push(tweetId);
      }
      if (tweetCards.length >= MAX_TWEET_CARDS_PER_MESSAGE) break;
    }
  }

  return (
    <div className="space-y-2 text-[14px] leading-relaxed">
      {parsedParagraphs.map((parsed, index) => (
        <p key={index}>{parsed.nodes}</p>
      ))}
      {tweetCards.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowTweetCards((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[12px] text-zinc-600 transition-colors hover:border-zinc-300 hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
          >
            <IconX className="h-3.5 w-3.5" />
            <span>X 引用（{tweetCards.length}）</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showTweetCards ? "rotate-180" : ""}`}
            />
          </button>

          {showTweetCards && (
            <div className="mt-2 space-y-2">
              {tweetCards.map((tweetId) => (
                <ChatTweetCard key={tweetId} tweetId={tweetId} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TypingIndicator({ statusMessage }: { statusMessage?: string }) {
  return (
    <div className="flex items-start gap-3">
      <AuthorAvatar size={28} />
      <div className="flex items-center gap-1.5 pt-2">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
        {statusMessage && (
          <span className="ml-1 text-[12px] text-zinc-400 dark:text-zinc-500">
            {statusMessage}
          </span>
        )}
      </div>
    </div>
  );
}

function useEntranceTransition(): boolean {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    let frameId = 0;
    let nestedFrameId = 0;

    frameId = window.requestAnimationFrame(() => {
      nestedFrameId = window.requestAnimationFrame(() => {
        setEntered(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.cancelAnimationFrame(nestedFrameId);
    };
  }, []);

  return entered;
}

function ArticleStarterCards({
  entryContext,
  dismissedQuestions,
  onSelectQuestion,
  disabled = false,
  animateIn,
}: {
  entryContext: Extract<ChatEntryContext, { scope: "article" }>;
  dismissedQuestions: string[];
  onSelectQuestion: (question: string) => void;
  disabled?: boolean;
  animateIn: boolean;
}) {
  const article = entryContext.article;
  const questions = (article.focusQuestions?.slice(0, 3) ?? []).filter(
    (question) => !dismissedQuestions.includes(question),
  );

  if (questions.length === 0) return null;

  return (
    <div
      className={`rounded-2xl border border-zinc-200 bg-zinc-50/80 p-3 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none dark:border-zinc-800 dark:bg-zinc-800/50 ${
        animateIn ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
      }`}
    >
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        {article.title}
      </p>
      {article.summary && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          {article.summary}
        </p>
      )}
      {questions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {questions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => onSelectQuestion(question)}
              disabled={disabled}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-left text-[12px] leading-relaxed text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
            >
              {question}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleChatLauncher({
  articleTitle,
  openingLine,
  onOpen,
  compact = false,
}: {
  articleTitle: string;
  openingLine?: string;
  onOpen: () => void;
  compact?: boolean;
}) {
  const entered = useEntranceTransition();

  if (compact) {
    return createPortal(
      <div
        className={`fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-99 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-4 scale-[0.92] opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={`和《${articleTitle}》边读边聊`}
          className="group flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-white/74 text-zinc-700 shadow-[0_10px_24px_-14px_rgba(15,23,42,0.5),0_8px_18px_-14px_rgba(15,23,42,0.28)] ring-1 ring-black/6 backdrop-blur-xl transition-[transform,box-shadow,background-color] duration-220 ease-out hover:-translate-y-0.5 hover:bg-white/86 hover:shadow-[0_14px_30px_-16px_rgba(15,23,42,0.55),0_10px_20px_-16px_rgba(15,23,42,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 motion-reduce:transition-none dark:bg-zinc-900/76 dark:text-zinc-300 dark:ring-white/10 dark:hover:bg-zinc-900/88"
        >
          <AuthorAvatar size={33} badgeTone="neutral" compactBadge />
        </button>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className={`fixed bottom-4 left-3 right-3 z-99 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:left-auto sm:right-4 sm:w-[320px] ${
        entered ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="group flex w-full items-start gap-3 rounded-2xl border border-zinc-200 bg-white/95 px-3.5 py-3 text-left shadow-xl backdrop-blur transition-[box-shadow,border-color] duration-220 ease-out hover:border-zinc-300 hover:shadow-2xl motion-reduce:transition-none dark:border-zinc-700 dark:bg-zinc-900/95 dark:hover:border-zinc-600"
      >
        <AuthorAvatar size={34} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] uppercase tracking-[0.16em] text-zinc-400 dark:text-zinc-500">
            边读边聊
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {articleTitle}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {openingLine || "我可以结合这篇文章继续展开讲。"}
          </p>
        </div>
        <Sparkles className="mt-1 h-4 w-4 shrink-0 text-zinc-300 transition-colors group-hover:text-violet-400 dark:text-zinc-600 dark:group-hover:text-violet-400" />
      </button>
    </div>,
    document.body,
  );
}

function parseErrorInfo(error: Error | undefined): {
  message: string;
  detail?: string;
  isRateLimit: boolean;
} | null {
  if (!error) return null;
  const msg = error.message ?? "";

  if (msg.includes("请求太频繁") || msg.includes("请求次数过多") || msg.includes("今日对话次数")) {
    return { message: msg, isRateLimit: true };
  }
  if (msg.includes("429") || msg.includes("rate")) {
    return { message: "请求太频繁，请稍后再试", isRateLimit: true };
  }

  try {
    const parsed = JSON.parse(msg);
    if (parsed.error) {
      return {
        message: parsed.error,
        detail: parsed.detail,
        isRateLimit: false,
      };
    }
  } catch {
    // ignore JSON parse failure
  }

  if (msg.includes("认证") || msg.includes("401") || msg.includes("403")) {
    return { message: "AI 服务认证出了问题，博主正在处理中", isRateLimit: false };
  }
  if (msg.includes("超时") || msg.includes("timeout")) {
    return { message: "AI 思考太久了，请稍后再试一次", isRateLimit: false };
  }
  if (msg.includes("不可用") || msg.includes("503")) {
    return { message: "AI 服务暂时不在线，请稍后再来", isRateLimit: false };
  }

  return {
    message: "抱歉，我这边出了点状况，请稍后再试",
    detail: msg.length > 0 && msg.length < 200 ? msg : undefined,
    isRateLimit: false,
  };
}

function ChatPanel({
  open,
  onClose,
  messages,
  visibleMessages,
  sendMessage,
  status,
  error,
  errorInfo,
  onClear,
  latestStatusData,
  entryContext,
  dismissedStarterQuestions,
  onSelectStarterQuestion,
  isSending,
}: {
  open: boolean;
  onClose: () => void;
  messages: UIMessage[];
  visibleMessages: UIMessage[];
  sendMessage: (params: { text: string }) => void;
  status: string;
  error: Error | undefined;
  errorInfo: ReturnType<typeof parseErrorInfo>;
  onClear: () => void;
  latestStatusData?: ChatStatusData;
  entryContext: ChatEntryContext;
  dismissedStarterQuestions: string[];
  onSelectStarterQuestion: (question: string) => void;
  isSending: boolean;
}) {
  const [input, setInput] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1024px)").matches
      : false,
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastSendRef = useRef(0);
  const hasEntered = useEntranceTransition();

  const articleContext = isArticleChatEntryContext(entryContext) ? entryContext : null;
  const isDockedDesktop = Boolean(articleContext) && isDesktopViewport;
  const isLoading = status === "submitted" || status === "streaming";
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const hasPendingAssistantPlaceholder =
    status === "streaming" &&
    lastVisibleMessage?.role === "assistant" &&
    getTextFromMessage(lastVisibleMessage).trim().length === 0;
  const shouldShowTypingIndicator = status === "submitted" || hasPendingAssistantPlaceholder;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event: MediaQueryListEvent) => setIsDesktopViewport(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) {
      const timerId = window.setTimeout(() => inputRef.current?.focus(), 100);
      return () => window.clearTimeout(timerId);
    }
  }, [open]);

  useEffect(() => {
    if (!open || isDockedDesktop) return;

    const scrollY = window.scrollY;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.inset = "0";
    document.body.style.overflowY = "scroll";

    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.inset = "";
      document.body.style.overflowY = "";
      window.scrollTo(0, scrollY);
    };
  }, [isDockedDesktop, open]);

  useEffect(() => {
    if (!open || isDockedDesktop) return;
    const vv = window.visualViewport;
    const panelElement = panelRef.current;
    if (!vv) return;

    const update = () => {
      if (!panelElement || window.innerWidth >= 640) {
        panelElement?.style.removeProperty("height");
        panelElement?.style.removeProperty("transform");
        return;
      }
      panelElement.style.height = `${vv.height}px`;
      panelElement.style.transform = `translateY(${vv.offsetTop}px)`;
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      panelElement?.style.removeProperty("height");
      panelElement?.style.removeProperty("transform");
    };
  }, [isDockedDesktop, open]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading || cooldown) return;

    const now = Date.now();
    if (now - lastSendRef.current < MIN_SEND_INTERVAL_MS) {
      setCooldown(true);
      window.setTimeout(
        () => setCooldown(false),
        MIN_SEND_INTERVAL_MS - (now - lastSendRef.current),
      );
      return;
    }

    lastSendRef.current = now;
    setCooldown(true);
    window.setTimeout(() => setCooldown(false), MIN_SEND_INTERVAL_MS);

    setInput("");
    sendMessage({ text });
  }, [cooldown, input, isLoading, sendMessage]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (!open) return null;

  const panelBaseClassName = isDockedDesktop
    ? "fixed bottom-4 right-4 z-101 flex h-[min(72vh,760px)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white will-change-transform dark:border-zinc-700 dark:bg-zinc-900"
    : "fixed top-0 left-0 z-101 flex h-full w-screen flex-col overflow-hidden bg-white will-change-transform sm:bottom-auto sm:left-1/2 sm:top-[12%] sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-zinc-200 dark:bg-zinc-900 sm:dark:border-zinc-700";
  const panelAnimationClassName = isDockedDesktop
    ? hasEntered
      ? "translate-y-0 scale-100 opacity-100 shadow-2xl"
      : "translate-y-5 scale-[0.96] opacity-0 shadow-lg"
    : hasEntered
      ? "translate-y-0 scale-100 opacity-100 sm:translate-y-0 sm:scale-100 sm:shadow-2xl"
      : "translate-y-6 scale-[0.985] opacity-0 sm:translate-y-3 sm:scale-[0.985] sm:shadow-xl";
  const panelClassName = `${panelBaseClassName} ${panelAnimationClassName} origin-bottom-right transition-[opacity,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${isDockedDesktop ? "" : "sm:origin-center"}`;
  const contentMaxWidthClass = isDockedDesktop ? "max-w-none" : "max-w-xl";
  const panelTitle = articleContext ? "边读边聊" : siteConfig.author.name;
  const panelSubtitle = articleContext
    ? "围绕当前文章继续追问、拆解和延伸"
    : `${siteConfig.ai.chatTitle} · ${siteConfig.ai.chatSubtitle}`;

  return createPortal(
    <>
      {!isDockedDesktop && (
        <div
          className={`fixed inset-0 z-100 bg-black/30 backdrop-blur-[2px] transition-opacity duration-250 ease-out motion-reduce:transition-none ${
            hasEntered ? "opacity-100" : "opacity-0"
          }`}
          onClick={onClose}
          style={{ touchAction: "none" }}
        />
      )}
      <div ref={panelRef} data-ai-chat-panel className={panelClassName}>
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
              <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {panelTitle}
              </p>
              <p className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">
                {panelSubtitle}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onClear}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              title="清除对话"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              title="最小化"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:thin] [scrollbar-color:rgb(161_161_170)_transparent] dark:[scrollbar-color:rgb(82_82_91)_transparent]"
          style={{ scrollbarGutter: "stable" }}
        >
          <div className={`mx-auto space-y-5 ${contentMaxWidthClass}`}>
            {articleContext && (
              <ArticleStarterCards
                entryContext={articleContext}
                dismissedQuestions={dismissedStarterQuestions}
                onSelectQuestion={onSelectStarterQuestion}
                disabled={isSending}
                animateIn={hasEntered}
              />
            )}

            {visibleMessages.map((message) =>
              message.role === "assistant" && getTextFromMessage(message).trim().length === 0 ? null :
              message.role === "assistant" ? (
                <div key={message.id} className="flex items-start gap-3">
                  <AuthorAvatar size={28} />
                  <div className="min-w-0 flex-1 pt-0.5 text-zinc-700 dark:text-zinc-300">
                    <MessageContent message={message} />
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[84%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[14px] leading-relaxed text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                    <MessageContent message={message} />
                  </div>
                </div>
              ),
            )}

            {shouldShowTypingIndicator && <TypingIndicator statusMessage={latestStatusData?.message} />}

            {error && errorInfo && (
              <div className="flex items-start gap-3">
                <AuthorAvatar size={28} />
                <div className="pt-0.5">
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    {errorInfo.message}
                  </p>
                  {errorInfo.isRateLimit && (
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                      为了保证服务质量，每位用户有一定的对话频率限制
                    </p>
                  )}
                  {errorInfo.detail && !errorInfo.isRateLimit && (
                    <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                      错误详情：{errorInfo.detail}
                    </p>
                  )}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-zinc-100 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-3 dark:border-zinc-800">
          <div className={`mx-auto flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 transition-colors focus-within:border-zinc-300 focus-within:bg-white dark:border-zinc-700 dark:bg-zinc-800/50 dark:focus-within:border-zinc-600 dark:focus-within:bg-zinc-800 ${contentMaxWidthClass}`}>
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              enterKeyHint="send"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={articleContext ? "继续追问这篇文章..." : "输入消息..."}
              maxLength={500}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[16px] text-zinc-800 outline-none placeholder:text-zinc-400 sm:text-sm dark:text-zinc-200 dark:placeholder:text-zinc-500"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading || cooldown}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-white transition-all hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
            AI 回复基于公开内容生成，可能存在偏差
          </p>
        </div>
      </div>
    </>,
    document.body,
  );
}

export function AIChatBox() {
  const {
    open,
    setOpen,
    entryContext,
    hasUserInteracted,
    markUserInteracted,
  } = useAIChat();
  const chatInstanceId = useMemo(() => getChatEntryContextKey(entryContext), [entryContext]);
  const sessionId = useMemo(
    () => `${chatInstanceId}:${generateSessionId()}`,
    [chatInstanceId],
  );
  const [isCompactViewport, setIsCompactViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia(MOBILE_LAUNCHER_MEDIA_QUERY).matches
      : false,
  );
  const [mobileLauncherReadySlug, setMobileLauncherReadySlug] = useState<string | null>(null);
  const sendLockRef = useRef(false);
  const [dismissedStarterState, setDismissedStarterState] = useState<{
    contextKey: string;
    questions: string[];
  }>({
    contextKey: "",
    questions: [],
  });

  const sessionTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: { "x-session-id": sessionId },
        body: { context: toChatRequestContext(entryContext) },
      }),
    [entryContext, sessionId],
  );

  const { messages, sendMessage, status, setMessages, error, clearError } = useChat({
    // useChat does not rebuild its internal Chat when transport/body changes alone.
    // Re-key the instance by entry context so article-scoped first turns use the right payload.
    id: chatInstanceId,
    transport: sessionTransport,
    messages: [buildWelcomeMessage(entryContext)],
  });

  useEffect(() => {
    if (hasUserInteracted) return;
    setMessages([buildWelcomeMessage(entryContext)]);
    clearError();
  }, [clearError, entryContext, hasUserInteracted, setMessages]);

  const isSending = status === "submitted" || status === "streaming";

  useEffect(() => {
    if (!isSending) {
      sendLockRef.current = false;
    }
  }, [isSending]);

  const errorInfo = parseErrorInfo(error);
  const dismissedStarterQuestions =
    dismissedStarterState.contextKey === chatInstanceId ? dismissedStarterState.questions : [];

  const latestStatusData = useMemo<ChatStatusData | undefined>(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant" && isChatStatusData(message.metadata)) {
        return message.metadata;
      }
    }
    return undefined;
  }, [messages]);

  const handleSend = useCallback(
    (params: { text: string }) => {
      if (sendLockRef.current || isSending) return;
      sendLockRef.current = true;
      markUserInteracted();
      if (error) clearError();
      sendMessage(params);
    },
    [clearError, error, isSending, markUserInteracted, sendMessage],
  );

  const handleClear = useCallback(() => {
    setMessages([buildWelcomeMessage(entryContext)]);
    setDismissedStarterState({
      contextKey: chatInstanceId,
      questions: [],
    });
    clearError();
  }, [chatInstanceId, clearError, entryContext, setMessages]);

  const handleSelectStarterQuestion = useCallback(
    (question: string) => {
      if (sendLockRef.current || isSending) return;
      setDismissedStarterState((current) => {
        const baseQuestions = current.contextKey === chatInstanceId ? current.questions : [];
        return {
          contextKey: chatInstanceId,
          questions: baseQuestions.includes(question) ? baseQuestions : [...baseQuestions, question],
        };
      });
      handleSend({ text: question });
    },
    [chatInstanceId, handleSend, isSending],
  );

  const handleClose = useCallback(() => {
    if (isArticleChatEntryContext(entryContext) && !hasUserInteracted && !isCompactViewport) {
      dismissArticleChat(entryContext.article.slug);
      setMobileLauncherReadySlug(null);
    }
    setOpen(false);
  }, [entryContext, hasUserInteracted, isCompactViewport, setOpen]);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.role !== "system"),
    [messages],
  );

  const articleContext = isArticleChatEntryContext(entryContext) ? entryContext.article : null;
  const articleSlug = articleContext?.slug ?? null;

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_LAUNCHER_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => setIsCompactViewport(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!articleContext?.slug || !isCompactViewport || hasUserInteracted) return;

    let disposed = false;
    let delayReady = false;
    let progressReady = getPageScrollProgress() >= MOBILE_LAUNCHER_MIN_PROGRESS;

    const revealLauncher = () => {
      if (disposed || !delayReady || !progressReady) return;
      setMobileLauncherReadySlug(articleContext.slug);
      window.removeEventListener("scroll", handleScroll);
    };

    const handleScroll = () => {
      progressReady = getPageScrollProgress() >= MOBILE_LAUNCHER_MIN_PROGRESS;
      revealLauncher();
    };

    const timerId = window.setTimeout(() => {
      delayReady = true;
      revealLauncher();
    }, MOBILE_LAUNCHER_DELAY_MS);

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      disposed = true;
      window.clearTimeout(timerId);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [articleContext, hasUserInteracted, isCompactViewport]);

  const showDesktopLauncher = Boolean(articleContext) && !open && !isCompactViewport;
  const showMobileLauncher =
    Boolean(articleContext) &&
    !open &&
    isCompactViewport &&
    (hasUserInteracted || mobileLauncherReadySlug === articleSlug);

  return (
    <>
      {showDesktopLauncher && articleContext && (
        <ArticleChatLauncher
          articleTitle={articleContext.title}
          openingLine={articleContext.openingLine}
          onOpen={() => setOpen(true)}
        />
      )}
      {showMobileLauncher && articleContext && (
        <ArticleChatLauncher articleTitle={articleContext.title} onOpen={() => setOpen(true)} compact />
      )}
      <ChatPanel
        open={open}
        onClose={handleClose}
        messages={messages}
        visibleMessages={visibleMessages}
        sendMessage={handleSend}
        status={status}
        error={error}
        errorInfo={errorInfo}
        onClear={handleClear}
        latestStatusData={latestStatusData}
        entryContext={entryContext}
        dismissedStarterQuestions={dismissedStarterQuestions}
        onSelectStarterQuestion={handleSelectStarterQuestion}
        isSending={isSending}
      />
    </>
  );
}

export function AIChatTrigger() {
  const { open, setOpen, resetEntryContext } = useAIChat();
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-1 pt-0 sm:px-4 md:px-6 lg:px-2">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={() => {
            resetEntryContext();
            setOpen(true);
          }}
          className="group flex w-full items-center gap-3 rounded-2xl border border-zinc-200/60 bg-zinc-50/40 px-3.5 py-2.5 text-left transition-all hover:border-zinc-300/80 hover:bg-zinc-100/50 hover:shadow-sm dark:border-zinc-700/40 dark:bg-zinc-800/20 dark:hover:border-zinc-600/60 dark:hover:bg-zinc-800/40"
        >
          <AuthorAvatar size={32} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-zinc-600 dark:text-zinc-400">
              Hi，我是{siteConfig.author.name}的{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                {siteConfig.ai.triggerLabel}
              </span>
              ，{siteConfig.ai.triggerText}
            </p>
            <p className="mt-0.5 truncate text-xs text-zinc-400 dark:text-zinc-500">
              {PLACEHOLDERS[placeholderIndex]}
            </p>
          </div>
          {open ? (
            <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
              对话中
            </span>
          ) : (
            <Sparkles className="h-4 w-4 shrink-0 text-zinc-300 transition-colors group-hover:text-violet-400 dark:text-zinc-600 dark:group-hover:text-violet-400" />
          )}
        </button>
      </div>
    </div>
  );
}
