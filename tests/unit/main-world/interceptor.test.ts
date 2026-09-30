import { describe, expect, it, type Mock, vi } from "vitest";
import { buildCapture, installInterceptor } from "@/main-world/interceptor";
import { BRIDGE } from "@/shared/bridge";

const ORIGIN = "https://www.coursera.org";

// Mirrors the FakeXHR in legacy/tests/intercept-integration.test.js:11-32, with real listener semantics.
class FakeXHRBase extends EventTarget {
  actualHeaders: [string, string][] = [];
  responseURL = "";
  responseText = "";
  contentType = "";

  open(_method: string, _url: string): void {}

  setRequestHeader(name: string, value: string): void {
    this.actualHeaders.push([String(name).toLowerCase(), String(value)]);
  }

  send(_body?: unknown): void {}

  getResponseHeader(name: string): string | null {
    return name.toLowerCase() === "content-type" ? this.contentType : null;
  }
}

function createWindow(originalFetch: (...args: unknown[]) => Promise<unknown>) {
  // A fresh subclass per window, so each install patches its own prototype.
  class FakeXHR extends FakeXHRBase {}

  const messageListeners: Array<(event: MessageEvent) => void> = [];
  const postMessage: Mock = vi.fn();
  const fakeWindow = {
    location: { href: `${ORIGIN}/learn/sample/home`, origin: ORIGIN },
    fetch: originalFetch,
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === "message") messageListeners.push(listener);
    },
    postMessage,
    XMLHttpRequest: FakeXHR,
    Headers,
    Request,
    URL,
  };
  const win = fakeWindow as unknown as Window & typeof globalThis;

  return {
    win,
    FakeXHR,
    postMessage,
    captures: () =>
      postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message.source === BRIDGE.capture),
    dispatchMessage(data: unknown, origin = ORIGIN) {
      const event = new MessageEvent("message", {
        data,
        origin,
        source: win as unknown as MessageEventSource,
      });
      for (const listener of messageListeners) listener(event);
    },
  };
}

function loadXhr(xhr: FakeXHRBase, url: string, responseText = "{}"): void {
  xhr.responseURL = url;
  xhr.contentType = "application/json";
  xhr.responseText = responseText;
  xhr.dispatchEvent(new Event("load"));
}

function hasKey(value: unknown, key: string): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([name, child]) => name === key || hasKey(child, key));
}

