import { describe, expect, it, vi } from "vitest";
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

  // F8: legacy background.js:167-175 had no timeout, so a hung provider stalled forever.
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
});
