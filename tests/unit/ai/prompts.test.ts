import { describe, expect, it } from "vitest";
import { createQuizPrompt } from "@/ai/prompts";
import type { Question } from "@/shared/types";

/** The questions as the quiz prompt hands them to the model. */
function promptInput(questions: Question[]): unknown {
  const prompt = createQuizPrompt(questions);
  const start = prompt.indexOf("INPUT QUESTIONS:\n") + "INPUT QUESTIONS:\n".length;
  // Pretty-printed JSON never holds a blank line: newlines inside strings are escaped.
  return JSON.parse(prompt.slice(start, prompt.indexOf("\n\n", start)));
}

describe("createQuizPrompt", () => {
  it("numbers each option from 1, the numbers answers choose options by", () => {
    const input = promptInput([
      {
        questionNumber: 1,
        type: "single_answer",
        question: "Which part stores data?",
        options: ["Storage", "Image option 2"],
        images: [{ url: "https://d3c33hcgiwev3.cloudfront.net/b.png", alt: "", option: 2 }],
      },
      { questionNumber: 2, type: "text_input", question: "Name it.", options: [] },
    ]);

    expect(input).toEqual([
      {
        questionNumber: 1,
        type: "single_answer",
        question: "Which part stores data?",
        // One line per option, keyed by its number.
        options: { 1: "Storage", 2: "Image option 2" },
        images: [{ label: "Question 1 image 1", option: 2 }],
      },
      // A written question has no options to number.
      { questionNumber: 2, type: "text_input", question: "Name it." },
    ]);
  });
});
