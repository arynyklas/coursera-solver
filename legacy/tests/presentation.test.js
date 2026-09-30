const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const presentation = require("../presentation.js");

class FakeNode {
  constructor(tagName, documentRef) {
    this.tagName = tagName;
    this.documentRef = documentRef;
    this.style = {};
    this.attributes = {};
    this.children = [];
    this.parentNode = null;
    this.id = "";
    this._textContent = "";
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
    this.children = [];
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
}

class FakeDocument {
  constructor() {
    this.head = new FakeNode("head", this);
    this.body = new FakeNode("body", this);
  }

  createElement(tagName) {
    return new FakeNode(tagName, this);
  }

  createTextNode(text) {
    const node = new FakeNode("#text", this);
    node.textContent = text;
    return node;
  }

  getElementById(id) {
    const visit = (node) => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const match = visit(child);
        if (match) return match;
      }
      return null;
    };
    return visit(this.head) || visit(this.body);
  }
}

function createScheduler() {
  let nextId = 0;
  const pending = new Map();
  return {
    setTimeout(callback) {
      const id = ++nextId;
      pending.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    flush() {
      const callbacks = Array.from(pending.values());
      pending.clear();
      callbacks.forEach((callback) => callback());
    }
  };
}

test("banner descriptors normalize unknown types to info", () => {
  assert.deepEqual(presentation.bannerDescriptor("Working", "unknown"), {
    type: "info",
    text: "Working",
    prefix: "⏳",
    backgroundColor: "#2563eb",
    spinner: true
  });
});

test("renders dynamic banner text literally instead of interpreting HTML", () => {
  const doc = new FakeDocument();
  const scheduler = createScheduler();
  const presenter = presentation.createBannerPresenter(doc, scheduler);
  const payload = '<img src=x onerror="alert(1)">';

  presenter.show(payload, "success");

  const banner = doc.getElementById(presentation.BANNER_ID);
  assert.ok(banner);
  assert.equal(banner.textContent, `✅ ${payload}`);
  assert.equal(banner.children.length, 0);
  assert.equal(banner.getAttribute("role"), "status");
  assert.equal(banner.getAttribute("aria-live"), "polite");
});

test("info banners create one reusable spinner style", () => {
  const doc = new FakeDocument();
  const presenter = presentation.createBannerPresenter(doc, createScheduler());

  presenter.show("First", "info");
  presenter.show("Second", "info");

  assert.ok(doc.getElementById(presentation.STYLE_ID));
  assert.equal(doc.head.children.filter((node) => node.id === presentation.STYLE_ID).length, 1);
  assert.equal(doc.getElementById(presentation.BANNER_ID).textContent, "⏳Second");
});

test("show cancels a pending hide so a refreshed banner is not removed", () => {
  const doc = new FakeDocument();
  const scheduler = createScheduler();
  const presenter = presentation.createBannerPresenter(doc, scheduler);

  presenter.show("Old", "info");
  assert.equal(presenter.hide(), true);
  presenter.show("New", "success");
  scheduler.flush();

  assert.ok(doc.getElementById(presentation.BANNER_ID));
  assert.equal(doc.getElementById(presentation.BANNER_ID).textContent, "✅ New");
});

test("presentation source never uses innerHTML for dynamic banner content", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "presentation.js"), "utf8");
  assert.doesNotMatch(source, /innerHTML/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /chrome\.runtime|chrome\.tabs/);
});
