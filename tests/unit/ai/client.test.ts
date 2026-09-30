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
