import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { describeCodeEditor } from "@/coursera/monaco-dom";
import {
  assessmentQuestionBlocks,
  parseAssessment,
  parseQuestionBlock,
  selectorDiagnostics,
} from "@/coursera/parser";

function prompt(text: string): string {
  return `<div id="prompt-x"><div data-testid="cml-viewer">${text}</div></div>`;
}

function option(text: string, type: "radio" | "checkbox"): string {
  return `<label class="rc-Option"><input type="${type}"><span data-testid="cml-viewer">${text}</span></label>`;
}

function mount(html: string): void {
  document.body.innerHTML = html;
}

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element;
}

function onlyBlock(html: string): HTMLElement {
  mount(`<section id="block" data-testid="part-Submission_Question">${html}</section>`);
  return byId("block");
}

afterEach(() => {
  document.body.innerHTML = "";
});

// Ported from tests/assessment-parser.test.js:36-202 in v1.1.0 (c2f8b71) with real DOM
// instead of fakeNode.
describe("assessment block selection", () => {
  it("prefers semantic question blocks and falls back to legacy selectors", () => {
    mount(`<section id="semantic" data-testid="part-Submission_A">${prompt("Question")}</section>`);
    expect(assessmentQuestionBlocks(document)).toEqual([byId("semantic")]);
    expect(selectorDiagnostics(document).strategy).toBe("semantic");

    mount(`<section id="legacy" class="css-1erl2aq">${prompt("Legacy question")}</section>`);
    expect(assessmentQuestionBlocks(document)).toEqual([byId("legacy")]);
    expect(selectorDiagnostics(document).strategy).toBe("legacy");
  });

  it("keeps distinct legacy blocks on mixed pages without duplicating dual-matched blocks", () => {
    mount(`
      <section id="dual" class="css-1erl2aq" data-testid="part-Submission_A">${prompt("Dual matched")}</section>
      <section id="legacy-only" class="css-12u8wr5">${prompt("Legacy only")}</section>
    `);

    const blocks = assessmentQuestionBlocks(document);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe(byId("dual"));
    expect(blocks[1]).toBe(byId("legacy-only"));
    expect(selectorDiagnostics(document)).toEqual({
      strategy: "mixed",
      semanticCandidates: 1,
      semanticPrompts: 1,
      legacyCandidates: 2,
      legacyPrompts: 2,
      invalidCandidates: 0,
      selectedBlocks: 2,
    });
  });

  it("filters candidates without prompts and counts dual-matched invalid candidates once", () => {
    mount(`
      <section id="dual-missing" class="css-1erl2aq" data-testid="part-Submission_A"></section>
      <section id="valid" data-testid="part-Submission_B">${prompt("Recoverable")}</section>
      <section id="legacy-missing" class="css-12u8wr5"></section>
    `);

    const blocks = assessmentQuestionBlocks(document);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(byId("valid"));
    expect(selectorDiagnostics(document)).toEqual({
      strategy: "semantic",
      semanticCandidates: 2,
      semanticPrompts: 1,
      legacyCandidates: 2,
      legacyPrompts: 0,
      invalidCandidates: 2,
      selectedBlocks: 1,
    });
  });

  it("returns selected blocks in document order across strategies", () => {
    mount(`
      <section id="legacy-first" class="css-12u8wr5">${prompt("First")}</section>
      <section id="semantic-second" data-testid="part-Submission_A">${prompt("Second")}</section>
    `);

    const blocks = assessmentQuestionBlocks(document);
    expect(blocks[0]).toBe(byId("legacy-first"));
    expect(blocks[1]).toBe(byId("semantic-second"));
  });
});

