import { afterEach, describe, expect, it, vi } from "vitest";
import { fillDialogueAnswer } from "@/content/dialogue-fill";

const QUESTION = "Give an example of a regression task.";

function coachItem(text: string): string {
  return `<div role="listitem"><div data-testid="chat-message-llm"><div data-testid="coach-message-markdown" class="coach">${text}</div></div></div>`;
}

function mountDialogue(composerText = ""): HTMLTextAreaElement {
  document.body.innerHTML = `
    <div data-testid="coursera-coach-item">
      <div role="list">
        ${coachItem("What is supervised learning?")}
        <div role="listitem">It uses labeled data.</div>
        ${coachItem(QUESTION)}
      </div>
      <textarea aria-label="Send a message">${composerText}</textarea>
    </div>`;
  const composer = document.querySelector("textarea");
  if (!composer) throw new Error("missing composer");
  return composer;
}

afterEach(() => {
  document.body.innerHTML = "";
});

// Ported from legacy content.js:403-442 (fillReactTextarea, fillCurrentDialogueAnswer).
describe("fillDialogueAnswer", () => {
  it("drafts from the conversation and fills the composer like typing", async () => {
    const composer = mountDialogue();
    const instanceSetter = vi.fn();
    Object.defineProperty(composer, "value", {
      configurable: true,
      get: () => "",
      set: instanceSetter,
    });
    const events: Event[] = [];
    composer.addEventListener("input", (event) => events.push(event));
    composer.addEventListener("change", (event) => events.push(event));
    const draftReply = vi.fn(async () => "Predicting house prices.");

    await fillDialogueAnswer(document, draftReply);

    expect(draftReply).toHaveBeenCalledExactlyOnceWith(
      [
        { role: "coach", text: "What is supervised learning?" },
        { role: "learner", text: "It uses labeled data." },
        { role: "coach", text: QUESTION },
      ],
      QUESTION,
    );
    expect(instanceSetter).not.toHaveBeenCalled();
    const nativeValue = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.get;
    expect(nativeValue?.call(composer)).toBe("Predicting house prices.");
    expect(events.map((event) => event.type)).toEqual(["input", "change"]);
    expect(events[0]).toBeInstanceOf(InputEvent);
    expect(events[0]).toMatchObject({ inputType: "insertText", data: "Predicting house prices." });
    expect(document.activeElement).toBe(composer);
  });

  it("places the caret at the end of the reply", async () => {
    const composer = mountDialogue();

    await fillDialogueAnswer(document, async () => "Twelve chars");

    expect(composer.selectionStart).toBe(12);
    expect(composer.selectionEnd).toBe(12);
  });

  it("refuses to overwrite text the learner already typed", async () => {
    mountDialogue("my own answer");
    const draftReply = vi.fn(async () => "reply");

    await expect(fillDialogueAnswer(document, draftReply)).rejects.toThrow(
      "The dialogue message box already contains text. Clear it before generating an answer.",
    );
    expect(draftReply).not.toHaveBeenCalled();
  });

  it("rejects when the coach question changes while drafting", async () => {
    const composer = mountDialogue();

    const pending = fillDialogueAnswer(document, async () => {
      const coach = document.querySelectorAll(".coach");
      const last = coach[coach.length - 1];
      if (last) last.textContent = "A different question.";
      return "reply";
    });

    await expect(pending).rejects.toThrow(
      "The Coursera dialogue changed while the answer was being generated. Try again.",
    );
    expect(composer.value).toBe("");
  });

  it("rejects when the learner types while drafting", async () => {
    const composer = mountDialogue();

    const pending = fillDialogueAnswer(document, async () => {
      composer.value = "typed meanwhile";
      return "reply";
    });

    await expect(pending).rejects.toThrow(
      "The dialogue message box changed while the answer was being generated.",
    );
    expect(composer.value).toBe("typed meanwhile");
  });
});
