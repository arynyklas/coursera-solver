import type { ProviderId } from "@/shared/types";
import { providerErrorMessage, shouldRetryWithoutSchema } from "./errors";
import { getProvider } from "./providers";
import { buildGenerationRequest, type RequestSpec } from "./requests";
import { extractResponseText } from "./responses";
import type { JsonSchema } from "./schemas";

export const AI_TIMEOUT_MS = 120_000;

export interface ClientDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function requestJSON(
  spec: RequestSpec,
  providerId: ProviderId,
  deps: ClientDeps = {},
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const label = getProvider(providerId).label;
  const timeoutMs = deps.timeoutMs ?? AI_TIMEOUT_MS;
  const doFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const timeoutError = () =>
    new Error(
      `${label} did not respond within ${Math.round(timeoutMs / 1000)} seconds. Try again.`,
    );

  try {
    let response: Response;
    try {
      response = await doFetch(spec.url, { ...spec.options, signal: controller.signal });
    } catch {
      if (timedOut) throw timeoutError();
      throw new Error(`Could not reach ${label}. Check your connection and try again.`);
    }

    let rawBody: string;
    try {
      rawBody = await response.text();
    } catch (error) {
      if (timedOut) throw timeoutError();
      throw error;
    }

    let data: unknown = {};
    if (rawBody) {
      try {
        data = JSON.parse(rawBody);
      } catch {
        data = { message: rawBody.slice(0, 300) };
      }
    }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function callProvider(
  call: {
    provider: ProviderId;
    apiKey: string;
    model: string;
    prompt: string;
    schema: JsonSchema;
    schemaName: string;
  },
  deps: ClientDeps = {},
): Promise<string> {
  const { provider: providerId, apiKey, model, prompt, schema, schemaName } = call;
  const provider = getProvider(providerId);
  const structured = provider.supportsStrictSchema;
  let result = await requestJSON(
    buildGenerationRequest(providerId, apiKey, model, prompt, { structured, schema, schemaName }),
    providerId,
    deps,
  );

  if (
    !result.ok &&
    structured &&
    shouldRetryWithoutSchema(providerId, result.status, result.data)
  ) {
    result = await requestJSON(
      buildGenerationRequest(providerId, apiKey, model, prompt, {
        structured: false,
        schema,
        schemaName,
      }),
      providerId,
      deps,
    );
  }

  if (!result.ok) {
    throw new Error(providerErrorMessage(providerId, result.status, result.data));
  }

  const rawText = extractResponseText(providerId, result.data);
  if (!rawText) {
    throw new Error(`${provider.label} returned an empty or unsupported response.`);
  }
  return rawText;
}
