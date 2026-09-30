const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const parser = require("../assessment-parser.js");

function fakeNode({ innerText = "", textContent = "", type, dataset = {}, singles = {}, lists = {} } = {}) {
  return {
    innerText,
    textContent,
    type,
    dataset,
    querySelector(selector) {
      return Object.prototype.hasOwnProperty.call(singles, selector) ? singles[selector] : null;
    },
    querySelectorAll(selector) {
      return Object.prototype.hasOwnProperty.call(lists, selector) ? lists[selector] : [];
    }
  };
}

function prompt(text) {
  return fakeNode({ innerText: text });
}

function option(text, type) {
  return fakeNode({
    singles: {
      '[data-testid="cml-viewer"]': fakeNode({ innerText: text }),
      'input[type="radio"], input[type="checkbox"]': fakeNode({ type })
    }
  });
}

test("prefers semantic question blocks and falls back to legacy selectors", () => {
  const semanticBlock = fakeNode({
    singles: { [parser.selectors.semanticPrompt]: prompt("Question") }
  });
  const legacyBlock = fakeNode({
    singles: { [parser.selectors.semanticPrompt]: prompt("Legacy question") }
  });
  const semanticDoc = fakeNode({
    lists: {
      [parser.selectors.semanticBlock]: [semanticBlock],
      [parser.selectors.legacyBlock]: []
    }
  });

  assert.deepEqual(parser.assessmentQuestionBlocks(semanticDoc), [semanticBlock]);
  assert.equal(parser.selectorDiagnostics(semanticDoc).strategy, "semantic");

  const legacyDoc = fakeNode({
    lists: {
      [parser.selectors.semanticBlock]: [],
      [parser.selectors.legacyBlock]: [legacyBlock]
    }
  });
  assert.deepEqual(parser.assessmentQuestionBlocks(legacyDoc), [legacyBlock]);
  assert.equal(parser.selectorDiagnostics(legacyDoc).strategy, "legacy");
});

test("keeps distinct legacy blocks on mixed pages without duplicating dual-matched blocks", () => {
  const dualMatched = fakeNode({
    singles: { [parser.selectors.semanticPrompt]: prompt("Dual matched") }
  });
  const legacyOnly = fakeNode({
    singles: { [parser.selectors.semanticPrompt]: prompt("Legacy only") }
  });
  const doc = fakeNode({
    lists: {
      [parser.selectors.semanticBlock]: [dualMatched],
      [parser.selectors.legacyBlock]: [dualMatched, legacyOnly]
    }
  });

  assert.deepEqual(parser.assessmentQuestionBlocks(doc), [dualMatched, legacyOnly]);
  assert.deepEqual(parser.selectorDiagnostics(doc), {
    strategy: "mixed",
    semanticCandidates: 1,
    semanticPrompts: 1,
    legacyCandidates: 2,
    legacyPrompts: 2,
    invalidCandidates: 0,
    selectedBlocks: 2
  });
});

test("filters candidates without prompts and counts dual-matched invalid candidates once", () => {
  const missingPromptDualMatched = fakeNode();
  const validSemantic = fakeNode({
    singles: { [parser.selectors.semanticPrompt]: prompt("Recoverable") }
  });
  const missingLegacyPrompt = fakeNode();
  const doc = fakeNode({
    lists: {
      [parser.selectors.semanticBlock]: [missingPromptDualMatched, validSemantic],
      [parser.selectors.legacyBlock]: [missingPromptDualMatched, missingLegacyPrompt]
    }
  });

  assert.deepEqual(parser.assessmentQuestionBlocks(doc), [validSemantic]);
  assert.deepEqual(parser.selectorDiagnostics(doc), {
    strategy: "semantic",
    semanticCandidates: 2,
    semanticPrompts: 1,
    legacyCandidates: 2,
    legacyPrompts: 0,
    invalidCandidates: 2,
    selectedBlocks: 1
  });
});

test("extracts a single-answer question shell", () => {
  const block = fakeNode({
    singles: { [parser.selectors.semanticPrompt]: prompt("Pick one") },
    lists: { [parser.selectors.option]: [option("A", "radio"), option("B", "radio")] }
  });

  assert.deepEqual(parser.extractQuestionShell(block, 1), {
    kind: "standard",
    question: {
      questionNumber: 1,
      type: "single_answer",
      question: "Pick one",
      options: ["A", "B"]
    }
  });
});

