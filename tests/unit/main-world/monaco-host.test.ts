import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { installMonacoHost } from "@/main-world/monaco-host";
import { BRIDGE } from "@/shared/bridge";

const ORIGIN = "https://www.coursera.org";
const MODEL_URI = "inmemory://model/1";
const RANGE = { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 2 };

function createModel(value = "old code") {
  return {
    uri: { toString: () => MODEL_URI },
    getValue: () => value,
    getFullModelRange: () => RANGE,
    pushEditOperations: vi.fn(),
    pushStackElement: vi.fn(),
  };
}

function createHost(models: unknown[]) {
  const listeners: Array<(event: MessageEvent) => void> = [];
  const postMessage: Mock = vi.fn();
  const win = {
    location: { href: `${ORIGIN}/learn/sample/home`, origin: ORIGIN },
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") listeners.push(listener);
    },
    postMessage,
    monaco: { editor: { getModels: () => models } },
  } as unknown as Window & typeof globalThis;
  installMonacoHost(win);

  return {
    postMessage,
    request(payload: Record<string, unknown>) {
      const event = new MessageEvent("message", {
        data: { source: BRIDGE.monacoRequest, modelUri: MODEL_URI, ...payload },
        origin: ORIGIN,
        source: win as unknown as MessageEventSource,
      });
      for (const listener of listeners) listener(event);
    },
  };
}

describe("installMonacoHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the model value", async () => {
    const host = createHost([createModel("print(1)")]);

    host.request({ requestId: "req-1", action: "read-model" });
    await vi.advanceTimersByTimeAsync(0);

    expect(host.postMessage).toHaveBeenCalledWith(
      { source: BRIDGE.monacoResponse, requestId: "req-1", ok: true, value: "print(1)" },
      ORIGIN,
    );
  });

  it("refuses to replace code that changed since it was read", async () => {
    const model = createModel("edited by learner");
    const host = createHost([model]);

    host.request({
      requestId: "req-2",
      action: "replace-model",
      value: "answer",
      expectedValue: "old code",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(host.postMessage).toHaveBeenCalledWith(
      {
        source: BRIDGE.monacoResponse,
        requestId: "req-2",
        ok: false,
        error: "The code changed while the AI answer was being generated.",
      },
      ORIGIN,
    );
    expect(model.pushEditOperations).not.toHaveBeenCalled();
  });

  it("replaces the full model range when the expected value matches", async () => {
    const model = createModel("old code");
    const host = createHost([model]);

    host.request({
      requestId: "req-3",
      action: "replace-model",
      value: "answer",
      expectedValue: "old code",
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(model.pushEditOperations).toHaveBeenCalledTimes(1);
    expect(model.pushEditOperations).toHaveBeenCalledWith(
      [],
      [{ range: RANGE, text: "answer", forceMoveMarkers: true }],
      expect.any(Function),
    );
    expect(host.postMessage).toHaveBeenCalledWith(
      { source: BRIDGE.monacoResponse, requestId: "req-3", ok: true },
      ORIGIN,
    );
  });

  it("does not reply to an invalid request id", async () => {
    const host = createHost([createModel()]);

    host.request({ requestId: "bad id!", action: "read-model" });
    host.request({ requestId: "bad id!", action: "delete-model" });
    await vi.advanceTimersByTimeAsync(2000);

    expect(host.postMessage).not.toHaveBeenCalled();
  });

  it("rejects unsupported actions and foreign model URIs", async () => {
    const host = createHost([createModel()]);

    host.request({ requestId: "req-4", action: "delete-model" });
    host.request({ requestId: "req-5", action: "read-model", modelUri: "file:///x" });
    await vi.advanceTimersByTimeAsync(0);

    expect(host.postMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        source: BRIDGE.monacoResponse,
        requestId: "req-4",
        ok: false,
        error: "Unsupported Monaco action.",
      },
      {
        source: BRIDGE.monacoResponse,
        requestId: "req-5",
        ok: false,
        error: "Invalid Monaco model URI.",
      },
    ]);
  });

  it("reports the editor as not ready when the model never appears within 2000 ms", async () => {
    const host = createHost([]);

    host.request({ requestId: "req-6", action: "read-model" });
    await vi.advanceTimersByTimeAsync(1900);
    expect(host.postMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(host.postMessage).toHaveBeenCalledWith(
      {
        source: BRIDGE.monacoResponse,
        requestId: "req-6",
        ok: false,
        error: "Coursera's code editor is not ready.",
      },
      ORIGIN,
    );
  });

  it("finds a model that appears while polling", async () => {
    const models: unknown[] = [];
    const host = createHost(models);

    host.request({ requestId: "req-7", action: "read-model" });
    await vi.advanceTimersByTimeAsync(500);
    models.push(createModel("late"));
    await vi.advanceTimersByTimeAsync(100);

    expect(host.postMessage).toHaveBeenCalledWith(
      { source: BRIDGE.monacoResponse, requestId: "req-7", ok: true, value: "late" },
      ORIGIN,
    );
  });
});
