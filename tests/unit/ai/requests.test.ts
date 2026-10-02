import { describe, expect, it } from "vitest";
import { shouldRetryWithoutSchema } from "@/ai/errors";
import { PROVIDER_IDS, PROVIDERS } from "@/ai/providers";
import {
  buildGenerationRequest,
  buildModelListRequest,
  buildVerificationRequest,
} from "@/ai/requests";
import { ANSWER_SCHEMA } from "@/ai/schemas";
import type { ProviderId, ReasoningEffort } from "@/shared/types";

const apiKey = "test-secret";
const prompt = "Return JSON.";
const serverUrl = "http://localhost:8000/v1";

describe("buildGenerationRequest", () => {
  // Ported from tests/ai-providers.test.js:27-42 in v1.1.0 (c2f8b71).
  it("builds authenticated generation requests for every hosted provider", () => {
    for (const providerId of PROVIDER_IDS.filter((id) => !PROVIDERS[id].selfHosted)) {
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

  it("sends vLLM chat completions with a strict JSON schema to the configured server", () => {
    const request = buildGenerationRequest("vllm", "token-abc", "Qwen/Qwen3-8B", prompt, {
      structured: true,
      baseUrl: serverUrl,
    });
    const body = JSON.parse(String(request.options.body));

    expect(request.url).toBe("http://localhost:8000/v1/chat/completions");
    expect(request.options.headers.Authorization).toBe("Bearer token-abc");
    expect(body.model).toBe("Qwen/Qwen3-8B");
    expect(body.messages).toEqual([{ role: "user", content: prompt }]);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "quiz_answers", strict: true, schema: ANSWER_SCHEMA },
    });
    // A proxy in front of the server can drop a reply that sends nothing for a minute.
    expect(body.stream).toBe(true);
  });

  it("asks the hosted chat-completions providers for one reply", () => {
    for (const providerId of ["xai", "deepseek", "groq", "openrouter"] as const) {
      const body = JSON.parse(
        String(buildGenerationRequest(providerId, apiKey, "model", prompt).options.body),
      );
      expect(body.stream).toBe(false);
    }
  });

  it("calls a vLLM server started without --api-key with no Authorization header", () => {
    const request = buildGenerationRequest("vllm", "", "Qwen/Qwen3-8B", prompt, {
      baseUrl: serverUrl,
    });
    expect(request.options.headers).not.toHaveProperty("Authorization");
  });

  it("refuses a vLLM request without a server URL", () => {
    expect(() => buildGenerationRequest("vllm", "", "Qwen/Qwen3-8B", prompt)).toThrow(
      "Enter the server URL with http:// or https://",
    );
  });

  it("attaches labelled images in each provider's own message format", () => {
    const images = [{ label: "Question 2 image 1", mediaType: "image/png", data: "iVBORw0KGgo=" }];
    const body = (providerId: ProviderId) =>
      JSON.parse(
        String(
          buildGenerationRequest(providerId, apiKey, "model", prompt, {
            images,
            baseUrl: serverUrl,
          }).options.body,
        ),
      );

    expect(body("gemini").contents).toEqual([
      {
        role: "user",
        parts: [
          { text: prompt },
          { text: "Question 2 image 1" },
          { inline_data: { mime_type: "image/png", data: "iVBORw0KGgo=" } },
        ],
      },
    ]);
    expect(body("openai").input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: prompt },
          { type: "input_text", text: "Question 2 image 1" },
          { type: "input_image", image_url: "data:image/png;base64,iVBORw0KGgo=" },
        ],
      },
    ]);
    expect(body("anthropic").messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "text", text: "Question 2 image 1" },
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" },
          },
        ],
      },
    ]);
    for (const providerId of ["xai", "groq", "openrouter", "vllm"] as const) {
      expect(body(providerId).messages).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "text", text: "Question 2 image 1" },
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
          ],
        },
      ]);
    }
  });

  it("sends the prompt as plain text when there are no images", () => {
    const body = (providerId: ProviderId) =>
      JSON.parse(String(buildGenerationRequest(providerId, apiKey, "model", prompt).options.body));

    expect(body("gemini").contents).toEqual([{ role: "user", parts: [{ text: prompt }] }]);
    expect(body("openai").input).toBe(prompt);
    expect(body("anthropic").messages).toEqual([{ role: "user", content: prompt }]);
    // DeepSeek accepts only string content.
    expect(body("deepseek").messages).toEqual([{ role: "user", content: prompt }]);
  });

  it("sends the reasoning effort in each provider's own field", () => {
    const body = (providerId: ProviderId, model: string, effort: ReasoningEffort = "low") =>
      JSON.parse(
        String(
          buildGenerationRequest(providerId, apiKey, model, prompt, { effort, baseUrl: serverUrl })
            .options.body,
        ),
      );

    // Gemini 3 thinks by level, at the default temperature Google asks for with thinking.
    expect(body("gemini", "gemini-3.7-flash").generationConfig).toEqual({
      responseMimeType: "application/json",
      responseSchema: ANSWER_SCHEMA,
      thinkingConfig: { thinkingLevel: "low" },
    });
    // Gemini 2.5 thinks by token budget, up to 24576 tokens on 2.5 Flash.
    expect(body("gemini", "gemini-2.5-flash", "high").generationConfig).toEqual({
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: ANSWER_SCHEMA,
      thinkingConfig: { thinkingBudget: 24576 },
    });
    expect(body("openai", "gpt-5.6-terra").reasoning).toEqual({ effort: "low" });
    expect(body("anthropic", "claude-sonnet-5").output_config).toEqual({
      format: { type: "json_schema", schema: ANSWER_SCHEMA },
      effort: "low",
    });
    expect(body("openrouter", "~openai/gpt-latest").reasoning).toEqual({ effort: "low" });
    for (const [providerId, model] of [
      ["xai", "grok-4.6"],
      ["deepseek", "deepseek-v4-flash"],
      ["groq", "openai/gpt-oss-120b"],
      ["vllm", "Qwen/Qwen3-8B"],
    ] as const) {
      expect(body(providerId, model).reasoning_effort).toBe("low");
    }
    // vLLM hands "none" to the model's chat template, which turns thinking off.
    expect(body("vllm", "Qwen/Qwen3-8B", "none").reasoning_effort).toBe("none");
  });

  it("sends no effort to a model that takes none, nor when the request has none", () => {
    const body = (providerId: ProviderId, model: string, effort?: ReasoningEffort) =>
      JSON.parse(
        String(buildGenerationRequest(providerId, apiKey, model, prompt, { effort }).options.body),
      );

    expect(body("anthropic", "claude-haiku-4-5", "low").output_config).toEqual({
      format: { type: "json_schema", schema: ANSWER_SCHEMA },
    });
    expect(body("groq", "llama-3.3-70b-versatile", "low")).not.toHaveProperty("reasoning_effort");
    expect(body("openai", "gpt-5.6-terra")).not.toHaveProperty("reasoning");
    expect(body("gemini", "gemini-3.7-flash").generationConfig).not.toHaveProperty(
      "thinkingConfig",
    );
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

  it("checks a vLLM model against the server's model list", () => {
    const request = buildVerificationRequest("vllm", "", "Qwen/Qwen3-8B", serverUrl);
    expect(request.url).toBe("http://localhost:8000/v1/models");
    expect(request.options.method).toBe("GET");
    expect(request.expectedModel).toBe("Qwen/Qwen3-8B");
  });
});

describe("buildModelListRequest", () => {
  it("lists a vLLM server's models with its key", () => {
    const request = buildModelListRequest("vllm", "token-abc", "http://gpu.lan:8000");
    expect(request.url).toBe("http://gpu.lan:8000/v1/models");
    expect(request.options.method).toBe("GET");
    expect(request.options.headers.Authorization).toBe("Bearer token-abc");
  });
});
