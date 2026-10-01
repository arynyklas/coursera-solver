import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { browser } from "wxt/browser";
import { callProvider } from "@/ai/client";
import { ANSWER_SCHEMA } from "@/ai/schemas";

const call = {
  provider: "openai" as const,
  apiKey: "test-secret",
  model: "gpt-5.6-terra",
  prompt: "Return JSON.",
  schema: ANSWER_SCHEMA,
  schemaName: "quiz_answers",
};

describe("callProvider", () => {
  it("retries once without the schema after a structured-output compatibility error", async () => {
    const fetchStub = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "Unsupported json_schema" } }), {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: '{"answers":[]}' }), { status: 200 }),
      );
    await expect(callProvider(call, { fetch: fetchStub })).resolves.toBe('{"answers":[]}');
    expect(fetchStub).toHaveBeenCalledTimes(2);
    const retryBody = JSON.parse(String(fetchStub.mock.calls[1]?.[1]?.body));
    expect(retryBody.text.format.type).toBe("json_object");
  });

  // F8: background.js:167-175 in v1.1.0 (c2f8b71) had no timeout; a hung provider stalled forever.
  it("fails with a clear message when the provider does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const fetchStub = vi.fn<typeof fetch>(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const pending = callProvider(call, { fetch: fetchStub, timeoutMs: 120_000 });
      const assertion = expect(pending).rejects.toThrow(
        "OpenAI did not respond within 120 seconds. Try again.",
      );
      await vi.advanceTimersByTimeAsync(120_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports network failures with the provider label", async () => {
    const fetchStub = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(callProvider(call, { fetch: fetchStub })).rejects.toThrow(
      "Could not reach OpenAI. Check your connection and try again.",
    );
  });

  describe("with images", () => {
    const image = { label: "Question 1 image 1", mediaType: "image/png", data: "iVBORw0KGgo=" };
    const groqCall = { ...call, provider: "groq" as const, model: "openai/gpt-oss-120b" };

    it("retries once with the text-only prompt when the model rejects image input", async () => {
      const fetchStub = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: { message: "messages.0.content must be a string" } }),
            {
              status: 400,
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ choices: [{ message: { content: '{"answers":[]}' } }] }), {
            status: 200,
          }),
        );

      await expect(
        callProvider(
          { ...groqCall, images: { attachments: [image], promptWithoutImages: "Text only." } },
          { fetch: fetchStub },
        ),
      ).resolves.toBe('{"answers":[]}');

      expect(fetchStub).toHaveBeenCalledTimes(2);
      const first = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body));
      const retry = JSON.parse(String(fetchStub.mock.calls[1]?.[1]?.body));
      expect(first.messages[0].content).toContainEqual({
        type: "image_url",
        image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
      });
      expect(retry.messages).toEqual([{ role: "user", content: "Text only." }]);
    });

    it("reports the provider's error after the text-only retry fails too", async () => {
      // Each call needs its own Response: a body can be read only once.
      const fetchStub = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify({ error: { message: "Invalid model" } }), { status: 400 }),
      );

      await expect(
        callProvider(
          { ...groqCall, images: { attachments: [image], promptWithoutImages: "Text only." } },
          { fetch: fetchStub },
        ),
      ).rejects.toThrow("Groq: Invalid model");
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it("drops the images, not the schema, when a strict-schema provider says it cannot take them", async () => {
      const fetchStub = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ error: { message: "Unsupported parameter: image_url content" } }),
            { status: 400 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ choices: [{ message: { content: '{"answers":[]}' } }] }), {
            status: 200,
          }),
        );

      await expect(
        callProvider(
          {
            ...call,
            provider: "openrouter",
            model: "~openai/gpt-latest",
            images: { attachments: [image], promptWithoutImages: "Text only." },
          },
          { fetch: fetchStub },
        ),
      ).resolves.toBe('{"answers":[]}');

      expect(fetchStub).toHaveBeenCalledTimes(2);
      const retry = JSON.parse(String(fetchStub.mock.calls[1]?.[1]?.body));
      expect(retry.messages).toEqual([{ role: "user", content: "Text only." }]);
      expect(retry.response_format.type).toBe("json_schema");
    });

    it("does not retry a failed request that carried no images", async () => {
      const fetchStub = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: { message: "Invalid model" } }), { status: 400 }),
        );

      await expect(callProvider(groqCall, { fetch: fetchStub })).rejects.toThrow(
        "Groq: Invalid model",
      );
      expect(fetchStub).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a self-hosted server cannot be reached", () => {
    const vllmCall = {
      ...call,
      provider: "vllm" as const,
      apiKey: "",
      baseUrl: "http://gpu.lan:8000/v1",
    };
    let contains: Mock<(permissions: { origins?: string[] }) => Promise<boolean>>;

    beforeEach(() => {
      // vi.spyOn types the last overload (callback form, returns void); the client uses the promise form.
      contains = vi.spyOn(browser.permissions, "contains") as unknown as Mock<
        (permissions: { origins?: string[] }) => Promise<boolean>
      >;
    });

    it("names the server when the extension has access to it", async () => {
      contains.mockResolvedValue(true);
      const fetchStub = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(callProvider(vllmCall, { fetch: fetchStub })).rejects.toThrow(
        "Could not reach the vLLM server at gpu.lan:8000. Check the server URL and that the server is running.",
      );
      expect(String(fetchStub.mock.calls[0]?.[0])).toBe("http://gpu.lan:8000/v1/chat/completions");
    });

    it("asks for access to the server when the extension lacks it", async () => {
      contains.mockResolvedValue(false);
      const fetchStub = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
      await expect(callProvider(vllmCall, { fetch: fetchStub })).rejects.toThrow(
        "Allow access to gpu.lan:8000: open the AI provider settings and click Load models.",
      );
      expect(contains).toHaveBeenCalledWith({ origins: ["http://gpu.lan:8000/*"] });
    });
  });
});
