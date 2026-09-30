import { browser } from "wxt/browser";

const KEEPALIVE_INTERVAL_MS = 20_000;

// Extension API calls reset the worker's 30 s fetch deadline: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
export async function withKeepAlive<T>(
  work: () => Promise<T>,
  {
    intervalMs = KEEPALIVE_INTERVAL_MS,
    ping = () => browser.runtime.getPlatformInfo(),
  }: { intervalMs?: number; ping?: () => Promise<unknown> } = {},
): Promise<T> {
  const timer = setInterval(async () => {
    try {
      await ping();
    } catch {
      // A failed ping only skips this extension of the worker's lifetime.
    }
  }, intervalMs);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
