"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ChatEntryContext } from "@/lib/ai/chat-context";
import { getChatEntryContextKey, GLOBAL_CHAT_CONTEXT } from "@/lib/ai/chat-context";

interface AIChatContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  entryContext: ChatEntryContext;
  setEntryContext: (context: ChatEntryContext) => void;
  resetEntryContext: () => void;
  hasUserInteracted: boolean;
  markUserInteracted: () => void;
}

const AIChatContext = createContext<AIChatContextValue>({
  open: false,
  setOpen: () => {},
  toggle: () => {},
  entryContext: GLOBAL_CHAT_CONTEXT,
  setEntryContext: () => {},
  resetEntryContext: () => {},
  hasUserInteracted: false,
  markUserInteracted: () => {},
});

export function useAIChat() {
  return useContext(AIChatContext);
}

export function AIChatProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [entryContext, setEntryContextState] = useState<ChatEntryContext>(GLOBAL_CHAT_CONTEXT);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const previousContextKeyRef = useRef<string>(getChatEntryContextKey(GLOBAL_CHAT_CONTEXT));

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const setEntryContext = useCallback((context: ChatEntryContext) => {
    const nextContextKey = getChatEntryContextKey(context);
    const previousContextKey = previousContextKeyRef.current;

    if (previousContextKey !== nextContextKey) {
      setHasUserInteracted(false);
      previousContextKeyRef.current = nextContextKey;
    }

    setEntryContextState(context);
  }, []);
  const resetEntryContext = useCallback(() => setEntryContext(GLOBAL_CHAT_CONTEXT), [setEntryContext]);
  const markUserInteracted = useCallback(() => setHasUserInteracted(true), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
        return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const tag = target.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable ||
        target.closest("[role='dialog']") ||
        target.closest("[role='combobox']") ||
        target.closest("[data-ai-chat-panel]")
      ) {
        return;
      }

      e.preventDefault();
      setOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <AIChatContext.Provider
      value={{
        open,
        setOpen,
        toggle,
        entryContext,
        setEntryContext,
        resetEntryContext,
        hasUserInteracted,
        markUserInteracted,
      }}
    >
      {children}
    </AIChatContext.Provider>
  );
}
