import { describe, expect, it, type Mock, vi } from "vitest";
import {
  BRIDGE,
  type BridgeMessage,
  isValidModelUri,
  isValidRequestId,
  postBridgeMessage,
  readBridgeMessage,
} from "@/shared/bridge";

const ORIGIN = "https://www.coursera.org";

function fakeWindow(origin = ORIGIN) {
  return { location: { origin }, postMessage: vi.fn() } as unknown as Window & {
    postMessage: Mock;
  };
}

function messageEvent(data: unknown, origin: string, source: unknown) {
  return new MessageEvent("message", { data, origin, source: source as MessageEventSource });
}

describe("readBridgeMessage", () => {
  const hello = { source: BRIDGE.hello };

  it("returns the data for the same window, same origin and requested tag", () => {
    const win = fakeWindow();
    expect(readBridgeMessage(messageEvent(hello, ORIGIN, win), win, BRIDGE.hello)).toEqual(hello);
  });

  it("rejects messages from another window", () => {
    const win = fakeWindow();
    expect(
      readBridgeMessage(messageEvent(hello, ORIGIN, fakeWindow()), win, BRIDGE.hello),
    ).toBeNull();
  });

  it("rejects messages from another origin", () => {
    const win = fakeWindow();
    expect(
      readBridgeMessage(messageEvent(hello, "https://evil.com", win), win, BRIDGE.hello),
    ).toBeNull();
  });

  it("rejects messages with another tag", () => {
    const win = fakeWindow();
    expect(readBridgeMessage(messageEvent(hello, ORIGIN, win), win, BRIDGE.snapshot)).toBeNull();
  });

  it("rejects non-object data", () => {
    const win = fakeWindow();
    expect(
      readBridgeMessage(messageEvent(BRIDGE.hello, ORIGIN, win), win, BRIDGE.hello),
    ).toBeNull();
    expect(readBridgeMessage(messageEvent(null, ORIGIN, win), win, BRIDGE.hello)).toBeNull();
  });
});

describe("isValidModelUri", () => {
  // Ported from legacy/tests/monaco-bridge.test.js:63-67.
  it("accepts only Coursera in-memory Monaco model URIs", () => {
    expect(isValidModelUri("inmemory://model/42")).toBe(true);
    expect(isValidModelUri("file:///x")).toBe(false);
    expect(isValidModelUri("")).toBe(false);
    expect(isValidModelUri(42)).toBe(false);
  });
});

describe("isValidRequestId", () => {
  it("accepts short alphanumeric-dash ids only", () => {
    expect(isValidRequestId("monaco-1-2")).toBe(true);
    expect(isValidRequestId("bad id!")).toBe(false);
    expect(isValidRequestId("a".repeat(81))).toBe(false);
  });
});

describe("postBridgeMessage", () => {
  const message: BridgeMessage = { source: BRIDGE.hello };

  it("posts to the exact page origin", () => {
    const win = fakeWindow();
    postBridgeMessage(win, message);
    expect(win.postMessage).toHaveBeenCalledWith(message, ORIGIN);
  });

  // Ported from legacy/tests/monaco-bridge.test.js:106-116.
  it.each(["null", ""])("requires a concrete page origin (origin %j)", (origin) => {
    const win = fakeWindow(origin);
    expect(() => postBridgeMessage(win, message)).toThrow(
      "A concrete page origin is required for the Monaco bridge.",
    );
    expect(win.postMessage).not.toHaveBeenCalled();
  });
});
