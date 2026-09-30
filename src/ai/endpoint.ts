const INVALID_SERVER_URL =
  "Enter the server URL with http:// or https://, for example http://localhost:8000/v1.";

/**
 * The OpenAI-compatible API root of a self-hosted server, e.g. `http://localhost:8000/v1`.
 * A bare address gets vLLM's `/v1`; a pasted `/models` or `/chat/completions` endpoint is cut
 * back to its root. Query, fragment and credentials are dropped.
 */
export function normalizeServerUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(INVALID_SERVER_URL);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(INVALID_SERVER_URL);
  const path = url.pathname.replace(/\/+$/, "").replace(/\/(?:models|chat\/completions)$/, "");
  return `${url.origin}${path || "/v1"}`;
}

/** The host permission pattern that covers a normalized server URL's origin. */
export function serverOriginPattern(serverUrl: string): string {
  return `${new URL(serverUrl).origin}/*`;
}
