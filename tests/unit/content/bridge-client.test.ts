import { describe, expect, it, type Mock, vi } from "vitest";
import { connectBridge } from "@/content/bridge-client";
import { BRIDGE, type Capture, type CaptureSnapshot } from "@/shared/bridge";

const ORIGIN = "https://www.coursera.org";

const CAPTURE: Capture = {
  url: `${ORIGIN}/api/onDemandCourseMaterials.v2/`,
  method: "GET",
  headerNames: ["x-csrf3-token"],
  csrf3Token: "token",
};

const SNAPSHOT: CaptureSnapshot = { csrf3Token: "token", userId: "42", headerNames: [] };

function connect() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const postMessage: Mock = vi.fn();
  const win = {
    location: { href: `${ORIGIN}/learn/sample/home`, origin: ORIGIN },
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage,
  } as unknown as Window;
  const onCapture = vi.fn();
  const onSnapshot = vi.fn();
  const disconnect = connectBridge(win, { onCapture, onSnapshot });

  return {
    postMessage,
    onCapture,
    onSnapshot,
    disconnect,
    emit(data: unknown, options: { origin?: string; source?: unknown } = {}) {
      const event = new MessageEvent("message", {
        data,
        origin: options.origin ?? ORIGIN,
        source: (options.source ?? win) as MessageEventSource,
      });
      for (const listener of [...listeners]) listener(event);
    },
  };
}

describe("connectBridge", () => {
  it("says hello to the page origin exactly once", () => {
    const bridge = connect();

    expect(bridge.postMessage).toHaveBeenCalledTimes(1);
    expect(bridge.postMessage).toHaveBeenCalledWith({ source: BRIDGE.hello }, ORIGIN);
  });

  it("forwards a same-window, same-origin capture", () => {
    const bridge = connect();

    bridge.emit({ source: BRIDGE.capture, capture: CAPTURE });

    expect(bridge.onCapture).toHaveBeenCalledExactlyOnceWith(CAPTURE);
    expect(bridge.onSnapshot).not.toHaveBeenCalled();
  });

  it("forwards the snapshot answer", () => {
    const bridge = connect();

    bridge.emit({ source: BRIDGE.snapshot, snapshot: SNAPSHOT });

    expect(bridge.onSnapshot).toHaveBeenCalledExactlyOnceWith(SNAPSHOT);
    expect(bridge.onCapture).not.toHaveBeenCalled();
  });

  it("ignores captures from another origin or another window", () => {
    const bridge = connect();

    bridge.emit({ source: BRIDGE.capture, capture: CAPTURE }, { origin: "https://example.com" });
    bridge.emit({ source: BRIDGE.capture, capture: CAPTURE }, { source: {} });

    expect(bridge.onCapture).not.toHaveBeenCalled();
  });

  it("forwards nothing after disconnect", () => {
    const bridge = connect();

    bridge.disconnect();
    bridge.emit({ source: BRIDGE.capture, capture: CAPTURE });
    bridge.emit({ source: BRIDGE.snapshot, snapshot: SNAPSHOT });

    expect(bridge.onCapture).not.toHaveBeenCalled();
    expect(bridge.onSnapshot).not.toHaveBeenCalled();
  });
});
