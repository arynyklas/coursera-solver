(function (root, factory) {
  const api = factory();
  root.MonacoBridgeKit = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const REQUEST_SOURCE = "auto-coursera-monaco-request";
  const RESPONSE_SOURCE = "auto-coursera-monaco-response";
  const DOCUMENT_POSITION_FOLLOWING = 4;
  const ALLOWED_ACTIONS = new Set(["read-model"]);

  function normalizeModelUri(value) {
    const modelUri = String(value || "").trim();
    return modelUri.startsWith("inmemory://model/") ? modelUri : "";
  }

  function editableEditorHost(block) {
    if (!block || typeof block.querySelectorAll !== "function") return null;

    const editorHosts = Array.from(block.querySelectorAll(".monaco-editor[data-uri]"));
    const evaluator = typeof block.querySelector === "function"
      ? block.querySelector(".cml-code-evaluator")
      : null;

    if (editorHosts.length === 1) return editorHosts[0];
    if (!evaluator || editorHosts.length < 2) return null;

    const precedingEditors = editorHosts.filter((host) => {
      if (!host || typeof host.compareDocumentPosition !== "function") return false;
      return Boolean(host.compareDocumentPosition(evaluator) & DOCUMENT_POSITION_FOLLOWING);
    });
    return precedingEditors.at(-1) || null;
  }

  function describeCodeEditor(block) {
    const editorHost = editableEditorHost(block);
    if (!editorHost) throw new Error("Could not identify the editable Coursera code model.");

    const modelUri = normalizeModelUri(editorHost.getAttribute?.("data-uri"));
    if (!modelUri) throw new Error("Coursera returned an unsupported code model URI.");

    const language = editorHost.closest?.("[data-mode-id]")?.getAttribute?.("data-mode-id") || "unknown";
    return { modelUri, language };
  }

  function validateBridgeRequest(action, payload) {
    if (!ALLOWED_ACTIONS.has(action)) {
      throw new Error("Unsupported Monaco bridge action.");
    }

    const modelUri = normalizeModelUri(payload?.modelUri);
    if (!modelUri) throw new Error("A supported Monaco model URI is required.");

    return {
      ...payload,
      modelUri
    };
  }

  function targetOriginFor(windowObject) {
    const origin = String(windowObject?.location?.origin || "").trim();
    if (!origin || origin === "null") {
      throw new Error("A concrete page origin is required for the Monaco bridge.");
    }
    return origin;
  }

  function createBridgeClient(windowObject, options = {}) {
    if (!windowObject?.addEventListener || !windowObject?.postMessage) {
      throw new Error("A window-like object is required for the Monaco bridge.");
    }

    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(50, Number(options.timeoutMs))
      : 2600;
    const targetOrigin = targetOriginFor(windowObject);
    let requestSequence = 0;

    function request(action, payload = {}) {
      const validatedPayload = validateBridgeRequest(action, payload);
      const requestId = `monaco-${Date.now()}-${++requestSequence}`;

      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          windowObject.removeEventListener("message", handleResponse);
          reject(new Error("Coursera's code editor did not respond."));
        }, timeoutMs);

        function handleResponse(event) {
          if (
            event.source !== windowObject ||
            event.origin !== targetOrigin ||
            event.data?.source !== RESPONSE_SOURCE ||
            event.data?.requestId !== requestId
          ) return;

          clearTimeout(timeoutId);
          windowObject.removeEventListener("message", handleResponse);
          if (event.data.ok) resolve(event.data);
          else reject(new Error(event.data.error || "Coursera's code editor request failed."));
        }

        windowObject.addEventListener("message", handleResponse);
        windowObject.postMessage({
          source: REQUEST_SOURCE,
          requestId,
          action,
          ...validatedPayload
        }, targetOrigin);
      });
    }

    return Object.freeze({ request });
  }

  return {
    REQUEST_SOURCE,
    RESPONSE_SOURCE,
    normalizeModelUri,
    editableEditorHost,
    describeCodeEditor,
    validateBridgeRequest,
    targetOriginFor,
    createBridgeClient
  };
});
