import { readFileSync } from "node:fs";
import type { Question, SelectorDiagnostics, SupportedQuestionType } from "@/shared/types";
import {
  domSnapshot,
  expect,
  routeCourseraPage,
  sendToTab,
  tabIdOf,
  test,
  waitForContentScript,
} from "./extension";

// Serves one Monaco model so the MAIN-world Monaco host can answer the code question.
const MONACO_STUB =
  '<script>window.monaco={editor:{getModels:()=>[{uri:{toString:()=>"inmemory://model/example"},getValue:()=>"console.log(1)"}]}};</script>';

interface FixtureCase {
  name: "basic" | "legacy" | "mixed" | "malformed";
  types: SupportedQuestionType[];
  selectors: SelectorDiagnostics;
  /** Code questions carry the model text read through the MAIN-world Monaco host. */
  codeQuestions: Question[];
}

// Legacy smoke table: legacy/tests/browser/read-only-smoke.html:91-136.
const FIXTURES: FixtureCase[] = [
  {
    name: "basic",
    types: ["single_answer", "multiple_answer", "text_input", "code_expression"],
    selectors: {
      strategy: "semantic",
      semanticCandidates: 4,
      semanticPrompts: 4,
      legacyCandidates: 0,
      legacyPrompts: 0,
      invalidCandidates: 0,
      selectedBlocks: 4,
    },
    codeQuestions: [
      {
        questionNumber: 4,
        type: "code_expression",
        question: "Inspect placeholder code.",
        options: [],
        language: "javascript",
        currentCode: "console.log(1)",
      },
    ],
  },
  {
    name: "legacy",
    types: ["single_answer", "text_input"],
    selectors: {
      strategy: "legacy",
      semanticCandidates: 0,
      semanticPrompts: 0,
      legacyCandidates: 2,
      legacyPrompts: 2,
      invalidCandidates: 0,
      selectedBlocks: 2,
    },
    codeQuestions: [],
  },
  {
    name: "mixed",
    types: ["single_answer", "text_input"],
    selectors: {
      strategy: "mixed",
      semanticCandidates: 1,
      semanticPrompts: 1,
      legacyCandidates: 2,
      legacyPrompts: 2,
      invalidCandidates: 0,
      selectedBlocks: 2,
    },
    codeQuestions: [],
  },
  {
    name: "malformed",
    types: ["text_input"],
    selectors: {
      strategy: "semantic",
      semanticCandidates: 2,
      semanticPrompts: 1,
      legacyCandidates: 1,
      legacyPrompts: 0,
      invalidCandidates: 2,
      selectedBlocks: 1,
    },
    codeQuestions: [],
  },
];

function fixtureBody(name: FixtureCase["name"]): string {
  const source = readFileSync(`tests/fixtures/assessment-${name}.html`, "utf8");
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(source)?.[1];
  if (body === undefined) throw new Error(`assessment-${name}.html has no <body>`);
  return name === "basic" ? MONACO_STUB + body : body;
}

for (const { name, types, selectors, codeQuestions } of FIXTURES) {
  test(`reads the ${name} fixture without changing the page`, async ({
    context,
    page,
    serviceWorker,
  }) => {
    const url = await routeCourseraPage(
      context,
      `/learn/sample-course/quiz/fixture-${name}/${name}`,
      fixtureBody(name),
    );
    await page.goto(url);
    // Baseline before any extension message: even the readiness poll's getDiagnostics runs the
    // parser's block selection (legacy/tests/browser/read-only-smoke.html:45-46).
    const before = await domSnapshot(page);
    const tabId = await tabIdOf(serviceWorker, url);
    await waitForContentScript(serviceWorker, tabId);

    const questions = await sendToTab(serviceWorker, tabId, { type: "getQuestions" });
    const diagnostics = await sendToTab(serviceWorker, tabId, { type: "getDiagnostics" });
    const after = await domSnapshot(page);

    if (!questions.ok) throw new Error(`getQuestions failed: ${questions.error}`);
    if (!diagnostics.ok) throw new Error(`getDiagnostics failed: ${diagnostics.error}`);
    const read = questions.data.questions;
    expect(read.map((question) => question.type)).toEqual(types);
    expect(read.filter((question) => question.type === "code_expression")).toEqual(codeQuestions);
    expect(questions.data.issues).toEqual([]);
    expect(diagnostics.data.selectors).toEqual(selectors);
    expect(after).toEqual(before);
  });
}
