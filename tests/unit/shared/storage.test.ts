import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  clearProviderSettings,
  getActiveProvider,
  isProviderReady,
  migrateLegacyGeminiKey,
  saveProviderSettings,
} from "@/shared/storage";

describe("provider storage", () => {
  beforeEach(() => fakeBrowser.reset());

  // F7: background.js:41-77 in v1.1.0 (c2f8b71) migrated userApiKey only inside an AI request.
  it("moves a legacy Gemini key into the provider settings and removes it", async () => {
    await browser.storage.local.set({ userApiKey: "legacy-key" });
    await migrateLegacyGeminiKey();
    expect(await browser.storage.local.get(null)).toEqual({
      aiProvider: "gemini",
      aiProviderSettings: { gemini: { apiKey: "legacy-key", model: "gemini-3.7-flash" } },
    });
  });

  it("keeps an existing Gemini key and a valid active provider, but still drops the legacy duplicate", async () => {
    await browser.storage.local.set({
      userApiKey: "legacy-key",
      aiProvider: "openai",
      aiProviderSettings: { gemini: { apiKey: "current", model: "gemini-2.5-pro", verifiedAt: 1 } },
    });
    await migrateLegacyGeminiKey();
    expect(await browser.storage.local.get(null)).toEqual({
      aiProvider: "openai",
      aiProviderSettings: { gemini: { apiKey: "current", model: "gemini-2.5-pro", verifiedAt: 1 } },
    });
  });

  it("does nothing without a legacy key", async () => {
    await migrateLegacyGeminiKey();
    expect(await browser.storage.local.get(null)).toEqual({});
  });

  it("reads an invalid stored provider as gemini", async () => {
    await browser.storage.local.set({ aiProvider: "not-a-provider" });
    await expect(getActiveProvider()).resolves.toBe("gemini");
  });

  it("saves settings and the active provider together, and clears one provider", async () => {
    await saveProviderSettings("groq", {
      apiKey: "gsk_x",
      model: "openai/gpt-oss-20b",
      verifiedAt: 5,
    });
    expect(await browser.storage.local.get(null)).toEqual({
      aiProvider: "groq",
      aiProviderSettings: {
        groq: { apiKey: "gsk_x", model: "openai/gpt-oss-20b", verifiedAt: 5 },
      },
    });
    await clearProviderSettings("groq");
    expect(await browser.storage.local.get(null)).toEqual({
      aiProvider: "groq",
      aiProviderSettings: {},
    });
  });

  it("counts a vLLM server as ready without a key, but a hosted provider only with one", () => {
    const server = "http://localhost:8000/v1";
    expect(isProviderReady("vllm", { apiKey: "", model: "Qwen/Qwen3-8B", baseUrl: server })).toBe(
      true,
    );
    expect(isProviderReady("vllm", { apiKey: "k", model: "", baseUrl: server })).toBe(false);
    expect(isProviderReady("vllm", { apiKey: "k", model: "Qwen/Qwen3-8B" })).toBe(false);
    expect(isProviderReady("groq", { apiKey: "gsk_x", model: "" })).toBe(true);
    expect(isProviderReady("groq", { apiKey: "", model: "openai/gpt-oss-20b" })).toBe(false);
    expect(isProviderReady("groq", undefined)).toBe(false);
  });
});
