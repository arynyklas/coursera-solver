import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractAssessment } from "@/content/extract";

function mountBasic(): void {
  document.body.innerHTML = readFileSync("tests/fixtures/assessment-basic.html", "utf8");
}

afterEach(() => {
  document.body.innerHTML = "";
});

// Ported from scrapeAssessmentDetailed, content-adapters.js:106-148 in v1.1.0 (c2f8b71).
describe("extractAssessment", () => {
  it("reads the code editor value into the code question", async () => {
    mountBasic();
    const read = vi.fn(async () => "console.log(1)");

    const result = await extractAssessment(document, { read });

    expect(result.questions.map((question) => question.type)).toEqual([
      "single_answer",
      "multiple_answer",
      "text_input",
      "code_expression",
    ]);
    expect(result.questions[3]).toEqual({
      questionNumber: 4,
      type: "code_expression",
      question: "Inspect placeholder code.",
      options: [],
      language: "javascript",
      currentCode: "console.log(1)",
    });
    expect(read).toHaveBeenCalledExactlyOnceWith("inmemory://model/example");
    expect(result.handles.get(4)).toEqual({
      kind: "code",
      block: document.querySelector('[data-testid="part-Submission_CodeExpressionQuestion"]'),
      prompt: "Inspect placeholder code.",
      modelUri: "inmemory://model/example",
      expectedValue: "console.log(1)",
    });
    expect(result.issues).toEqual([]);
  });

  it("maps the other kinds to handles over their blocks and prompts", async () => {
    mountBasic();

    const { questions, handles } = await extractAssessment(document, { read: async () => "" });

    expect(questions[0]).toEqual({
      questionNumber: 1,
      type: "single_answer",
      question: "Which option is a placeholder?",
      options: ["Option A", "Option B"],
    });
    // A choice handle keeps the options read now: answers choose by their numbers.
    expect(handles.get(1)).toEqual({
      kind: "choice",
      block: document.querySelector('[data-testid="part-Submission_MultipleChoiceQuestion"]'),
      prompt: "Which option is a placeholder?",
      options: ["Option A", "Option B"],
    });
    expect(handles.get(2)).toMatchObject({ kind: "choice" });
    expect(handles.get(3)).toEqual({
      kind: "text",
      block: document.querySelector('[data-testid="part-Submission_TextQuestion"]'),
      prompt: "Enter placeholder text.",
    });
  });

  it("reports a failed code read and skips that question", async () => {
    mountBasic();
    const read = vi.fn(async () => {
      throw new Error("Coursera's code editor is not ready.");
    });

    const result = await extractAssessment(document, { read });

    expect(result.questions.map((question) => question.questionNumber)).toEqual([1, 2, 3]);
    expect(result.handles.has(4)).toBe(false);
    expect(result.issues).toEqual([
      {
        questionNumber: 4,
        code: "code-read-failed",
        message: "Coursera's code editor is not ready.",
      },
    ]);
  });

  it("reports an unidentifiable code editor without reading", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_CodeExpressionQuestion">
        <div id="prompt-1"><div data-testid="cml-viewer">Fix the code.</div></div>
      </section>`;
    const read = vi.fn(async () => "");

    const result = await extractAssessment(document, { read });

    expect(read).not.toHaveBeenCalled();
    expect(result.questions).toEqual([]);
    expect(result.issues).toEqual([
      {
        questionNumber: 1,
        code: "code-editor-unavailable",
        message: "Could not identify the editable Coursera code model.",
      },
    ]);
  });

  it("excludes a block without a supported answer field and reports it", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_Question">
        <div id="prompt-1"><div data-testid="cml-viewer">Unknown widget</div></div>
        <input type="hidden" value="h">
        <input type="number" value="1">
      </section>`;

    const result = await extractAssessment(document, { read: async () => "" });

    expect(result.questions).toEqual([]);
    expect(result.handles.size).toBe(0);
    expect(result.issues).toEqual([
      {
        questionNumber: 1,
        code: "unsupported-question",
        message: "Question 1 uses an unsupported question type.",
      },
    ]);
  });

  it("reports a block without a prompt while keeping later question numbers", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_TextQuestion">
        <div id="prompt-1"><div data-testid="cml-viewer">First</div></div>
        <input type="text">
      </section>
      <section data-testid="part-Submission_TextQuestion">
        <div id="prompt-2"><div data-testid="cml-viewer"></div></div>
        <input type="text">
      </section>
      <section data-testid="part-Submission_TextQuestion">
        <div id="prompt-3"><div data-testid="cml-viewer">Third</div></div>
        <input type="text">
      </section>`;

    const result = await extractAssessment(document, { read: async () => "" });

    expect(result.questions.map((question) => question.questionNumber)).toEqual([1, 3]);
    expect(result.issues).toEqual([
      { questionNumber: 2, code: "missing-prompt", message: "Question 2 has no readable prompt." },
    ]);
  });

  it("lists the images of a question and its options for the AI", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">
        <div id="prompt-1"><div data-testid="cml-viewer">
          Which part of the diagram stores data?
          <img src="https://cdn.example/lifecycle.png" alt="Lifecycle diagram">
          <img src="http://cdn.example/insecure.png" alt="Ignored">
        </div></div>
        <label class="rc-Option"><input type="radio" name="q">
          <span data-testid="cml-viewer">Storage <img src="https://cdn.example/storage.png" alt=""></span>
        </label>
        <label class="rc-Option"><input type="radio" name="q">
          <span data-testid="cml-viewer"><img src="data:image/png;base64,iVBORw0KGgo=" alt="Box B"></span>
        </label>
      </section>`;

    const { questions } = await extractAssessment(document, { read: async () => "" });

    expect(questions).toEqual([
      {
        questionNumber: 1,
        type: "single_answer",
        question: "Which part of the diagram stores data?",
        // An option shown only as an image is named by its number.
        options: ["Storage", "Image option 2"],
        images: [
          { url: "https://cdn.example/lifecycle.png", alt: "Lifecycle diagram" },
          { url: "https://cdn.example/storage.png", alt: "", option: 1 },
          { url: "data:image/png;base64,iVBORw0KGgo=", alt: "Box B", option: 2 },
        ],
      },
    ]);
  });

  it("keeps a question whose prompt is only an image", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_TextQuestion">
        <div id="prompt-1"><div data-testid="cml-viewer"><img src="https://cdn.example/q.png" alt=""></div></div>
        <input type="text">
      </section>`;

    const { questions, issues } = await extractAssessment(document, { read: async () => "" });

    expect(issues).toEqual([]);
    expect(questions).toEqual([
      {
        questionNumber: 1,
        type: "text_input",
        question: "",
        options: [],
        images: [{ url: "https://cdn.example/q.png", alt: "" }],
      },
    ]);
  });
});
