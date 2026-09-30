import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createBackgroundHandlers } from "@/background/handlers";
import {
  BACKGROUND_FALLBACKS,
  type BackgroundRequests,
  createMessageRouter,
  type MessageSender,
  type Reply,
} from "@/shared/messaging";
import type { ProviderId, Question } from "@/shared/types";

const sender: MessageSender = {};
const questions: Question[] = [
  { questionNumber: 1, type: "single_answer", question: "Pick", options: ["A", "B"] },
];

function geminiResponse(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
  });
}

describe("background handlers", () => {
  beforeEach(() => fakeBrowser.reset());

  it("migrates a legacy Gemini key and returns normalized answers through the router", async () => {
    await browser.storage.local.set({ userApiKey: "legacy-gemini-key" });
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        geminiResponse(JSON.stringify({ answers: [{ questionNumber: 1, correctOptions: ["B"] }] })),
      );
    const router = createMessageRouter<BackgroundRequests>(
      createBackgroundHandlers({ fetch: fetchStub }),
      BACKGROUND_FALLBACKS,
    );

    const reply = await new Promise<Reply<unknown>>((resolve) => {
      expect(router({ type: "solveQuestions", questions }, sender, resolve)).toBe(true);
    });

    expect(reply).toEqual({ ok: true, data: [{ questionNumber: 1, correctOptions: ["B"] }] });
    expect(String(fetchStub.mock.calls[0]?.[0])).toMatch(/gemini-3\.7-flash:generateContent$/);
    expect(await browser.storage.local.get(null)).toEqual({
      aiProvider: "gemini",
      aiProviderSettings: { gemini: { apiKey: "legacy-gemini-key", model: "gemini-3.7-flash" } },
    });
  });

  it("asks for a key when the active provider has none", async () => {
    const handlers = createBackgroundHandlers({ fetch: vi.fn<typeof fetch>() });
    await expect(handlers.solveQuestions({ questions }, sender)).rejects.toThrow(
      "Add and verify a Gemini API key in the extension popup.",
    );
  });

  describe("verifyProvider", () => {
    const verify = (
      request: { provider: string; apiKey: string; model: string },
      stub?: typeof fetch,
    ) =>
      createBackgroundHandlers({ fetch: stub ?? vi.fn<typeof fetch>() }).verifyProvider(
        { ...request, provider: request.provider as ProviderId },
        sender,
      );

    it("rejects an unsupported provider", async () => {
      await expect(verify({ provider: "nope", apiKey: "k", model: "m" })).rejects.toThrow(
        "Choose a supported AI provider.",
      );
    });

    it("rejects an empty key", async () => {
      await expect(
        verify({ provider: "gemini", apiKey: "  ", model: "gemini-3.7-flash" }),
      ).rejects.toThrow("Enter an API key first.");
    });

    it("rejects an empty model", async () => {
      await expect(verify({ provider: "gemini", apiKey: "key", model: " " })).rejects.toThrow(
        "Choose or enter a model first.",
      );
    });

    it("rejects an xAI model missing from the account's model list", async () => {
      const stub = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ id: "grok-4.3" }] }), { status: 200 }),
        );
      await expect(
        verify({ provider: "xai", apiKey: "xai-key", model: "grok-4.6" }, stub),
      ).rejects.toThrow("The selected xAI model is unavailable for this account.");
    });

    it("reports a connected provider", async () => {
      const stub = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ name: "models/gemini-3.7-flash" }), { status: 200 }),
        );
      await expect(
        verify({ provider: "gemini", apiKey: "AIza-key", model: "gemini-3.7-flash" }, stub),
      ).resolves.toEqual({ message: "Gemini is connected." });
    });
  });
});
