import {
  BRIDGE,
  isValidModelUri,
  type MonacoAction,
  type MonacoResponse,
  postBridgeMessage,
  readBridgeMessage,
} from "@/shared/bridge";

export const MONACO_TIMEOUT_MS = 2600;

export interface MonacoClient {
  read(modelUri: string): Promise<string>;
  replace(modelUri: string, expectedValue: string, value: string): Promise<void>;
}

// Port of legacy/monaco-bridge.js:63-116 and content.js:149-179, with both read and replace.
export function createMonacoClient(
  win: Window,
  options: { timeoutMs?: number } = {},
): MonacoClient {
  const timeoutMs = Math.max(50, options.timeoutMs ?? MONACO_TIMEOUT_MS);
  let sequence = 0;

  function request(
    action: MonacoAction,
    payload: { modelUri: string; expectedValue?: string; value?: string },
  ): Promise<MonacoResponse> {
    if (!isValidModelUri(payload.modelUri)) {
      return Promise.reject(new Error("A supported Monaco model URI is required."));
    }

    const requestId = `monaco-${Date.now()}-${++sequence}`;
    const { promise, resolve, reject } = Promise.withResolvers<MonacoResponse>();

    function settle(): void {
      clearTimeout(timeoutId);
      win.removeEventListener("message", onMessage);
    }

    function onMessage(event: MessageEvent): void {
      const response = readBridgeMessage(event, win, BRIDGE.monacoResponse);
      if (!response || response.requestId !== requestId) return;
      settle();
      if (response.ok) resolve(response);
      else reject(new Error(response.error || "Coursera's code editor request failed."));
    }

    const timeoutId = setTimeout(() => {
      settle();
      reject(new Error("Coursera's code editor did not respond."));
    }, timeoutMs);
    win.addEventListener("message", onMessage);

    try {
      postBridgeMessage(win, { source: BRIDGE.monacoRequest, requestId, action, ...payload });
    } catch (error) {
      settle();
      reject(error);
    }
    return promise;
  }

  return {
    async read(modelUri) {
      const response = await request("read-model", { modelUri });
      return String(response.value ?? "");
    },
    async replace(modelUri, expectedValue, value) {
      await request("replace-model", { modelUri, expectedValue, value });
    },
  };
}
