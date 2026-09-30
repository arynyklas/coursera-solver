export type BannerTone = "info" | "success" | "error";
export interface BannerContent {
  tone: BannerTone;
  title: string;
  description?: string;
  detail?: string;
  progress?: number;
  autoHideMs?: number;
}
export interface BannerSnapshot {
  content: BannerContent | null;
  leaving: boolean;
}
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
export interface BannerController {
  show(content: BannerContent): void;
  hide(): void;
}

export const FADE_MS = 300;

const defaultScheduler: Scheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function createBannerStore(scheduler: Scheduler = defaultScheduler) {
  let snapshot: BannerSnapshot = { content: null, leaving: false };
  let autoHideTimer: unknown = null;
  let removeTimer: unknown = null;
  const listeners = new Set<() => void>();

  const emit = (next: BannerSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const clearTimers = () => {
    if (autoHideTimer != null) scheduler.clearTimeout(autoHideTimer);
    if (removeTimer != null) scheduler.clearTimeout(removeTimer);
    autoHideTimer = null;
    removeTimer = null;
  };

  function hide(): boolean {
    if (!snapshot.content || snapshot.leaving) return false;
    clearTimers();
    emit({ content: snapshot.content, leaving: true });
    removeTimer = scheduler.setTimeout(() => {
      removeTimer = null;
      emit({ content: null, leaving: false });
    }, FADE_MS);
    return true;
  }

  function show(content: BannerContent): void {
    clearTimers();
    emit({ content, leaving: false });
    if (content.tone === "success" && content.autoHideMs && content.autoHideMs > 0) {
      autoHideTimer = scheduler.setTimeout(() => {
        autoHideTimer = null;
        hide();
      }, content.autoHideMs);
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show,
    hide,
  };
}

export type BannerStore = ReturnType<typeof createBannerStore>;
