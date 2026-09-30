import { storage } from "#imports";
import { isProviderId, PROVIDERS } from "@/ai/providers";
import type { ProviderId } from "./types";

export interface ProviderSettings {
  apiKey: string;
  model: string;
  verifiedAt?: number;
}
export type ProviderSettingsMap = Partial<Record<ProviderId, ProviderSettings>>;

export const activeProviderItem = storage.defineItem<string>("local:aiProvider", {
  fallback: "gemini",
});
export const providerSettingsItem = storage.defineItem<ProviderSettingsMap>(
  "local:aiProviderSettings",
  { fallback: {} },
);

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
