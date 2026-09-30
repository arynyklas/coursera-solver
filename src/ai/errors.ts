import type { ProviderId } from "@/shared/types";
import { getProvider } from "./providers";

type ErrorBody =
  | { error?: { message?: unknown }; message?: unknown; error_description?: unknown }
  | null
  | undefined;

export function shouldRetryWithoutSchema(
  providerId: ProviderId,
  status: number,
  data: unknown,
): boolean {
  if (!getProvider(providerId).supportsStrictSchema || ![400, 422].includes(status)) return false;
  const message = JSON.stringify(data || {}).toLowerCase();
  return [
    "schema",
    "structured",
    "response_format",
    "response format",
    "unsupported",
    "parameter",
  ].some((term) => message.includes(term));
}

export function providerErrorMessage(
  providerId: ProviderId,
  status: number,
  data: unknown,
): string {
  const provider = getProvider(providerId);
  const label = provider.label;
  const body = data as ErrorBody;
  const serverMessage = body?.error?.message || body?.message || body?.error_description;
  if (provider.selfHosted) {
    if (status === 401 || status === 403) return `The ${label} server rejected the API key.`;
    // vLLM explains an unknown model; a bare 404 means nothing answers at that path.
    if (status === 404 && !serverMessage) return `No ${label} API was found at this server URL.`;
  } else {
    if (status === 401 || status === 403)
      return `${label} rejected the API key or account permissions.`;
    if (status === 404) return `The selected ${label} model is unavailable for this account.`;
  }
  if (status === 429) return `${label} rate limit or quota reached. Try again later.`;
  if (status >= 500) return `${label} is temporarily unavailable. Try again later.`;
  if (serverMessage) return `${label}: ${serverMessage}`;
  return `${label} request failed with HTTP ${status}.`;
}
