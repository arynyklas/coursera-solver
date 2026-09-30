import { describe, expect, it } from "vitest";
import { shouldRetryWithoutSchema } from "@/ai/errors";
import { PROVIDER_IDS, PROVIDERS } from "@/ai/providers";
import { buildGenerationRequest, buildVerificationRequest } from "@/ai/requests";

const apiKey = "test-secret";
const prompt = "Return JSON.";

describe("buildGenerationRequest", () => {
  // Ported from tests/ai-providers.test.js:27-42 in v1.1.0 (c2f8b71).
  it("builds authenticated generation requests for every provider", () => {
    for (const providerId of PROVIDER_IDS) {
      const provider = PROVIDERS[providerId];
      const request = buildGenerationRequest(providerId, apiKey, provider.defaultModel, prompt, {
        structured: true,
      });
      const body = JSON.parse(String(request.options.body));

      expect(request.options.method).toBe("POST");
      expect(body.model || provider.defaultModel).toBe(provider.defaultModel);
      expect(request.url.startsWith("https://")).toBe(true);
      expect(
        request.options.headers.Authorization === `Bearer ${apiKey}` ||
          request.options.headers["x-goog-api-key"] === apiKey ||
          request.options.headers["x-api-key"] === apiKey,
      ).toBe(true);
    }
  });

  // Ported from tests/ai-providers.test.js:44-52 in v1.1.0 (c2f8b71).
  it("uses the OpenAI Responses API with strict JSON Schema", () => {
    const request = buildGenerationRequest("openai", apiKey, "gpt-5.6-terra", prompt, {
      structured: true,
    });
    const body = JSON.parse(String(request.options.body));

    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(body.text.format.type).toBe("json_schema");
    expect(body.text.format.strict).toBe(true);
    expect(body.store).toBe(false);
  });
});

describe("shouldRetryWithoutSchema", () => {
  // Ported from tests/ai-providers.test.js:118-122 in v1.1.0 (c2f8b71).
  it("falls back only for structured-output compatibility errors", () => {
    expect(
      shouldRetryWithoutSchema("openai", 400, { error: { message: "Unsupported json_schema" } }),
    ).toBe(true);
    expect(shouldRetryWithoutSchema("openai", 401, { error: { message: "Invalid key" } })).toBe(
      false,
    );
    expect(
      shouldRetryWithoutSchema("deepseek", 400, { error: { message: "Unsupported schema" } }),
    ).toBe(false);
  });
});

describe("buildVerificationRequest", () => {
  // Ported from tests/ai-providers.test.js:124-136 in v1.1.0 (c2f8b71).
  it("builds low-cost verification requests", () => {
    const openAI = buildVerificationRequest("openai", apiKey, "gpt-5.6-terra");
    expect(openAI.options.method).toBe("GET");
    expect(openAI.url).toMatch(/\/v1\/models\/gpt-5.6-terra$/);

    const xAI = buildVerificationRequest("xai", apiKey, "grok-4.6");
    expect(xAI.options.method).toBe("GET");
    expect(xAI.url).toBe("https://api.x.ai/v1/models");
    expect(xAI.expectedModel).toBe("grok-4.6");

    const deepSeek = buildVerificationRequest("deepseek", apiKey, "deepseek-v4-flash");
    const body = JSON.parse(String(deepSeek.options.body));
    expect(deepSeek.options.method).toBe("POST");
    expect(body.max_tokens).toBe(8);
  });
});
