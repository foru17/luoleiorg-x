"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { IconX } from "@/components/icons";
import { useAIChat } from "./ai-chat-provider";
import { isChatStatusData, type ChatStatusData } from "@/lib/ai/chat-status";
import { MAX_TWEET_CARDS_PER_MESSAGE, MIN_SEND_INTERVAL_MS } from "@/lib/constants";
import { ChatTweetCard } from "./chat/chat-tweet";
import { renderInlineMarkdown } from "./chat/chat-markdown";
import { siteConfig } from "@/lib/site-config";

const PLACEHOLDERS = siteConfig.ai.placeholders;

const WELCOME_MESSAGE: UIMessage = {
  id: "welcome",
  role: "assistant",
  parts: [
    {
      type: "text",
      text: siteConfig.ai.welcomeText,
    },
  ],
};

const transport = new DefaultChatTransport({ api: "/api/chat" });

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getTextFromMessage(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

export function AuthorAvatar({ size = 28 }: { size?: number }) {
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <img
        src="/images/avatar.jpg"
        alt={siteConfig.author.name}
        width={size}
        height={size}
        className="rounded-full object-cover"
      />
      <span className="absolute -right-1 -top-1 flex h-3.5 items-center rounded-full bg-violet-500 px-1 text-[8px] font-bold leading-none text-white">
        AI
      </span>
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
      {parsedParagraphs.map((parsed, i) => (
        <p key={i}>{parsed.nodes}</p>
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
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showTweetCards ? "rotate-180" : ""}`} />
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

function parseErrorInfo(error: Error | undefined): {
  message: string;
  detail?: string;
  isRateLimit: boolean;
} | null {
  if (!error) return null;
  const msg = error.message ?? "";

  if (msg.includes("请求太频繁") || msg.includes("请求次数过多") || msg.includes("今日对话次数"))
    return { message: msg, isRateLimit: true };
  if (msg.includes("429") || msg.includes("rate"))
    return { message: "请求太频繁，请稍后再试", isRateLimit: true };

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
    // not JSON
  }

  if (msg.includes("认证") || msg.includes("401") || msg.includes("403"))
    return { message: "AI 服务认证出了问题，博主正在处理中", isRateLimit: false };
  if (msg.includes("超时") || msg.includes("timeout"))
    return { message: "AI 思考太久了，请稍后再试一次", isRateLimit: false };
  if (msg.includes("不可用") || msg.includes("503"))
    return { message: "AI 服务暂时不在线，请稍后再来", isRateLimit: false };

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
}) {
  const [input, setInput] = useState("");
  const [cooldown, setCooldown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastSendRef = useRef(0);

  const isLoading = status === "submitted" || status === "streaming";
  const lastVisibleMessage = visibleMessages[visibleMessages.length - 1];
  const hasPendingAssistantPlaceholder =
    status === "streaming" &&
    lastVisibleMessage?.role === "assistant" &&
    getTextFromMessage(lastVisibleMessage).trim().length === 0;
  const shouldShowTypingIndicator = status === "submitted" || hasPendingAssistantPlaceholder;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      const el = panelRef.current;
      if (!el || window.innerWidth >= 640) {
        el?.style.removeProperty("height");
        el?.style.removeProperty("transform");
        return;
      }
      el.style.height = `${vv.height}px`;
      el.style.transform = `translateY(${vv.offsetTop}px)`;
    };

    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      panelRef.current?.style.removeProperty("height");
      panelRef.current?.style.removeProperty("transform");
    };
  }, [open]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isLoading || cooldown) return;

    const now = Date.now();
    if (now - lastSendRef.current < MIN_SEND_INTERVAL_MS) {
      setCooldown(true);
      setTimeout(() => setCooldown(false), MIN_SEND_INTERVAL_MS - (now - lastSendRef.current));
      return;
    }

    lastSendRef.current = now;
    setCooldown(true);
    setTimeout(() => setCooldown(false), MIN_SEND_INTERVAL_MS);

    setInput("");
    sendMessage({ text });
  }, [input, isLoading, cooldown, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (!open) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-100 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        style={{ touchAction: "none" }}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        data-ai-chat-panel
        className="fixed top-0 left-0 z-101 flex h-full w-screen flex-col overflow-hidden bg-white sm:bottom-auto sm:left-1/2 sm:top-[12%] sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-zinc-200 sm:shadow-2xl dark:bg-zinc-900 sm:dark:border-zinc-700"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 dark:bg-violet-900/40">
              <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {siteConfig.author.name}
              </p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {siteConfig.ai.chatTitle} · {siteConfig.ai.chatSubtitle}
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

        {/* Messages */}
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:thin] [scrollbar-color:rgb(161_161_170)_transparent] dark:[scrollbar-color:rgb(82_82_91)_transparent]"
          style={{ scrollbarGutter: "stable" }}
        >
          <div className="mx-auto max-w-xl space-y-5">
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
                  <div className="max-w-[80%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[14px] leading-relaxed text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                    <MessageContent message={message} />
                  </div>
                </div>
              ),
            )}
            {shouldShowTypingIndicator && (
              <TypingIndicator
                statusMessage={latestStatusData?.message}
              />
            )}
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

        {/* Input */}
        <div className="shrink-0 border-t border-zinc-100 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-3 dark:border-zinc-800">
          <div className="mx-auto flex max-w-xl items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 transition-colors focus-within:border-zinc-300 focus-within:bg-white dark:border-zinc-700 dark:bg-zinc-800/50 dark:focus-within:border-zinc-600 dark:focus-within:bg-zinc-800">
            <input
              ref={inputRef}
              type="text"
              inputMode="text"
              enterKeyHint="send"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息..."
              maxLength={500}
              className="min-w-0 flex-1 bg-transparent py-1.5 text-[16px] sm:text-sm text-zinc-800 outline-none placeholder:text-zinc-400 dark:text-zinc-200 dark:placeholder:text-zinc-500"
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
  const { open, setOpen } = useAIChat();
  const [hasInteracted, setHasInteracted] = useState(false);
  const sessionId = useMemo(() => generateSessionId(), []);
  const sessionTransport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", headers: { "x-session-id": sessionId } }),
    [sessionId],
  );

  const { messages, sendMessage, status, setMessages, error, clearError } =
    useChat({
      transport: sessionTransport,
      messages: [WELCOME_MESSAGE],
    });

  const errorInfo = parseErrorInfo(error);

  const latestStatusData = useMemo<ChatStatusData | undefined>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && isChatStatusData(msg.metadata)) {
        return msg.metadata;
      }
    }
    return undefined;
  }, [messages]);

  const handleSend = useCallback(
    (params: { text: string }) => {
      if (!hasInteracted) setHasInteracted(true);
      if (error) clearError();
      sendMessage(params);
    },
    [hasInteracted, error, clearError, sendMessage],
  );

  const handleClear = useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
    setHasInteracted(false);
    clearError();
  }, [setMessages, clearError]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => m.role !== "system"),
    [messages],
  );

  return (
    <ChatPanel
      open={open}
      onClose={() => setOpen(false)}
      messages={messages}
      visibleMessages={visibleMessages}
      sendMessage={handleSend}
      status={status}
      error={error}
      errorInfo={errorInfo}
      onClear={handleClear}
      latestStatusData={latestStatusData}
    />
  );
}

export function AIChatTrigger() {
  const { open, setOpen } = useAIChat();
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDERS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-1 pt-0 sm:px-4 md:px-6 lg:px-2">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={() => setOpen(true)}
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
