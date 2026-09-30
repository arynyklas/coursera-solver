const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const policy = require("../intercept-policy.js");
const source = fs.readFileSync(path.join(__dirname, "..", "intercept.js"), "utf8");

function createContext(originalFetch) {
  class FakeXHR {
    constructor() {
      this._actualHeaders = [];
      this._listeners = new Map();
    }

    open() {}

    setRequestHeader(name, value) {
      this._actualHeaders.push([String(name).toLowerCase(), String(value)]);
    }

    send() {}

    addEventListener(name, listener) {
      this._listeners.set(name, listener);
    }

    getResponseHeader() {
      return "";
    }
  }

  const windowObject = {
    location: {
      href: "https://www.coursera.org/learn/sample/home",
      origin: "https://www.coursera.org"
    },
    fetch: originalFetch,
    addEventListener() {},
    postMessage() {}
  };

  const context = {
    globalThis: null,
    window: windowObject,
    XMLHttpRequest: FakeXHR,
    Headers,
    Request,
    URL,
    console: {
      log() {},
      warn() {},
      error() {}
    },
    setTimeout,
    clearTimeout,
    CourseraInterceptPolicy: policy
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function normalizeVmValue(value) {
  return JSON.parse(JSON.stringify(value));
}

test("passive fetch inspection never replaces a successful page response with an interceptor error", async () => {
  const response = {
    url: "https://www.coursera.org/api/example.v1?slug=sample",
    clone() {
      throw new Error("synthetic clone failure");
    }
  };
  const context = createContext(async () => response);

  const result = await context.window.fetch(response.url);
  assert.equal(result, response);
});

test("XHR interception preserves page headers but retains only allowlisted metadata internally", () => {
  const context = createContext(async () => ({
    url: "https://www.coursera.org/api/example.v1",
    clone() {
      return {
        headers: new Headers(),
        async json() { return {}; }
      };
    }
  }));

  const xhr = new context.XMLHttpRequest();
  xhr.open("GET", "https://www.coursera.org/api/example.v1");
  xhr.setRequestHeader("Authorization", "Bearer private");
  xhr.setRequestHeader("X-CSRF3-Token", "csrf-value");
  xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");

  assert.deepEqual(xhr._actualHeaders, [
    ["authorization", "Bearer private"],
    ["x-csrf3-token", "csrf-value"],
    ["x-requested-with", "XMLHttpRequest"]
  ]);
  assert.deepEqual(normalizeVmValue(xhr._interceptHeaders), [
    ["x-csrf3-token", "csrf-value"],
    ["x-requested-with", "XMLHttpRequest"]
  ]);
  assert.equal(JSON.stringify(xhr._interceptHeaders).includes("Bearer private"), false);
});
