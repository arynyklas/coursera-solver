import { useCallback, useEffect, useState } from "react";
import { isProviderId, modelLabel } from "@/ai/providers";
import {
  activeProviderItem,
  clearProviderSettings,
  getActiveProvider,
  getProviderSettings,
  isProviderReady,
  migrateLegacyGeminiKey,
  type ProviderSettings,
  type ProviderSettingsMap,
  providerSettingsItem,
  type ServerDraft,
  saveProviderSettings,
  serverDraftItem,
} from "@/shared/storage";
import type { ProviderId } from "@/shared/types";

export interface ProviderConfigState {
  loading: boolean;
  /** Reading storage failed; the popup falls back to Gemini with no saved keys. */
  loadError: boolean;
  activeProvider: ProviderId;
  settings: ProviderSettingsMap;
  /** The active provider's saved settings can call it (`isProviderReady`). */
  activeReady: boolean;
  /** Server input left behind when Chrome's host-access prompt closed the popup. */
  draft: ServerDraft | null;
  save(provider: ProviderId, settings: ProviderSettings): Promise<void>;
  clear(provider: ProviderId): Promise<void>;
  /** Forgets the draft once Settings has taken it over. */
  clearDraft(): void;
}

interface State {
  loading: boolean;
  loadError: boolean;
  activeProvider: ProviderId;
  settings: ProviderSettingsMap;
  draft: ServerDraft | null;
}

const INITIAL: State = {
  loading: true,
  loadError: false,
  activeProvider: "gemini",
  settings: {},
  draft: null,
};

export function useProviderConfig(): ProviderConfigState {
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    // Watch before the first read so a change that lands in between is not lost.
    const unwatchSettings = providerSettingsItem.watch((value) => {
      setState((current) => ({
        ...current,
        settings: value && typeof value === "object" ? { ...value } : {},
      }));
    });
    const unwatchActive = activeProviderItem.watch((value) => {
      setState((current) => ({
        ...current,
        activeProvider: isProviderId(value) ? value : "gemini",
      }));
    });

    (async () => {
      try {
        await migrateLegacyGeminiKey();
        const [activeProvider, settings, draft] = await Promise.all([
          getActiveProvider(),
          getProviderSettings(),
          serverDraftItem.getValue(),
        ]);
        if (!cancelled) {
          setState({ loading: false, loadError: false, activeProvider, settings, draft });
        }
      } catch {
        if (!cancelled) setState((current) => ({ ...current, loading: false, loadError: true }));
      }
    })();

    return () => {
      cancelled = true;
      unwatchSettings();
      unwatchActive();
    };
  }, []);

  const clearDraft = useCallback(() => {
    setState((current) => ({ ...current, draft: null }));
    void serverDraftItem.removeValue();
  }, []);

  return {
    ...state,
    activeReady: isProviderReady(state.activeProvider, state.settings[state.activeProvider]),
    save: saveProviderSettings,
    clear: clearProviderSettings,
    clearDraft,
  };
}

/** The context row's model label, or `null` when the active provider has no saved key. */
export function activeModelLabel(config: ProviderConfigState): string | null {
  if (!config.activeReady) return null;
  const provider = config.activeProvider;
  return modelLabel(provider, config.settings[provider]?.model ?? "");
}