test("extracts multiple-answer, text, essay, and code shells", () => {
  const multiple = fakeNode({
    singles: { [parser.selectors.semanticPrompt]: prompt("Pick many") },
    lists: { [parser.selectors.option]: [option("A", "checkbox"), option("B", "checkbox")] }
  });
  assert.equal(parser.extractQuestionShell(multiple, 2).question.type, "multiple_answer");

  const text = fakeNode({
    singles: {
      [parser.selectors.semanticPrompt]: prompt("Type text"),
      [parser.selectors.writtenInput]: fakeNode()
    },
    lists: { [parser.selectors.option]: [] }
  });
  assert.equal(parser.extractQuestionShell(text, 3).question.type, "text_input");

  const essay = fakeNode({
    singles: {
      [parser.selectors.semanticPrompt]: prompt("Write more"),
      '[data-slate-editor="true"]': fakeNode()
    },
    lists: { [parser.selectors.option]: [] }
  });
  assert.equal(parser.extractQuestionShell(essay, 4).question.type, "essay");

  const code = fakeNode({
    dataset: { testid: "part-Submission_CodeExpressionQuestion" },
    singles: { [parser.selectors.semanticPrompt]: prompt("Inspect code") },
    lists: { [parser.selectors.option]: [] }
  });
  const codeResult = parser.extractQuestionShell(code, 5);
  assert.equal(codeResult.kind, "code");
  assert.equal(codeResult.question.type, "code_expression");
});

test("does not treat hidden or button inputs as written answers", () => {
  const hiddenOnly = fakeNode({
    singles: {
      [parser.selectors.semanticPrompt]: prompt("No writable field"),
      [parser.selectors.writtenInput]: null,
      'input[type="hidden"]': fakeNode(),
      'input[type="button"]': fakeNode()
    },
    lists: { [parser.selectors.option]: [] }
  });

  assert.equal(parser.extractQuestionShell(hiddenOnly, 1).question.type, "unknown");
});

test("ignores malformed options and falls back to a supported written field", () => {
  const malformedOption = fakeNode({
    singles: {
      '[data-testid="cml-viewer"]': fakeNode({ innerText: "Missing input" })
    }
  });
  const text = fakeNode({
    singles: {
      [parser.selectors.semanticPrompt]: prompt("Recoverable text"),
      [parser.selectors.writtenInput]: fakeNode()
    },
    lists: { [parser.selectors.option]: [malformedOption] }
  });

  const result = parser.extractQuestionShell(text, 1);
  assert.equal(result.question.type, "text_input");
  assert.deepEqual(result.question.options, []);
});

test("ignores blocks without a prompt", () => {
  const block = fakeNode({ lists: { [parser.selectors.option]: [] } });
  assert.equal(parser.extractQuestionShell(block, 1), null);
});

test("sanitized HTML fixtures preserve regression structures without account data", () => {
  const fixtureDir = path.join(__dirname, "fixtures");
  const fixtures = [
    "assessment-basic.html",
    "assessment-legacy.html",
    "assessment-mixed.html",
    "assessment-malformed.html"
  ];

  for (const fixture of fixtures) {
    const html = fs.readFileSync(path.join(fixtureDir, fixture), "utf8");
    assert.doesNotMatch(html, /coursera\.org\/api|Authorization|Cookie|Bearer |x-csrf|userId/i, fixture);
  }

  const basic = fs.readFileSync(path.join(fixtureDir, "assessment-basic.html"), "utf8");
  assert.match(basic, /part-Submission_MultipleChoiceQuestion/);
  assert.match(basic, /part-Submission_MultipleResponseQuestion/);
  assert.match(basic, /part-Submission_TextQuestion/);
  assert.match(basic, /part-Submission_CodeExpressionQuestion/);
  assert.match(basic, /data-uri="inmemory:\/\/model\/example"/);

  const legacy = fs.readFileSync(path.join(fixtureDir, "assessment-legacy.html"), "utf8");
  assert.match(legacy, /css-1erl2aq/);
  assert.match(legacy, /css-12u8wr5/);
  assert.doesNotMatch(legacy, /part-Submission_/);

  const mixed = fs.readFileSync(path.join(fixtureDir, "assessment-mixed.html"), "utf8");
  assert.match(mixed, /part-Submission_MultipleChoiceQuestion/);
  assert.match(mixed, /css-1erl2aq/);
  assert.match(mixed, /css-12u8wr5/);

  const malformed = fs.readFileSync(path.join(fixtureDir, "assessment-malformed.html"), "utf8");
  assert.match(malformed, /Missing prompt on purpose/);
  assert.match(malformed, /Broken option without input/);
});
