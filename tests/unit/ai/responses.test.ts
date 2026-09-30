import { describe, expect, it } from "vitest";
import { extractResponseText, parseAndValidateAnswers } from "@/ai/responses";
import type { Question } from "@/shared/types";

function question(questionNumber: number, type: Question["type"], options: string[]): Question {
  return { questionNumber, type, question: "", options };
}

describe("extractResponseText", () => {
  // Ported from legacy/tests/ai-providers.test.js:54-70.
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
  // Ported from legacy/tests/ai-providers.test.js:72-84.
  it("normalizes and validates structured quiz answers", () => {
    const questions = [question(1, "single_answer", ["A", "B"]), question(2, "text_input", [])];
    const raw =
      '```json\n{"answers":[{"questionNumber":2,"correctOptions":["Response"]},{"questionNumber":1,"correctOptions":["B"]}]}\n```';

    expect(parseAndValidateAnswers(raw, questions)).toEqual([
      { questionNumber: 1, correctOptions: ["B"] },
      { questionNumber: 2, correctOptions: ["Response"] },
    ]);
  });

  // Ported from legacy/tests/ai-providers.test.js:86-92.
  it("accepts the legacy top-level answer array", () => {
    const questions = [question(1, "single_answer", ["A"])];
    const raw = JSON.stringify([{ questionNumber: 1, correctOptions: ["A"] }]);
    expect(parseAndValidateAnswers(raw, questions)).toEqual([
      { questionNumber: 1, correctOptions: ["A"] },
    ]);
  });

  // Ported from legacy/tests/ai-providers.test.js:94-98.
  it("rejects option text that does not exist on the page", () => {
    const questions = [question(1, "multiple_answer", ["A", "B"])];
    const raw = JSON.stringify({ answers: [{ questionNumber: 1, correctOptions: ["C"] }] });
    expect(() => parseAndValidateAnswers(raw, questions)).toThrow(/does not match the page/);
  });

  // Ported from legacy/tests/ai-providers.test.js:100-116.
  it("rejects partial, duplicate, and malformed answers", () => {
    const questions = [question(1, "text_input", []), question(2, "text_input", [])];

    expect(() =>
      parseAndValidateAnswers(
        JSON.stringify({ answers: [{ questionNumber: 1, correctOptions: ["A"] }] }),
        questions,
      ),
    ).toThrow(/did not answer every question/);
    expect(() =>
      parseAndValidateAnswers(
        JSON.stringify({
          answers: [
            { questionNumber: 1, correctOptions: ["A"] },
            { questionNumber: 1, correctOptions: ["B"] },
          ],
        }),
        questions,
      ),
    ).toThrow(/duplicate question number/);
    expect(() => parseAndValidateAnswers("not-json", questions)).toThrow(/invalid JSON/);
  });
});
