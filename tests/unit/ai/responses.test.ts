import { describe, expect, it } from "vitest";
import { extractResponseText, parseAndValidateAnswers, parseModelList } from "@/ai/responses";
import type { Question } from "@/shared/types";

function question(questionNumber: number, type: Question["type"], options: string[]): Question {
  return { questionNumber, type, question: "", options };
}

describe("extractResponseText", () => {
  // Ported from tests/ai-providers.test.js:54-70 in v1.1.0 (c2f8b71).
  it("uses provider-specific response extractors", () => {
    expect(
      extractResponseText("gemini", {
        candidates: [{ content: { parts: [{ text: '{"answers":[]}' }] } }],
      }),
    ).toBe('{"answers":[]}');

    expect(
      extractResponseText("openai", {
        output: [{ content: [{ type: "output_text", text: "openai" }] }],
      }),
    ).toBe("openai");

    expect(
      extractResponseText("anthropic", {
        content: [{ type: "text", text: "claude" }],
      }),
    ).toBe("claude");

    expect(
      extractResponseText("groq", {
        choices: [{ message: { content: "groq" } }],
      }),
    ).toBe("groq");
  });
});

describe("parseAndValidateAnswers", () => {
  // Ported from tests/ai-providers.test.js:72-84 in v1.1.0 (c2f8b71).
  it("normalizes and validates structured quiz answers", () => {
    const questions = [
      question(1, "single_answer", ["A", "B"]),
      question(2, "text_input", []),
      question(3, "code_expression", []),
    ];
    const raw = `\`\`\`json\n${JSON.stringify({
      answers: [
        { questionNumber: 2, optionNumbers: [], text: " Response " },
        { questionNumber: 1, optionNumbers: [2], text: "" },
        // Code keeps its indentation.
        { questionNumber: 3, optionNumbers: [], text: "  x = 1\r\n" },
      ],
    })}\n\`\`\``;

    expect(parseAndValidateAnswers(raw, questions)).toEqual([
      { questionNumber: 1, optionNumbers: [2] },
      { questionNumber: 2, text: "Response" },
      { questionNumber: 3, text: "  x = 1\n" },
    ]);
  });

  // Ported from tests/ai-providers.test.js:86-92 in v1.1.0 (c2f8b71).
  it("accepts the legacy top-level answer array", () => {
    const questions = [question(1, "single_answer", ["A"])];
    const raw = JSON.stringify([{ questionNumber: 1, optionNumbers: [1], text: "" }]);
    expect(parseAndValidateAnswers(raw, questions)).toEqual([
      { questionNumber: 1, optionNumbers: [1] },
    ]);
  });

  it("reads option numbers that a model without a schema wrote as text", () => {
    const questions = [question(1, "multiple_answer", ["A", "B", "C"])];
    const raw = JSON.stringify({ answers: [{ questionNumber: 1, optionNumbers: ["1", 3] }] });
    expect(parseAndValidateAnswers(raw, questions)).toEqual([
      { questionNumber: 1, optionNumbers: [1, 3] },
    ]);
  });

  // Ported from tests/ai-providers.test.js:94-98 in v1.1.0 (c2f8b71).
  it("rejects an option number that is not on the page", () => {
    const questions = [question(1, "multiple_answer", ["A", "B"])];
    for (const optionNumbers of [[3], [0], [1.5], ["B"], [true]]) {
      const raw = JSON.stringify({ answers: [{ questionNumber: 1, optionNumbers, text: "" }] });
      expect(() => parseAndValidateAnswers(raw, questions)).toThrow(
        "Question 1 chose an option that is not on the page.",
      );
    }
  });

  it("rejects a choice without option numbers and a written answer without text", () => {
    const answer = (optionNumbers: unknown[], text: string) =>
      JSON.stringify({ answers: [{ questionNumber: 1, optionNumbers, text }] });

    expect(() =>
      parseAndValidateAnswers(answer([], "A"), [question(1, "single_answer", ["A"])]),
    ).toThrow("Question 1 did not contain an answer.");
    expect(() =>
      parseAndValidateAnswers(answer([1], " "), [question(1, "text_input", [])]),
    ).toThrow("Question 1 did not contain an answer.");
  });

  // Ported from tests/ai-providers.test.js:100-116 in v1.1.0 (c2f8b71).
  it("rejects partial, duplicate, and malformed answers", () => {
    const questions = [question(1, "text_input", []), question(2, "text_input", [])];

    expect(() =>
      parseAndValidateAnswers(
        JSON.stringify({ answers: [{ questionNumber: 1, optionNumbers: [], text: "A" }] }),
        questions,
      ),
    ).toThrow(/did not answer every question/);
    expect(() =>
      parseAndValidateAnswers(
        JSON.stringify({
          answers: [
            { questionNumber: 1, optionNumbers: [], text: "A" },
            { questionNumber: 1, optionNumbers: [], text: "B" },
          ],
        }),
        questions,
      ),
    ).toThrow(/duplicate question number/);
    expect(() => parseAndValidateAnswers("not-json", questions)).toThrow(/invalid JSON/);
  });
});

describe("parseModelList", () => {
  it("returns each served model id once, in server order", () => {
    expect(
      parseModelList({
        object: "list",
        data: [
          { id: "Qwen/Qwen3-8B", object: "model", root: "Qwen/Qwen3-8B" },
          { id: "sql-lora", object: "model", parent: "Qwen/Qwen3-8B" },
          { id: "Qwen/Qwen3-8B" },
          { id: 5 },
          null,
          { id: "  " },
        ],
      }),
    ).toEqual(["Qwen/Qwen3-8B", "sql-lora"]);
  });

  it("reads a body without a model list as no models", () => {
    expect(parseModelList({ detail: "Not Found" })).toEqual([]);
    expect(parseModelList(null)).toEqual([]);
  });
});
