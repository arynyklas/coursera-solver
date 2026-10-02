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

  it("answers through the saved vLLM server without a key", async () => {
    await browser.storage.local.set({
      aiProvider: "vllm",
      aiProviderSettings: {
        vllm: { apiKey: "", model: "Qwen/Qwen3-8B", baseUrl: "http://gpu.lan:8000/v1" },
      },
    });
    const answers = JSON.stringify({ answers: [{ questionNumber: 1, correctOptions: ["A"] }] });
    const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: answers } }] }), {
        status: 200,
      }),
    );

    await expect(
      createBackgroundHandlers({ fetch: fetchStub }).solveQuestions({ questions }, sender),
    ).resolves.toEqual([{ questionNumber: 1, correctOptions: ["A"] }]);
    expect(String(fetchStub.mock.calls[0]?.[0])).toBe("http://gpu.lan:8000/v1/chat/completions");
    expect(JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body)).model).toBe("Qwen/Qwen3-8B");
  });

  it("asks for a vLLM server when none is saved", async () => {
    await browser.storage.local.set({ aiProvider: "vllm" });
    const handlers = createBackgroundHandlers({ fetch: vi.fn<typeof fetch>() });
    await expect(handlers.solveQuestions({ questions }, sender)).rejects.toThrow(
      "Add and verify a vLLM server in the extension popup.",
    );
  });

  it("asks with the saved reasoning effort, or medium when none the provider offers is saved", async () => {
    const answers = JSON.stringify({ answers: [{ questionNumber: 1, correctOptions: ["A"] }] });
    const fetchStub = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ output_text: answers }), { status: 200 }),
    );
    const handlers = createBackgroundHandlers({ fetch: fetchStub });
    const solveWith = async (effort?: string) => {
      await browser.storage.local.set({
        aiProvider: "openai",
        aiProviderSettings: { openai: { apiKey: "k", model: "gpt-5.6-terra", effort } },
      });
      await handlers.solveQuestions({ questions }, sender);
      return JSON.parse(String(fetchStub.mock.calls.at(-1)?.[1]?.body)).reasoning;
    };

    await expect(solveWith("low")).resolves.toEqual({ effort: "low" });
    await expect(solveWith(undefined)).resolves.toEqual({ effort: "medium" });
    // Only vLLM offers to turn thinking off.
    await expect(solveWith("none")).resolves.toEqual({ effort: "medium" });
  });

  it("leaves thinking to a vLLM server's model until a level is saved", async () => {
    const answers = JSON.stringify({ answers: [{ questionNumber: 1, correctOptions: ["A"] }] });
    const fetchStub = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: answers } }] }), {
          status: 200,
        }),
    );
    const handlers = createBackgroundHandlers({ fetch: fetchStub });
    const solveWith = async (effort?: string) => {
      await browser.storage.local.set({
        aiProvider: "vllm",
        aiProviderSettings: {
          vllm: { apiKey: "", model: "Qwen/Qwen3-8B", baseUrl: "http://gpu.lan:8000/v1", effort },
        },
      });
      await handlers.solveQuestions({ questions }, sender);
      return JSON.parse(String(fetchStub.mock.calls.at(-1)?.[1]?.body));
    };

    await expect(solveWith(undefined)).resolves.not.toHaveProperty("reasoning_effort");
    await expect(solveWith("none")).resolves.toHaveProperty("reasoning_effort", "none");
  });

  describe("quiz images", () => {
    const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7]);
    const imageUrl = "https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1/diagram.png";
    const withImage: Question[] = [
      {
        ...questions[0],
        questionNumber: 1,
        type: "single_answer",
        question: "Pick",
        options: ["A", "B"],
        images: [{ url: imageUrl, alt: "Lifecycle diagram" }],
      },
    ];

    it("sends each question image to a provider that reads images, labelled in the prompt", async () => {
      await browser.storage.local.set({
        aiProvider: "gemini",
        aiProviderSettings: { gemini: { apiKey: "k", model: "gemini-3.7-flash", verifiedAt: 1 } },
      });
      const fetchStub = vi.fn<typeof fetch>(async (input) =>
        String(input) === imageUrl
          ? new Response(PNG)
          : geminiResponse(
              JSON.stringify({ answers: [{ questionNumber: 1, correctOptions: ["B"] }] }),
            ),
      );

      await expect(
        createBackgroundHandlers({ fetch: fetchStub }).solveQuestions(
          { questions: withImage },
          sender,
        ),
      ).resolves.toEqual([{ questionNumber: 1, correctOptions: ["B"] }]);

      const [promptPart, ...imageParts] = JSON.parse(String(fetchStub.mock.calls.at(-1)?.[1]?.body))
        .contents[0].parts;
      // The prompt names the image instead of its signed URL.
      expect(promptPart.text).toContain('"label": "Question 1 image 1"');
      expect(promptPart.text).toContain('"alt": "Lifecycle diagram"');
      expect(promptPart.text).not.toContain("cloudfront.net");
      expect(imageParts).toEqual([
        { text: "Question 1 image 1" },
        { inline_data: { mime_type: "image/png", data: Buffer.from(PNG).toString("base64") } },
      ]);
    });

    it("tells a provider without image input which image it cannot see", async () => {
      await browser.storage.local.set({
        aiProvider: "deepseek",
        aiProviderSettings: {
          deepseek: { apiKey: "k", model: "deepseek-v4-flash", verifiedAt: 1 },
        },
      });
      const answers = JSON.stringify({ answers: [{ questionNumber: 1, correctOptions: ["A"] }] });
      const fetchStub = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: answers } }] }), {
          status: 200,
        }),
      );

      await createBackgroundHandlers({ fetch: fetchStub }).solveQuestions(
        { questions: withImage },
        sender,
      );

      expect(fetchStub).toHaveBeenCalledTimes(1);
      const { content } = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body)).messages[0];
      expect(content).toContain('"notAttached": "DeepSeek does not read images"');
    });
  });

  describe("listModels", () => {
    const list = (stub: typeof fetch, provider: ProviderId = "vllm") =>
      createBackgroundHandlers({ fetch: stub }).listModels(
        { provider, apiKey: "token-abc", baseUrl: "http://gpu.lan:8000" },
        sender,
      );

    it("returns the models a vLLM server lists, asking with its key", async () => {
      const stub = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "Qwen/Qwen3-8B" }, { id: "sql-lora" }] }), {
          status: 200,
        }),
      );
      await expect(list(stub)).resolves.toEqual({ models: ["Qwen/Qwen3-8B", "sql-lora"] });
      expect(String(stub.mock.calls[0]?.[0])).toBe("http://gpu.lan:8000/v1/models");
      expect(new Headers(stub.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
        "Bearer token-abc",
      );
    });

    it("reports a server that lists no models", async () => {
      const stub = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
      await expect(list(stub)).rejects.toThrow("The vLLM server lists no models.");
    });

    it("refuses a provider with a fixed model list", async () => {
      const stub = vi.fn<typeof fetch>();
      await expect(list(stub, "openai")).rejects.toThrow("OpenAI has a fixed model list.");
      expect(stub).not.toHaveBeenCalled();
    });
  });

  describe("verifyProvider", () => {
    const verify = (
      request: { provider: string; apiKey: string; model: string; baseUrl?: string },
      stub?: typeof fetch,
    ) =>
      createBackgroundHandlers({ fetch: stub ?? vi.fn<typeof fetch>() }).verifyProvider(
        { ...request, provider: request.provider as ProviderId },
        sender,
      );
    const servedModels = () =>
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [{ id: "Qwen/Qwen3-8B" }] }), { status: 200 }),
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

    it("connects a keyless vLLM server that serves the chosen model", async () => {
      const stub = servedModels();
      await expect(
        verify(
          { provider: "vllm", apiKey: "", model: "Qwen/Qwen3-8B", baseUrl: "http://gpu.lan:8000" },
          stub,
        ),
      ).resolves.toEqual({ message: "vLLM is connected." });
      expect(String(stub.mock.calls[0]?.[0])).toBe("http://gpu.lan:8000/v1/models");
      expect(new Headers(stub.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
    });

    it("rejects a model the vLLM server does not serve", async () => {
      await expect(
        verify(
          { provider: "vllm", apiKey: "", model: "Qwen/Qwen3-32B", baseUrl: "http://gpu.lan:8000" },
          servedModels(),
        ),
      ).rejects.toThrow("The vLLM server does not serve Qwen/Qwen3-32B.");
    });

    it("asks for the vLLM server URL", async () => {
      await expect(
        verify({ provider: "vllm", apiKey: "", model: "Qwen/Qwen3-8B" }, servedModels()),
      ).rejects.toThrow("Enter the server URL with http:// or https://");
    });
  });
});
