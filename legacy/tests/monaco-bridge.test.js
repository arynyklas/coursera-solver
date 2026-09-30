const test = require("node:test");
const assert = require("node:assert/strict");

const {
  REQUEST_SOURCE,
  RESPONSE_SOURCE,
  normalizeModelUri,
  describeCodeEditor,
  validateBridgeRequest,
  targetOriginFor,
  createBridgeClient
} = require("../monaco-bridge.js");

function editor(uri, language = "python", position = 4) {
  return {
    getAttribute(name) {
      return name === "data-uri" ? uri : null;
    },
    closest(selector) {
      if (selector !== "[data-mode-id]") return null;
      return { getAttribute: () => language };
    },
    compareDocumentPosition() {
      return position;
    }
  };
}

function blockWith(editors, evaluator = null) {
  return {
    querySelectorAll(selector) {
      return selector === ".monaco-editor[data-uri]" ? editors : [];
    },
    querySelector(selector) {
      return selector === ".cml-code-evaluator" ? evaluator : null;
    }
  };
}

function fakeWindow() {
  const listeners = new Set();
  const posted = [];
  const windowObject = {
    location: { origin: "https://www.coursera.org" },
    addEventListener(type, listener) {
      if (type === "message") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "message") listeners.delete(listener);
    },
    postMessage(message, targetOrigin) {
      posted.push({ message, targetOrigin });
    }
  };

  windowObject.emit = (data, origin = windowObject.location.origin) => {
    for (const listener of [...listeners]) listener({ source: windowObject, origin, data });
  };
  windowObject.posted = posted;
  return windowObject;
}

test("accepts only Coursera in-memory Monaco model URIs", () => {
  assert.equal(normalizeModelUri("inmemory://model/abc"), "inmemory://model/abc");
  assert.equal(normalizeModelUri("file:///tmp/test.py"), "");
  assert.equal(normalizeModelUri(""), "");
});

test("describes a single editable Monaco host", () => {
  assert.deepEqual(
    describeCodeEditor(blockWith([editor("inmemory://model/42", "javascript")])),
    { modelUri: "inmemory://model/42", language: "javascript" }
  );
});

test("selects the last editor preceding a code evaluator", () => {
  const evaluator = {};
  const first = editor("inmemory://model/first", "python", 4);
  const second = editor("inmemory://model/second", "python", 4);
  const after = editor("inmemory://model/after", "python", 0);

  assert.deepEqual(
    describeCodeEditor(blockWith([first, second, after], evaluator)),
    { modelUri: "inmemory://model/second", language: "python" }
  );
});

test("modular bridge accepts read-model only", () => {
  assert.throws(
    () => validateBridgeRequest("replace-model", {
      modelUri: "inmemory://model/1",
      value: "replacement"
    }),
    /unsupported/i
  );
  assert.throws(
    () => validateBridgeRequest("execute-code", { modelUri: "inmemory://model/1" }),
    /unsupported/i
  );
  assert.throws(
    () => validateBridgeRequest("read-model", { modelUri: "file:///tmp/x" }),
    /model URI/i
  );
});

test("requires an exact concrete page origin for bridge messages", () => {
  assert.equal(targetOriginFor({ location: { origin: "https://www.coursera.org" } }), "https://www.coursera.org");
  assert.throws(
    () => targetOriginFor({ location: { origin: "null" } }),
    /concrete page origin/i
  );
  assert.throws(
    () => targetOriginFor({ location: { origin: "" } }),
    /concrete page origin/i
  );
});

test("read bridge resolves only matching same-origin responses", async () => {
  const windowObject = fakeWindow();
  const client = createBridgeClient(windowObject, { timeoutMs: 200 });
  const pending = client.request("read-model", { modelUri: "inmemory://model/7" });

  assert.equal(windowObject.posted.length, 1);
  const outbound = windowObject.posted[0];
  assert.equal(outbound.targetOrigin, "https://www.coursera.org");
  assert.equal(outbound.message.source, REQUEST_SOURCE);
  assert.equal(outbound.message.action, "read-model");

  windowObject.emit({
    source: RESPONSE_SOURCE,
    requestId: outbound.message.requestId,
    ok: true,
    value: "wrong-origin"
  }, "https://example.com");
  windowObject.emit({
    source: RESPONSE_SOURCE,
    requestId: "wrong-id",
    ok: true,
    value: "ignored"
  });
  windowObject.emit({
    source: RESPONSE_SOURCE,
    requestId: outbound.message.requestId,
    ok: true,
    value: "print('ok')"
  });

  const response = await pending;
  assert.equal(response.value, "print('ok')");
});