describe("installInterceptor", () => {
  // Ported from legacy/tests/intercept-integration.test.js:70-81.
  it("passive fetch inspection never replaces a successful page response with an interceptor error", async () => {
    const response = {
      url: "https://www.coursera.org/api/example.v1?slug=sample",
      clone() {
        throw new Error("synthetic clone failure");
      },
    };
    const { win } = createWindow(async () => response);
    installInterceptor(win);

    await expect(win.fetch(response.url)).resolves.toBe(response);
  });

  // Ported from legacy/tests/intercept-integration.test.js:83-110.
  it("XHR interception preserves page headers but retains only allowlisted metadata", () => {
    const { win, FakeXHR, postMessage, captures } = createWindow(async () => ({}));
    installInterceptor(win);

    const xhr = new FakeXHR();
    xhr.open("GET", "https://www.coursera.org/api/example.v1");
    xhr.setRequestHeader("Authorization", "Bearer private");
    xhr.setRequestHeader("X-CSRF3-Token", "csrf-value");
    xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
    xhr.send();
    loadXhr(xhr, "https://www.coursera.org/api/example.v1");

    expect(xhr.actualHeaders).toEqual([
      ["authorization", "Bearer private"],
      ["x-csrf3-token", "csrf-value"],
      ["x-requested-with", "XMLHttpRequest"],
    ]);
    expect(captures()).toEqual([
      {
        source: BRIDGE.capture,
        capture: {
          url: "https://www.coursera.org/api/example.v1",
          method: "GET",
          headerNames: ["x-csrf3-token", "x-requested-with"],
          csrf3Token: "csrf-value",
        },
      },
    ]);
    expect(JSON.stringify(postMessage.mock.calls).includes("Bearer private")).toBe(false);
  });

  it("merges duplicate allowlisted XHR headers", () => {
    const { win, FakeXHR, captures } = createWindow(async () => ({}));
    installInterceptor(win);

    const xhr = new FakeXHR();
    xhr.open("GET", "https://www.coursera.org/api/example.v1");
    xhr.setRequestHeader("X-CSRF3-Token", "a");
    xhr.setRequestHeader("x-csrf3-token", "b");
    xhr.send();
    loadXhr(xhr, "https://www.coursera.org/api/example.v1");

    expect(captures()[0].capture.csrf3Token).toBe("a, b");
  });

  // F6(a) guards legacy intercept.js:146-156, which awaited the clone before returning.
  it("resolves fetch before a never-settling clone read", async () => {
    const response = {
      url: "https://www.coursera.org/api/example.v1?slug=sample",
      headers: new Headers({ "content-type": "application/json" }),
      clone: () => ({ json: () => new Promise(() => {}) }),
    };
    const { win } = createWindow(async () => response);
    installInterceptor(win);

    await expect(win.fetch(response.url)).resolves.toBe(response);
  });

  // F6(b) guards legacy intercept.js:202, which added a load listener per send without `once`.
  it("emits one capture per send on a reused XHR", () => {
    const { win, FakeXHR, captures } = createWindow(async () => ({}));
    installInterceptor(win);
    const url = "https://www.coursera.org/api/onDemandCourses.v1?slug=course";

    const xhr = new FakeXHR();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      xhr.open("GET", url);
      xhr.send();
      loadXhr(xhr, url);
    }

    expect(captures()).toHaveLength(2);
  });

  // F6(c) guards legacy intercept.js, which kept no snapshot and ignored hello.
  it("answers hello with a token captured earlier", () => {
    const { win, FakeXHR, postMessage, dispatchMessage } = createWindow(async () => ({}));
    installInterceptor(win);

    const xhr = new FakeXHR();
    xhr.open("GET", "https://www.coursera.org/api/example.v1");
    xhr.setRequestHeader("x-csrf3-token", "token-1");
    xhr.send();
    loadXhr(xhr, "https://www.coursera.org/api/example.v1");
    postMessage.mockClear();

    dispatchMessage({ source: BRIDGE.hello });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      {
        source: "coursera-solver:snapshot",
        snapshot: { csrf3Token: "token-1", headerNames: ["x-csrf3-token"] },
      },
      ORIGIN,
    );
  });

  it("keeps the latest non-empty value of each snapshot field", () => {
    const { win, FakeXHR } = createWindow(async () => ({}));
    const handle = installInterceptor(win);
    const materialsUrl = "https://www.coursera.org/api/onDemandCourseMaterials.v2/?slug=course";
    const materials = {
      elements: [{ moduleIds: ["m-1"] }],
      linked: { "onDemandCourseMaterialItems.v2": [{ id: "item-1" }] },
    };

    const xhr = new FakeXHR();
    xhr.open("GET", materialsUrl);
    xhr.setRequestHeader("x-csrf3-token", "token-1");
    xhr.send();
    loadXhr(xhr, materialsUrl, JSON.stringify(materials));

    xhr.open("GET", "https://www.coursera.org/api/user/42/profile");
    xhr.setRequestHeader("x-requested-with", "XMLHttpRequest");
    xhr.send();
    loadXhr(xhr, "https://www.coursera.org/api/user/42/profile");

    xhr.open("GET", `${materialsUrl}x`);
    xhr.send();
    loadXhr(xhr, `${materialsUrl}x`, JSON.stringify({ elements: [], linked: {} }));

    expect(handle.snapshot()).toEqual({
      csrf3Token: "token-1",
      urlUserId: "42",
      headerNames: ["x-csrf3-token", "x-requested-with"],
      materials: { url: materialsUrl, data: materials },
    });
  });

  // F6(d) guards the upstream DataCloneError, where request bodies were forwarded in posts.
  it("never reads or posts request bodies", async () => {
    const url = "https://www.coursera.org/api/onDemandCourses.v1?slug=course";
    const body = {
      context: { dispatcher: { stores: { ApplicationStore: { userData: { id: 7 } } } } },
    };
    const response = {
      url,
      headers: new Headers({ "content-type": "application/json" }),
      clone: () => ({ json: async () => body }),
    };
    const { win, postMessage, captures } = createWindow(async () => response);
    installInterceptor(win);

    await expect(
      win.fetch(url, {
        method: "POST",
        body: new FormData(),
        headers: { "x-csrf3-token": "token-1" },
      }),
    ).resolves.toBe(response);
    await vi.waitFor(() => expect(captures()).toHaveLength(1));

    expect(captures()[0].capture).toMatchObject({
      method: "POST",
      csrf3Token: "token-1",
      userId: "7",
    });
    expect(postMessage.mock.calls.some(([message]) => hasKey(message, "body"))).toBe(false);
  });
});

describe("buildCapture", () => {
  it("derives capture fields from the sanitized URL, headers and minimized response", () => {
    expect(
      buildCapture({
        url: "https://www.coursera.org/api/grades.v1?userId=99&email=private",
        method: "GET",
        headers: [
          ["X-CSRF3-Token", "token-1"],
          ["Authorization", "Bearer private"],
        ],
        body: {
          context: { dispatcher: { stores: { ApplicationStore: { userData: { id: 5 } } } } },
        },
      }),
    ).toEqual({
      url: "https://www.coursera.org/api/grades.v1?userId=99",
      method: "GET",
      headerNames: ["x-csrf3-token"],
      csrf3Token: "token-1",
      userId: "5",
      urlUserId: "99",
    });
  });

  it("returns null when the policy would not emit", () => {
    expect(
      buildCapture({
        url: "https://www.coursera.org/api/foo",
        method: "GET",
        headers: [],
        body: undefined,
      }),
    ).toBeNull();
    expect(
      buildCapture({
        url: "https://example.com/api/foo?slug=course",
        method: "GET",
        headers: [["x-csrf3-token", "t"]],
        body: {},
      }),
    ).toBeNull();
  });
});
