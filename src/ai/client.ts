import { browser } from "wxt/browser";
import type { ProviderId } from "@/shared/types";
import { serverOriginPattern } from "./endpoint";
import { providerErrorMessage, shouldRetryWithoutSchema } from "./errors";
import type { ImageAttachment } from "./images";
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
  const provider = getProvider(providerId);
  const label = provider.label;
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
      if (!provider.selfHosted) {
        throw new Error(`Could not reach ${label}. Check your connection and try again.`);
      }
      // Without host access Chrome applies CORS, so a server that does not allow the
      // extension's origin fails here just like a server that is down.
      const host = new URL(spec.url).host;
      const hasAccess = await browser.permissions.contains({
        origins: [serverOriginPattern(spec.url)],
      });
      throw new Error(
        hasAccess
          ? `Could not reach the ${label} server at ${host}. Check the server URL and that the server is running.`
          : `Allow access to ${host}: open the AI provider settings and click Load models.`,
      );
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
    /** The server URL of a self-hosted provider. */
    baseUrl?: string;
    /**
     * Images to send after the prompt. A model that rejects them gets the request again without
     * them, with `promptWithoutImages`, which says they were left out.
     */
    images?: { attachments: ImageAttachment[]; promptWithoutImages: string };
  },
  deps: ClientDeps = {},
): Promise<string> {
  const { provider: providerId, apiKey, model, schema, schemaName, baseUrl } = call;
  const provider = getProvider(providerId);
  let structured = provider.supportsStrictSchema;
  let prompt = call.prompt;
  let images = call.images?.attachments ?? [];
  const send = () =>
    requestJSON(
      buildGenerationRequest(providerId, apiKey, model, prompt, {
        structured,
        schema,
        schemaName,
        baseUrl,
        images,
      }),
      providerId,
      deps,
    );

  let result = await send();
  // A strict schema the model cannot follow, then images it cannot read, are each dropped once.
  // An error that names images drops them first, so the schema stays.
  while (!result.ok) {
    // Providers word "this model takes no images" differently, so any request error counts.
    const imagesRefused = images.length > 0 && [400, 404, 413, 415, 422].includes(result.status);
    const namesImages =
      imagesRefused && /image|vision|multimodal/i.test(JSON.stringify(result.data));
    if (
      !namesImages &&
      structured &&
      shouldRetryWithoutSchema(providerId, result.status, result.data)
    ) {
      structured = false;
    } else if (imagesRefused) {
      images = [];
      prompt = call.images?.promptWithoutImages ?? call.prompt;
    } else {
      throw new Error(providerErrorMessage(providerId, result.status, result.data));
    }
    result = await send();
  }

  const rawText = extractResponseText(providerId, result.data);
  if (!rawText) {
    throw new Error(`${provider.label} returned an empty or unsupported response.`);
  }
  return rawText;
}
