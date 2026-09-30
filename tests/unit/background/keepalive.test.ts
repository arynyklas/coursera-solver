import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { withKeepAlive } from "@/background/keepalive";

// FR-I3 (final review): Chrome stops the service worker when a fetch() response takes over 30 s,
// so a slow model killed the worker long before the 120 s AI timeout applied.
describe("withKeepAlive", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pings every 20 s while the work is pending and stops once it resolves", async () => {
    const ping = vi.fn(async () => {});
    const { promise, resolve } = Promise.withResolvers<string>();

    const result = withKeepAlive(() => promise, { ping });
    await vi.advanceTimersByTimeAsync(65_000);
    expect(ping).toHaveBeenCalledTimes(3);

    resolve("answers");
    await expect(result).resolves.toBe("answers");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("stops pinging and rethrows when the work rejects", async () => {
    const ping = vi.fn(async () => {});
    const { promise, reject } = Promise.withResolvers<string>();

    const result = withKeepAlive(() => promise, { ping });
    const rejection = expect(result).rejects.toThrow("Gemini did not respond");
    await vi.advanceTimersByTimeAsync(25_000);
    reject(new Error("Gemini did not respond"));
    await rejection;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("keeps the work running when a ping fails", async () => {
    const ping = vi.fn(async () => {
      throw new Error("Extension context invalidated.");
    });
    const { promise, resolve } = Promise.withResolvers<string>();

    const result = withKeepAlive(() => promise, { ping, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_500);
    resolve("answers");

    await expect(result).resolves.toBe("answers");
    expect(ping).toHaveBeenCalledTimes(3);
  });

  it("survives the default ping failing", async () => {
    // fakeBrowser does not implement runtime.getPlatformInfo, so every default ping throws.
    const { promise, resolve } = Promise.withResolvers<string>();

    const result = withKeepAlive(() => promise);
    await vi.advanceTimersByTimeAsync(45_000);
    resolve("answers");

    await expect(result).resolves.toBe("answers");
  });
});
