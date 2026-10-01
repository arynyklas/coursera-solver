import { storage } from "#imports";
import { isProviderId, PROVIDERS } from "@/ai/providers";
import type { ProviderId, ReasoningEffort } from "./types";

export interface ProviderSettings {
  apiKey: string;
  model: string;
  /** Read through `effortFor`: settings saved before efforts existed have none. */
  effort?: ReasoningEffort;
  verifiedAt?: number;
  /** The normalized server URL of a self-hosted provider. */
  baseUrl?: string;
}
export type ProviderSettingsMap = Partial<Record<ProviderId, ProviderSettings>>;

/**
 * Self-hosted server input saved just before Chrome's host-access prompt, which can close the
 * popup. Settings resumes from it on the next open.
 */
export interface ServerDraft {
  provider: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  effort: ReasoningEffort;
}

export const activeProviderItem = storage.defineItem<string>("local:aiProvider", {
  fallback: "gemini",
});
export const providerSettingsItem = storage.defineItem<ProviderSettingsMap>(
  "local:aiProviderSettings",
  { fallback: {} },
);
export const serverDraftItem = storage.defineItem<ServerDraft | null>("session:serverDraft", {
  fallback: null,
});

/** Saved settings can call the provider: a server and model when self-hosted, else a key. */
export function isProviderReady(provider: ProviderId, settings: ProviderSettings | undefined) {
  if (!settings) return false;
  if (PROVIDERS[provider].selfHosted) return Boolean(settings.baseUrl && settings.model);
  return Boolean(settings.apiKey);
}

export async function getActiveProvider(): Promise<ProviderId> {
  const value = await activeProviderItem.getValue();
  return isProviderId(value) ? value : "gemini";
}

export async function getProviderSettings(): Promise<ProviderSettingsMap> {
  const value = await providerSettingsItem.getValue();
  return value && typeof value === "object" ? { ...value } : {};
}

export async function saveProviderSettings(
  provider: ProviderId,
  settings: ProviderSettings,
): Promise<void> {
  const current = await getProviderSettings();
  await storage.setItems([
    { key: "local:aiProvider", value: provider },
    { key: "local:aiProviderSettings", value: { ...current, [provider]: settings } },
  ]);
}

export async function clearProviderSettings(provider: ProviderId): Promise<void> {
  const current = await getProviderSettings();
  delete current[provider];
  await providerSettingsItem.setValue(current);
}

export async function migrateLegacyGeminiKey(): Promise<void> {
  const legacyKey = await storage.getItem<string>("local:userApiKey");
  if (legacyKey == null) return;
  const settings = await getProviderSettings();
  if (typeof legacyKey === "string" && legacyKey.trim() && !settings.gemini?.apiKey) {
    settings.gemini = { apiKey: legacyKey, model: PROVIDERS.gemini.defaultModel };
    const storedProvider = await storage.getItem<string>("local:aiProvider");
    await storage.setItems([
      { key: "local:aiProviderSettings", value: settings },
      { key: "local:aiProvider", value: isProviderId(storedProvider) ? storedProvider : "gemini" },
    ]);
  }
  await storage.removeItem("local:userApiKey");
}
