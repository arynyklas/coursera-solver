import {
  BRIDGE,
  isValidModelUri,
  isValidRequestId,
  type MonacoResponse,
  postBridgeMessage,
  readBridgeMessage,
} from "@/shared/bridge";

interface MonacoModel {
  uri?: { toString(): string };
  getValue(): string;
  getFullModelRange(): unknown;
  pushEditOperations(
    beforeCursorState: unknown[],
    editOperations: Array<{ range: unknown; text: string; forceMoveMarkers: boolean }>,
    cursorStateComputer: () => null,
  ): unknown;
  pushStackElement?(): void;
}

type MonacoWindow = Window &
  typeof globalThis & {
    monaco?: { editor?: { getModels?: () => MonacoModel[] } };
  };

// Port of intercept.js:61-136 in v1.1.0 (c2f8b71).
export function installMonacoHost(win: Window & typeof globalThis): void {
  const host = win as MonacoWindow;

  function respond(requestId: string, payload: Omit<MonacoResponse, "source" | "requestId">): void {
    postBridgeMessage(win, { source: BRIDGE.monacoResponse, requestId, ...payload });
  }

  async function findMonacoModel(modelUri: string): Promise<MonacoModel | null> {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const models = host.monaco?.editor?.getModels?.() || [];
      const model = models.find((candidate) => candidate.uri?.toString() === modelUri);
      if (model) return model;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, 100);
      await promise;
    }
    return null;
  }

  async function handleRequest(event: MessageEvent): Promise<void> {
    const request = readBridgeMessage(event, win, BRIDGE.monacoRequest);
    if (!request) return;

    const { requestId, action, modelUri, value, expectedValue } = request;
    if (!isValidRequestId(requestId)) return;
    if (action !== "read-model" && action !== "replace-model") {
      respond(requestId, { ok: false, error: "Unsupported Monaco action." });
      return;
    }
    if (!isValidModelUri(modelUri)) {
      respond(requestId, { ok: false, error: "Invalid Monaco model URI." });
      return;
    }

    try {
      const model = await findMonacoModel(modelUri);
      if (!model) {
        respond(requestId, { ok: false, error: "Coursera's code editor is not ready." });
        return;
      }

      if (action === "read-model") {
        respond(requestId, { ok: true, value: model.getValue() });
        return;
      }

      if (typeof value !== "string" || typeof expectedValue !== "string") {
        respond(requestId, { ok: false, error: "Invalid Monaco replacement payload." });
        return;
      }
      if (model.getValue() !== expectedValue) {
        respond(requestId, {
          ok: false,
          error: "The code changed while the AI answer was being generated.",
        });
        return;
      }

      model.pushStackElement?.();
      model.pushEditOperations(
        [],
        [{ range: model.getFullModelRange(), text: value, forceMoveMarkers: true }],
        () => null,
      );
      model.pushStackElement?.();
      respond(requestId, { ok: true });
    } catch {
      respond(requestId, { ok: false, error: "Coursera's code editor could not be updated." });
    }
  }

  win.addEventListener("message", (event: MessageEvent) => {
    void handleRequest(event).catch(() => {});
  });
}
