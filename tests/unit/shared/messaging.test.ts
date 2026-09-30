import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  createMessageRouter,
  type MessageListener,
  REFRESH_PAGE_MESSAGE,
  type Reply,
  sendToTab,
} from "@/shared/messaging";

interface TestProtocol {
  echo: { request: { value: string }; response: { value: string } };
  fail: { request: Record<string, never>; response: never };
}

const fallbacks = { echo: "Echo failed.", fail: "Fail fallback." };

function invoke(listener: MessageListener, message: unknown) {
  return new Promise<{ handled: boolean; reply?: Reply<unknown> }>((resolve) => {
    const handled = listener(message, {}, (reply) => resolve({ handled, reply }));
    if (!handled) resolve({ handled });
  });
}

describe("createMessageRouter", () => {
  beforeEach(() => fakeBrowser.reset());

  it("routes a known type and replies with its data", async () => {
    const listener = createMessageRouter<TestProtocol>(
      {
        echo: async ({ value }) => ({ value: value.toUpperCase() }),
        fail: () => {
          throw new Error("x");
        },
      },
      fallbacks,
    );
    await expect(invoke(listener, { type: "echo", value: "hi" })).resolves.toEqual({
      handled: true,
      reply: { ok: true, data: { value: "HI" } },
    });
  });

  it("releases messages it does not own", async () => {
    const listener = createMessageRouter<TestProtocol>(
      {
        echo: ({ value }) => ({ value }),
        fail: () => {
          throw new Error("x");
        },
      },
      fallbacks,
    );
    await expect(invoke(listener, { type: "solveQuizDirectly" })).resolves.toEqual({
      handled: false,
    });
    await expect(invoke(listener, "echo")).resolves.toEqual({ handled: false });
    await expect(invoke(listener, null)).resolves.toEqual({ handled: false });
  });

  it("serializes only the trimmed error message and falls back when it is empty", async () => {
    const listener = createMessageRouter<TestProtocol>(
      {
        echo: () => {
          throw new Error("  read failed  ");
        },
        fail: () => {
          throw new Error("");
        },
      },
      fallbacks,
    );
    const failed = await invoke(listener, { type: "echo", value: "x" });
    expect(failed.reply).toEqual({ ok: false, error: "read failed" });
    expect(JSON.stringify(failed.reply)).not.toContain("stack");
    await expect(invoke(listener, { type: "fail" })).resolves.toEqual({
      handled: true,
      reply: { ok: false, error: "Fail fallback." },
    });
  });
});

function spyOnSendMessage() {
  // vi.spyOn types the last overload (callback form, returns void); sendToTab uses the promise form.
  const sendMessage = vi.spyOn(browser.tabs, "sendMessage") as unknown as Mock<
    () => Promise<unknown>
  >;
  return sendMessage;
}

describe("sendToTab", () => {
  beforeEach(() => fakeBrowser.reset());

  // F9: legacy popup.js:330/538/579 showed Chrome's raw "Receiving end does not exist" text.
  it("maps a missing content script to the refresh instruction", async () => {
    spyOnSendMessage().mockRejectedValue(
      new Error("Could not establish connection. Receiving end does not exist."),
    );
    await expect(sendToTab(7, "getQuestions", {})).rejects.toThrow(REFRESH_PAGE_MESSAGE);
  });

  it("rejects with the content script's error message", async () => {
    spyOnSendMessage().mockResolvedValue({ ok: false, error: "No questions." });
    await expect(sendToTab(7, "getQuestions", {})).rejects.toThrow("No questions.");
  });

  it("resolves with the reply data", async () => {
    spyOnSendMessage().mockResolvedValue({ ok: true, data: { questions: [], issues: [] } });
    await expect(sendToTab(7, "getQuestions", {})).resolves.toEqual({ questions: [], issues: [] });
  });
});
