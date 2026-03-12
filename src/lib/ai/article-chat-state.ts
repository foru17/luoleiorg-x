const ARTICLE_CHAT_STATE_KEY = "article-chat-state:v1";
const ARTICLE_CHAT_DISMISS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface StoredArticleChatState {
  dismissedAtBySlug: Record<string, number>;
  autoOpenedAtBySlug: Record<string, number>;
}

function getDefaultState(): StoredArticleChatState {
  return {
    dismissedAtBySlug: {},
    autoOpenedAtBySlug: {},
  };
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readArticleChatState(): StoredArticleChatState {
  if (!canUseStorage()) return getDefaultState();

  try {
    const raw = window.localStorage.getItem(ARTICLE_CHAT_STATE_KEY);
    if (!raw) return getDefaultState();
    const parsed = JSON.parse(raw) as Partial<StoredArticleChatState>;
    return {
      dismissedAtBySlug:
        parsed.dismissedAtBySlug && typeof parsed.dismissedAtBySlug === "object"
          ? parsed.dismissedAtBySlug
          : {},
      autoOpenedAtBySlug:
        parsed.autoOpenedAtBySlug && typeof parsed.autoOpenedAtBySlug === "object"
          ? parsed.autoOpenedAtBySlug
          : {},
    };
  } catch {
    return getDefaultState();
  }
}

function writeArticleChatState(state: StoredArticleChatState): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(ARTICLE_CHAT_STATE_KEY, JSON.stringify(state));
}

export function isArticleChatDismissed(slug: string, now = Date.now()): boolean {
  if (!slug) return false;
  const state = readArticleChatState();
  const dismissedAt = state.dismissedAtBySlug[slug];
  return typeof dismissedAt === "number" && now - dismissedAt < ARTICLE_CHAT_DISMISS_COOLDOWN_MS;
}

export function dismissArticleChat(slug: string, now = Date.now()): void {
  if (!slug) return;
  const state = readArticleChatState();
  state.dismissedAtBySlug[slug] = now;
  writeArticleChatState(state);
}

export function markArticleChatAutoOpened(slug: string, now = Date.now()): void {
  if (!slug) return;
  const state = readArticleChatState();
  state.autoOpenedAtBySlug[slug] = now;
  writeArticleChatState(state);
}

export function hasArticleChatAutoOpened(slug: string): boolean {
  if (!slug) return false;
  const state = readArticleChatState();
  return typeof state.autoOpenedAtBySlug[slug] === "number";
}
