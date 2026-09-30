import { afterEach, describe, expect, it } from "vitest";
import { describeCodeEditor, normalizeModelUri } from "@/coursera/monaco-dom";

function mountBlock(html: string): HTMLElement {
  document.body.innerHTML = `<section id="block">${html}</section>`;
  const block = document.getElementById("block");
  if (!block) throw new Error("missing block");
  return block;
}

function editor(uri: string, language = "python"): string {
  return `<div data-mode-id="${language}"><div class="monaco-editor" data-uri="${uri}"></div></div>`;
}

afterEach(() => {
  document.body.innerHTML = "";
});

// Ported from tests/monaco-bridge.test.js:63-86 in v1.1.0 (c2f8b71) with real DOM instead of fakes.
describe("Monaco editor DOM", () => {
  it("accepts only Coursera in-memory Monaco model URIs", () => {
    expect(normalizeModelUri("inmemory://model/abc")).toBe("inmemory://model/abc");
    expect(normalizeModelUri("file:///tmp/test.py")).toBe("");
    expect(normalizeModelUri("")).toBe("");
  });

  it("describes a single editable Monaco host", () => {
    const block = mountBlock(editor("inmemory://model/42", "javascript"));
    expect(describeCodeEditor(block)).toEqual({
      modelUri: "inmemory://model/42",
      language: "javascript",
    });
  });

  it("selects the last editor preceding a code evaluator", () => {
    const block = mountBlock(`
      ${editor("inmemory://model/first")}
      ${editor("inmemory://model/second")}
      <div class="cml-code-evaluator"></div>
      ${editor("inmemory://model/after")}
    `);
    expect(describeCodeEditor(block)).toEqual({
      modelUri: "inmemory://model/second",
      language: "python",
    });
  });

  it("fails when several editors have no evaluator to disambiguate them", () => {
    const block = mountBlock(`${editor("inmemory://model/a")}${editor("inmemory://model/b")}`);
    expect(() => describeCodeEditor(block)).toThrow(
      "Could not identify the editable Coursera code model.",
    );
  });

  it("rejects an editor whose model URI is not in-memory", () => {
    const block = mountBlock(editor("file:///tmp/test.py"));
    expect(() => describeCodeEditor(block)).toThrow(
      "Coursera returned an unsupported code model URI.",
    );
  });
});