describe("question classification", () => {
  it("extracts a single-answer question", () => {
    const block = onlyBlock(`${prompt("Pick one")}${option("A", "radio")}${option("B", "radio")}`);
    const parsed = parseQuestionBlock(block, 1);

    expect(parsed).toMatchObject({
      questionNumber: 1,
      type: "single_answer",
      prompt: "Pick one",
      options: ["A", "B"],
    });
  });

  it("extracts multiple-answer, text, essay, and code questions", () => {
    const multiple = onlyBlock(
      `${prompt("Pick many")}${option("A", "checkbox")}${option("B", "checkbox")}`,
    );
    expect(parseQuestionBlock(multiple, 2)?.type).toBe("multiple_answer");

    const text = onlyBlock(`${prompt("Type text")}<input>`);
    expect(parseQuestionBlock(text, 3)?.type).toBe("text_input");

    const essay = onlyBlock(`${prompt("Write more")}<div data-slate-editor="true"></div>`);
    expect(parseQuestionBlock(essay, 4)?.type).toBe("essay");

    mount(
      `<section id="code" data-testid="part-Submission_CodeExpressionQuestion">${prompt("Inspect code")}</section>`,
    );
    const code = parseQuestionBlock(byId("code"), 5);
    expect(code?.handle.kind).toBe("code");
    expect(code?.type).toBe("code_expression");
  });

  it("does not treat hidden or button inputs as written answers", () => {
    const block = onlyBlock(
      `${prompt("No writable field")}<input type="hidden"><input type="button">`,
    );
    expect(parseQuestionBlock(block, 1)?.type).toBe("unknown");
  });

  it("ignores malformed options and falls back to a supported written field", () => {
    const block = onlyBlock(`
      ${prompt("Recoverable text")}
      <label class="rc-Option"><span data-testid="cml-viewer">Missing input</span></label>
      <input type="text">
    `);

    const parsed = parseQuestionBlock(block, 1);
    expect(parsed?.type).toBe("text_input");
    expect(parsed?.options).toEqual([]);
  });

  it("ignores blocks without a prompt", () => {
    const block = onlyBlock(`${option("A", "radio")}`);
    expect(parseQuestionBlock(block, 1)).toBeNull();
  });
});

describe("question handles", () => {
  it("points choice handles at the exact option inputs, skipping invalid options", () => {
    const block = onlyBlock(`
      ${prompt("Pick one")}
      <label class="rc-Option"><input id="a" type="radio"><span data-testid="cml-viewer"> A </span></label>
      <label class="rc-Option"><input id="blank" type="radio"><span data-testid="cml-viewer">  </span></label>
      <label class="rc-Option"><input id="b" type="radio"><span data-testid="cml-viewer">B</span></label>
    `);

    const parsed = parseQuestionBlock(block, 1);
    if (parsed?.handle.kind !== "choice") throw new Error("expected a choice handle");
    expect(parsed.handle.block).toBe(block);
    expect(parsed.handle.multiple).toBe(false);
    expect(parsed.handle.options.map((entry) => entry.text)).toEqual(["A", "B"]);
    expect(parsed.handle.options[0]?.input).toBe(byId("a"));
    expect(parsed.handle.options[1]?.input).toBe(byId("b"));
  });

  it("marks checkbox choice handles as multiple", () => {
    const block = onlyBlock(
      `${prompt("Pick many")}${option("A", "checkbox")}${option("B", "checkbox")}`,
    );
    const handle = parseQuestionBlock(block, 1)?.handle;
    expect(handle?.kind === "choice" && handle.multiple).toBe(true);
  });

  it("points text handles at the exact written field", () => {
    const block = onlyBlock(`${prompt("Type text")}<input id="field" type="text">`);
    const parsed = parseQuestionBlock(block, 1);

    expect(parsed?.type).toBe("text_input");
    if (parsed?.handle.kind !== "text") throw new Error("expected a text handle");
    expect(parsed.handle.block).toBe(block);
    expect(parsed.handle.field).toBe(byId("field"));
  });

  it("targets the Slate editor even when a text input comes first", () => {
    // F2: content.js:271 in v1.1.0 (c2f8b71) wrote into the first written input, the text input.
    const block = onlyBlock(`
      ${prompt("Write more")}
      <input id="text" type="text">
      <div id="slate" data-slate-editor="true" contenteditable="true"></div>
    `);
    const parsed = parseQuestionBlock(block, 1);

    expect(parsed?.type).toBe("essay");
    expect(parsed?.handle.kind === "essay" && parsed.handle.editor).toBe(byId("slate"));
  });

  it("points numeric handles at the number field, the one a Coursera numeric question renders", () => {
    const block = onlyBlock(
      `${prompt("How many hops?")}<input type="hidden" value="h"><input id="field" type="number">`,
    );
    const parsed = parseQuestionBlock(block, 1);

    expect(parsed?.type).toBe("numeric_input");
    if (parsed?.handle.kind !== "number") throw new Error("expected a number handle");
    expect(parsed.handle.block).toBe(block);
    expect(parsed.handle.field).toBe(byId("field"));
  });

  it("gives code blocks a code handle before any option check", () => {
    mount(`
      <section id="code" data-testid="part-Submission_CodeExpressionQuestion">
        ${prompt("Inspect code")}${option("A", "radio")}
      </section>
    `);
    const parsed = parseQuestionBlock(byId("code"), 1);

    expect(parsed?.type).toBe("code_expression");
    expect(parsed?.options).toEqual([]);
    expect(parsed?.handle.kind).toBe("code");
    expect(parsed?.handle.block).toBe(byId("code"));
  });
});

