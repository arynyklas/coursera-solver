import type { ProviderId } from "@/shared/types";
import { normalizeServerUrl } from "./endpoint";
import { getProvider } from "./providers";
import { ANSWER_SCHEMA, type JsonSchema } from "./schemas";

export interface RequestSpec {
  url: string;
  options: { method: "GET" | "POST"; headers: Record<string, string>; body?: string };
}

export interface VerificationRequestSpec extends RequestSpec {
  expectedModel?: string;
}

function authHeaders(providerId: ProviderId, apiKey: string): Record<string, string> {
  if (providerId === "gemini") {
    return { "Content-Type": "application/json", "x-goog-api-key": apiKey };
  }
  if (providerId === "anthropic") {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // A self-hosted server started without --api-key accepts requests that carry no key.
  if (apiKey || !getProvider(providerId).selfHosted) headers.Authorization = `Bearer ${apiKey}`;
  if (providerId === "openrouter") {
    headers["X-OpenRouter-Title"] = "Coursera Auto Solver";
  }
  return headers;
}

export function buildGenerationRequest(
  providerId: ProviderId,
  apiKey: string,
  model: string,
  prompt: string,
  options: {
    structured?: boolean;
    schema?: JsonSchema;
    schemaName?: string;
    /** The server URL of a self-hosted provider. */
    baseUrl?: string;
  } = {},
): RequestSpec {
  const {
    structured = true,
    schema = ANSWER_SCHEMA,
    schemaName = "quiz_answers",
    baseUrl = "",
  } = options;
  getProvider(providerId);
  const headers = authHeaders(providerId, apiKey);

  if (providerId === "gemini") {
    const generationConfig: Record<string, unknown> = {
      temperature: 0.1,
      responseMimeType: "application/json",
    };
    if (structured) generationConfig.responseSchema = schema;
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      options: {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig,
        }),
      },
    };
  }

  if (providerId === "openai") {
    const format = structured
      ? { type: "json_schema", name: schemaName, strict: true, schema }
      : { type: "json_object" };
    return {
      url: "https://api.openai.com/v1/responses",
      options: {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: prompt, text: { format }, store: false }),
      },
    };
  }

  if (providerId === "anthropic") {
    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    };
    if (structured) {
      body.output_config = { format: { type: "json_schema", schema } };
    }
    return {
      url: "https://api.anthropic.com/v1/messages",
      options: { method: "POST", headers, body: JSON.stringify(body) },
    };
  }

  const apiRoot =
    providerId === "vllm"
      ? normalizeServerUrl(baseUrl)
      : {
          xai: "https://api.x.ai/v1",
          deepseek: "https://api.deepseek.com",
          groq: "https://api.groq.com/openai/v1",
          openrouter: "https://openrouter.ai/api/v1",
        }[providerId];
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };

  if (providerId === "xai" || providerId === "openrouter" || providerId === "vllm") {
    body.response_format = structured
      ? { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } }
      : { type: "json_object" };
  } else {
    body.response_format = { type: "json_object" };
  }

  if (providerId === "deepseek") body.temperature = 0.1;
  if (providerId === "groq") body.max_completion_tokens = 4096;
  if (providerId === "openrouter" && structured) {
    body.provider = { require_parameters: true };
  }

  return {
    url: `${apiRoot}/chat/completions`,
    options: { method: "POST", headers, body: JSON.stringify(body) },
  };
}

/** The model list of a self-hosted server. Listing needs the same key as generating. */
export function buildModelListRequest(
  providerId: ProviderId,
  apiKey: string,
  baseUrl: string,
): RequestSpec {
  return {
    url: `${normalizeServerUrl(baseUrl)}/models`,
    options: { method: "GET", headers: authHeaders(providerId, apiKey) },
  };
}

export function buildVerificationRequest(
  providerId: ProviderId,
  apiKey: string,
  model: string,
  baseUrl = "",
): VerificationRequestSpec {
  getProvider(providerId);
  if (providerId === "vllm") {
    return { ...buildModelListRequest(providerId, apiKey, baseUrl), expectedModel: model };
  }
  const headers = authHeaders(providerId, apiKey);
  const metadataUrls: Partial<Record<ProviderId, string>> = {
    gemini: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
    openai: `https://api.openai.com/v1/models/${encodeURIComponent(model)}`,
    anthropic: `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`,
    xai: "https://api.x.ai/v1/models",
    groq: "https://api.groq.com/openai/v1/models",
  };

  const metadataUrl = metadataUrls[providerId];
  if (metadataUrl) {
    const spec: VerificationRequestSpec = { url: metadataUrl, options: { method: "GET", headers } };
    if (providerId === "xai" || providerId === "groq") spec.expectedModel = model;
    return spec;
  }

  const apiRoot =
    providerId === "deepseek" ? "https://api.deepseek.com" : "https://openrouter.ai/api/v1";
  return {
    url: `${apiRoot}/chat/completions`,
    options: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with exactly OK." }],
        max_tokens: 8,
        stream: false,
      }),
    },
  };
}
