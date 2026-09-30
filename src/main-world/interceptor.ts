import {
  BRIDGE,
  type Capture,
  type CaptureSnapshot,
  postBridgeMessage,
  readBridgeMessage,
} from "@/shared/bridge";
import {
  CAPTURED_HEADER_NAMES,
  filterRequestHeaders,
  minimizeResponse,
  normalizeCourseraApiUrl,
  observedRequestHeaderNames,
  shouldEmit,
} from "./intercept-policy";

export interface InterceptorHandle {
  snapshot(): CaptureSnapshot;
}

type MainWindow = Window & typeof globalThis;

interface XhrState {
  url: string;
  method: string;
  headers: [string, string][];
}

// `body` is the parsed response body. Request bodies are never read (F6 d).
export interface CaptureInput {
  url: string;
  method: string;
  headers: [string, string][];
  body: unknown;
}

export function buildCapture(input: CaptureInput): Capture | null {
  const url = normalizeCourseraApiUrl(input.url);
  if (!url) return null;

  const headerNames = observedRequestHeaderNames(input.headers);
  const response = minimizeResponse(url, input.body);
  if (!shouldEmit(url, headerNames, response)) return null;

  const capture: Capture = { url, method: input.method || "GET", headerNames };
  const csrf3Token = filterRequestHeaders(input.headers)
    .filter(([name]) => name === "x-csrf3-token")
    .at(-1)?.[1];
  if (csrf3Token) capture.csrf3Token = csrf3Token;

  if (response && "context" in response) {
    const userId = String(response.context.dispatcher.stores.ApplicationStore.userData.id);
    if (userId) capture.userId = userId;
  }
  const urlUserId = (url.match(/user\/(\d+)/) || url.match(/userId=(\d+)/))?.[1];
  if (urlUserId) capture.urlUserId = urlUserId;
  if (response && "linked" in response) capture.materials = response;

  return capture;
}

export function installInterceptor(win: MainWindow): InterceptorHandle {
  const latest: Omit<CaptureSnapshot, "headerNames"> = {};
  const headerNames = new Set<string>();

  const snapshot = (): CaptureSnapshot => ({
    ...latest,
    headerNames: [...headerNames].sort(),
  });

  function emit(input: CaptureInput): void {
    const capture = buildCapture(input);
    if (!capture) return;

    if (capture.csrf3Token) latest.csrf3Token = capture.csrf3Token;
    if (capture.userId) latest.userId = capture.userId;
    if (capture.urlUserId) latest.urlUserId = capture.urlUserId;
    // Only item-bearing materials count, as in content.js:55-56 in v1.1.0 (c2f8b71).
    if (Array.isArray(capture.materials?.linked?.["onDemandCourseMaterialItems.v2"])) {
      latest.materials = { url: capture.url, data: capture.materials };
    }
    for (const name of capture.headerNames) headerNames.add(name);

    postBridgeMessage(win, { source: BRIDGE.capture, capture });
  }

  function fetchRequestHeaders(
    resource: RequestInfo | URL,
    init?: RequestInit,
  ): [string, string][] {
    const headers = new win.Headers(resource instanceof win.Request ? resource.headers : undefined);
    if (init?.headers) {
      new win.Headers(init.headers).forEach((value, name) => {
        headers.set(name, value);
      });
    }
    return Array.from(headers.entries()).filter(([name]) =>
      CAPTURED_HEADER_NAMES.has(name.toLowerCase()),
    );
  }

  // Everything before the first `await` runs synchronously, so the clone is taken
  // before the page can consume the original body.
  async function inspect(
    response: Response,
    resource: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<void> {
    const isRequest = resource instanceof win.Request;
    const requestUrl = response.url || (isRequest ? resource.url : String(resource || ""));
    const url = normalizeCourseraApiUrl(requestUrl, win.location.href);
    if (!url) return;

    const method = init?.method || (isRequest ? resource.method : "GET");
    const headers = fetchRequestHeaders(resource, init);
    const contentType = response.headers?.get("content-type") || "";
    const clone = contentType.includes("application/json") ? response.clone() : null;

    let body: unknown;
    if (clone) {
      try {
        body = await clone.json();
      } catch {
        // Malformed or streaming JSON copies are ignored; the page keeps the original.
      }
    }
    emit({ url, method, headers, body });
  }

  const originalFetch = win.fetch;
  win.fetch = async (resource: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch.call(win, resource, init);
    void inspect(response, resource, init).catch(() => {});
    return response;
  };

  const xhrPrototype = win.XMLHttpRequest.prototype;
  const originalOpen = xhrPrototype.open;
  const originalSetRequestHeader = xhrPrototype.setRequestHeader;
  const originalSend = xhrPrototype.send;
  const xhrStates = new WeakMap<XMLHttpRequest, XhrState>();

  xhrPrototype.open = function (this: XMLHttpRequest, ...args: unknown[]): void {
    xhrStates.set(this, { method: String(args[0]), url: String(args[1]), headers: [] });
    Reflect.apply(originalOpen, this, args);
  };

  xhrPrototype.setRequestHeader = function (this: XMLHttpRequest, ...args: unknown[]): void {
    Reflect.apply(originalSetRequestHeader, this, args);
    const normalizedName = String(args[0]).toLowerCase();
    if (!CAPTURED_HEADER_NAMES.has(normalizedName)) return;

    let state = xhrStates.get(this);
    if (!state) {
      state = { method: "", url: "", headers: [] };
      xhrStates.set(this, state);
    }
    const normalizedValue = String(args[1]);
    const existingHeader = state.headers.find(([headerName]) => headerName === normalizedName);
    if (existingHeader) {
      existingHeader[1] = `${existingHeader[1]}, ${normalizedValue}`;
    } else {
      state.headers.push([normalizedName, normalizedValue]);
    }
  };

  xhrPrototype.send = function (
    this: XMLHttpRequest,
    ...args: Parameters<XMLHttpRequest["send"]>
  ): void {
    const onLoad = (): void => {
      try {
        const state = xhrStates.get(this);
        const url = normalizeCourseraApiUrl(this.responseURL || state?.url, win.location.href);
        if (!url) return;

        const contentType = this.getResponseHeader("content-type") || "";
        let body: unknown;
        if (contentType.includes("application/json")) {
          try {
            body = JSON.parse(this.responseText);
          } catch {
            // Response bodies that are not valid JSON are ignored.
          }
        }
        emit({
          url,
          method: state?.method || "GET",
          headers: state ? state.headers.map(([name, value]) => [name, value]) : [],
          body,
        });
      } catch {
        // Inspection never disturbs the page's request.
      }
    };
    this.addEventListener("load", onLoad, { once: true });
    originalSend.apply(this, args);
  };

  win.addEventListener("message", (event: MessageEvent) => {
    if (!readBridgeMessage(event, win, BRIDGE.hello)) return;
    try {
      postBridgeMessage(win, { source: BRIDGE.snapshot, snapshot: snapshot() });
    } catch {
      // No concrete origin: nothing can be answered.
    }
  });

  return { snapshot };
}
