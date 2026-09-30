import { useEffect, useState } from "react";
import { isProviderId, modelLabel } from "@/ai/providers";
import {
  activeProviderItem,
  clearProviderSettings,
  getActiveProvider,
  getProviderSettings,
  migrateLegacyGeminiKey,
  type ProviderSettings,
  type ProviderSettingsMap,
  providerSettingsItem,
  saveProviderSettings,
} from "@/shared/storage";
import type { ProviderId } from "@/shared/types";

export interface ProviderConfigState {
  loading: boolean;
  /** Reading storage failed; the popup falls back to Gemini with no saved keys. */
  loadError: boolean;
  activeProvider: ProviderId;
  settings: ProviderSettingsMap;
  /** The active provider has a saved key. */
  activeReady: boolean;
  save(provider: ProviderId, settings: ProviderSettings): Promise<void>;
  clear(provider: ProviderId): Promise<void>;
}

interface State {
  loading: boolean;
  loadError: boolean;
  activeProvider: ProviderId;
  settings: ProviderSettingsMap;
}

const INITIAL: State = { loading: true, loadError: false, activeProvider: "gemini", settings: {} };

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
        const [activeProvider, settings] = await Promise.all([
          getActiveProvider(),
          getProviderSettings(),
        ]);
        if (!cancelled) setState({ loading: false, loadError: false, activeProvider, settings });
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

  return {
    ...state,
    activeReady: Boolean(state.settings[state.activeProvider]?.apiKey),
    save: saveProviderSettings,
    clear: clearProviderSettings,
  };
}

/** The context row's model label, or `null` when the active provider has no saved key. */
export function activeModelLabel(config: ProviderConfigState): string | null {
  if (!config.activeReady) return null;
  const provider = config.activeProvider;
  return modelLabel(provider, config.settings[provider]?.model ?? "");
}
