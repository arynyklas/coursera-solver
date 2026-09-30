import { describe, expect, it } from "vitest";
import { extractDialogueState } from "@/coursera/dialogue";

function coachItem(text: string): string {
  return `<div role="listitem"><div data-testid="chat-message-llm"><div data-testid="coach-message-markdown">${text}</div></div></div>`;
}

describe("extractDialogueState", () => {
  it("reads the current coach question and the conversation in order", () => {
    const doc = document.implementation.createHTMLDocument("dialogue");
    doc.body.innerHTML = `
      <div data-testid="coursera-coach-item">
        <div role="list">
          ${coachItem("What is supervised learning?")}
          <div role="listitem">It uses labeled data.<button>Copy</button></div>
          ${coachItem("Give an example of a regression task.")}
        </div>
        <textarea aria-label="Send a message"></textarea>
      </div>`;

    const state = extractDialogueState(doc);

    expect(state.root).toBe(doc.querySelector('[data-testid="coursera-coach-item"]'));
    expect(state.composer).toBe(doc.querySelector("textarea"));
    expect(state.currentQuestion).toBe("Give an example of a regression task.");
    expect(state.messages).toEqual([
      { role: "coach", text: "What is supervised learning?" },
      { role: "learner", text: "It uses labeled data." },
      { role: "coach", text: "Give an example of a regression task." },
    ]);
  });

  it("fails when the page has no dialogue", () => {
    const doc = document.implementation.createHTMLDocument("empty");
    expect(() => extractDialogueState(doc)).toThrow("No Coursera dialogue was found on this page.");
  });
});
