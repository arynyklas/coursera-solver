import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { createMonacoClient } from "@/content/monaco-client";
import { BRIDGE, isValidRequestId, type MonacoRequest } from "@/shared/bridge";

const ORIGIN = "https://www.coursera.org";
const MODEL_URI = "inmemory://model/7";

function fakeWindow(origin = ORIGIN) {
  const listeners = new Set<(event: MessageEvent) => void>();
  const postMessage: Mock = vi.fn();
  const win = {
    location: { href: `${origin}/learn/sample/quiz`, origin },
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage,
  } as unknown as Window;

  return {
    win,
    postMessage,
    lastRequest(): MonacoRequest {
      return postMessage.mock.calls.at(-1)?.[0] as MonacoRequest;
    },
    emit(data: unknown, eventOrigin = origin) {
      const event = new MessageEvent("message", {
        data,
        origin: eventOrigin,
        source: win as unknown as MessageEventSource,
      });
      for (const listener of [...listeners]) listener(event);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

// Ported from tests/monaco-bridge.test.js:88-148 in v1.1.0 (c2f8b71); the new client supports
// read and replace.
describe("createMonacoClient", () => {
  it("rejects a foreign model URI for read and replace without posting", async () => {
    const page = fakeWindow();
    const client = createMonacoClient(page.win);

    await expect(client.read("file:///tmp/x")).rejects.toThrow(
      "A supported Monaco model URI is required.",
    );
    await expect(client.replace("file:///tmp/x", "old", "new")).rejects.toThrow(
      "A supported Monaco model URI is required.",
    );
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  it.each(["null", ""])("requires a concrete page origin (origin %j)", async (origin) => {
    const page = fakeWindow(origin);
    const client = createMonacoClient(page.win);

    await expect(client.read(MODEL_URI)).rejects.toThrow(
      "A concrete page origin is required for the Monaco bridge.",
    );
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  it("posts one read request to the page origin and resolves only the matching same-origin response", async () => {
    const page = fakeWindow();
    const client = createMonacoClient(page.win, { timeoutMs: 200 });
    const pending = client.read(MODEL_URI);

    expect(page.postMessage).toHaveBeenCalledTimes(1);
    const [message, targetOrigin] = page.postMessage.mock.calls[0] ?? [];
    expect(targetOrigin).toBe(ORIGIN);
    expect(message).toMatchObject({
      source: BRIDGE.monacoRequest,
      action: "read-model",
      modelUri: MODEL_URI,
    });
    const { requestId } = page.lastRequest();
    expect(isValidRequestId(requestId)).toBe(true);

    const settled = vi.fn();
    pending.then(settled, settled);
    page.emit(
      { source: BRIDGE.monacoResponse, requestId, ok: true, value: "wrong-origin" },
      "https://example.com",
    );
    page.emit({ source: BRIDGE.monacoResponse, requestId: "wrong-id", ok: true, value: "ignored" });
    page.emit({ source: BRIDGE.monacoRequest, requestId, ok: true, value: "wrong-source" });
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    page.emit({ source: BRIDGE.monacoResponse, requestId, ok: true, value: "print('ok')" });
    await expect(pending).resolves.toBe("print('ok')");
  });

  it("reads a missing value as an empty string", async () => {
    const page = fakeWindow();
    const pending = createMonacoClient(page.win).read(MODEL_URI);

    page.emit({ source: BRIDGE.monacoResponse, requestId: page.lastRequest().requestId, ok: true });

    await expect(pending).resolves.toBe("");
  });

  it("sends the expected and replacement values with a replace request", async () => {
    const page = fakeWindow();
    const pending = createMonacoClient(page.win).replace(MODEL_URI, "old code", "new code");

    const request = page.lastRequest();
    expect(request).toMatchObject({
      source: BRIDGE.monacoRequest,
      action: "replace-model",
      modelUri: MODEL_URI,
      expectedValue: "old code",
      value: "new code",
    });
    page.emit({ source: BRIDGE.monacoResponse, requestId: request.requestId, ok: true });

    await expect(pending).resolves.toBeUndefined();
  });

  it("uses a fresh request id for every request", () => {
    const page = fakeWindow();
    const client = createMonacoClient(page.win);

    void client.read(MODEL_URI).catch(() => {});
    void client.read(MODEL_URI).catch(() => {});

    const [first, second] = page.postMessage.mock.calls.map(([message]) => message.requestId);
    expect(first).not.toBe(second);
  });

  it("rejects with the host error when the response is not ok", async () => {
    const page = fakeWindow();
    const pending = createMonacoClient(page.win).replace(MODEL_URI, "old", "new");

    page.emit({
      source: BRIDGE.monacoResponse,
      requestId: page.lastRequest().requestId,
      ok: false,
      error: "The code changed while the AI answer was being generated.",
    });

    await expect(pending).rejects.toThrow(
      "The code changed while the AI answer was being generated.",
    );
  });

  it("rejects when no response arrives within the timeout", async () => {
    vi.useFakeTimers();
    const page = fakeWindow();
    const pending = createMonacoClient(page.win, { timeoutMs: 300 }).read(MODEL_URI);
    const rejected = expect(pending).rejects.toThrow("Coursera's code editor did not respond.");

    await vi.advanceTimersByTimeAsync(299);
    const settled = vi.fn();
    pending.then(settled, settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await rejected;
  });

  it("never waits less than 50 ms", async () => {
    vi.useFakeTimers();
    const page = fakeWindow();
    const pending = createMonacoClient(page.win, { timeoutMs: 10 }).read(MODEL_URI);
    const settled = vi.fn();
    pending.then(settled, settled);

    await vi.advanceTimersByTimeAsync(49);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toThrow("Coursera's code editor did not respond.");
  });
});