describe("parseAssessment", () => {
  it("numbers blocks by position and reports empty prompts", () => {
    mount(`
      <section data-testid="part-Submission_A">${prompt("First")}<input></section>
      <section data-testid="part-Submission_B">${prompt("   ")}<input></section>
      <section data-testid="part-Submission_C">${prompt("Third")}<input></section>
    `);

    const result = parseAssessment(document);
    expect(result.blocks.map((block) => [block.questionNumber, block.prompt])).toEqual([
      [1, "First"],
      [3, "Third"],
    ]);
    expect(result.missingPrompt).toEqual([2]);
  });
});

// Smoke table from tests/browser/read-only-smoke.html:91-136 in v1.1.0 (c2f8b71).
describe("assessment fixtures", () => {
  const cases = [
    {
      fixture: "basic",
      types: ["single_answer", "multiple_answer", "text_input", "code_expression"],
      diagnostics: {
        strategy: "semantic",
        semanticCandidates: 4,
        semanticPrompts: 4,
        legacyCandidates: 0,
        legacyPrompts: 0,
        invalidCandidates: 0,
        selectedBlocks: 4,
      },
    },
    {
      fixture: "legacy",
      types: ["single_answer", "text_input"],
      diagnostics: {
        strategy: "legacy",
        semanticCandidates: 0,
        semanticPrompts: 0,
        legacyCandidates: 2,
        legacyPrompts: 2,
        invalidCandidates: 0,
        selectedBlocks: 2,
      },
    },
    {
      fixture: "mixed",
      types: ["single_answer", "text_input"],
      diagnostics: {
        strategy: "mixed",
        semanticCandidates: 1,
        semanticPrompts: 1,
        legacyCandidates: 2,
        legacyPrompts: 2,
        invalidCandidates: 0,
        selectedBlocks: 2,
      },
    },
    {
      fixture: "malformed",
      types: ["text_input"],
      diagnostics: {
        strategy: "semantic",
        semanticCandidates: 2,
        semanticPrompts: 1,
        legacyCandidates: 1,
        legacyPrompts: 0,
        invalidCandidates: 2,
        selectedBlocks: 1,
      },
    },
  ];

  for (const { fixture, types, diagnostics } of cases) {
    it(`parses the ${fixture} fixture`, () => {
      mount(readFileSync(`tests/fixtures/assessment-${fixture}.html`, "utf8"));
      const result = parseAssessment(document);

      expect(result.blocks.map((block) => block.type)).toEqual(types);
      expect(result.missingPrompt).toEqual([]);
      expect(selectorDiagnostics(document)).toEqual(diagnostics);
    });
  }

  it("describes the basic fixture code editor", () => {
    mount(readFileSync("tests/fixtures/assessment-basic.html", "utf8"));
    const code = parseAssessment(document).blocks[3];
    if (!code) throw new Error("missing code block");

    expect(describeCodeEditor(code.handle.block)).toEqual({
      modelUri: "inmemory://model/example",
      language: "javascript",
    });
  });
});
