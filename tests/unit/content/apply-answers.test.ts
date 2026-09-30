import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAnswers, cleanCodeAnswer } from "@/content/apply-answers";
import { extractAssessment } from "@/content/extract";
import type { QuestionHandle } from "@/shared/types";

const noMonaco = { replace: vi.fn(async () => {}) };

function prompt(text: string): string {
  return `<div id="prompt-x"><div data-testid="cml-viewer">${text}</div></div>`;
}

function option(text: string, type: "radio" | "checkbox", checked = false): string {
  return `<label class="rc-Option"><input type="${type}" name="q"${checked ? " checked" : ""}><span data-testid="cml-viewer">${text}</span></label>`;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as T;
}

function countClicks(inputs: Iterable<HTMLInputElement>): () => number {
  let clicks = 0;
  for (const input of inputs) input.addEventListener("click", () => clicks++);
  return () => clicks;
}

async function extract() {
  return extractAssessment(document, { read: async () => "" });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("applyAnswers handles (F2)", () => {
  it("never writes into a block the parser did not classify", async () => {
    // Guards content.js:271 in v1.1.0 (c2f8b71), which overwrote hidden/number inputs.
    document.body.innerHTML = `
      <section data-testid="part-Submission_TextQuestion">${prompt("First")}<input id="first" type="text"></section>
      <section data-testid="part-Submission_Question">${prompt("Second")}
        <input id="hidden" type="hidden" value="h"><input id="number" type="number" value="1">
      </section>`;
    const { handles } = await extract();

    const result = await applyAnswers(
      [
        { questionNumber: 1, correctOptions: ["answer"] },
        { questionNumber: 2, correctOptions: ["overwrite"] },
      ],
      handles,
      noMonaco,
    );

    expect(result).toEqual({
      applied: [1],
      failures: [{ questionNumber: 2, message: "The question is no longer on the page." }],
    });
    expect(byId<HTMLInputElement>("first").value).toBe("answer");
    expect(byId<HTMLInputElement>("hidden").value).toBe("h");
    expect(byId<HTMLInputElement>("number").value).toBe("1");
  });

  it("fails a question whose block left the page after extraction", async () => {
    // Guards content.js:215 in v1.1.0 (c2f8b71), which re-queried blocks and wrote into new ones.
    document.body.innerHTML = `
      <section id="block-1" data-testid="part-Submission_TextQuestion">${prompt("First")}<input id="first" type="text"></section>
      <section data-testid="part-Submission_TextQuestion">${prompt("Second")}<input id="second" type="text"></section>`;
    const { handles } = await extract();
    const first = byId<HTMLInputElement>("first");
    byId("block-1").remove();

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["answer"] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({
      applied: [],
      failures: [{ questionNumber: 1, message: "The question is no longer on the page." }],
    });
    expect(first.value).toBe("");
    expect(byId<HTMLInputElement>("second").value).toBe("");
  });
});

describe("applyAnswers choices (F3)", () => {
  it("clicks nothing when any answer text is missing from the options", async () => {
    // Guards content.js:258-266 in v1.1.0 (c2f8b71), which clicked before checking every answer.
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}${option("A", "radio")}${option("B", "radio")}</section>`;
    const { handles } = await extract();
    const clicks = countClicks(document.querySelectorAll("input"));

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["A", "C"] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({
      applied: [],
      failures: [{ questionNumber: 1, message: "The selected option no longer matches the page." }],
    });
    expect(clicks()).toBe(0);
  });

  it("fails without clicks when no answer matches", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}${option("A", "radio")}${option("B", "radio")}</section>`;
    const { handles } = await extract();
    const clicks = countClicks(document.querySelectorAll("input"));

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["C"] }],
      handles,
      noMonaco,
    );

    expect(result.failures).toEqual([
      { questionNumber: 1, message: "The selected option no longer matches the page." },
    ]);
    expect(clicks()).toBe(0);
  });

  it("fails when an option's text changed on the page after extraction", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}${option("A", "radio")}${option("B", "radio")}</section>`;
    const { handles } = await extract();
    const optionTexts = document.querySelectorAll('.rc-Option [data-testid="cml-viewer"]');
    const renamed = optionTexts[1];
    if (!renamed) throw new Error("missing option text");
    renamed.textContent = "B2";
    const clicks = countClicks(document.querySelectorAll("input"));

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["B"] }],
      handles,
      noMonaco,
    );

    expect(result.failures).toEqual([
      { questionNumber: 1, message: "The selected option no longer matches the page." },
    ]);
    expect(clicks()).toBe(0);
  });

  it("selects the matching radio", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}${option("A", "radio", true)}${option("B", "radio")}</section>`;
    const { handles } = await extract();
    const [a, b] = document.querySelectorAll("input");

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["B"] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(a?.checked).toBe(false);
    expect(b?.checked).toBe(true);
  });

  it("does not click a radio that is already selected", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}${option("A", "radio", true)}${option("B", "radio")}</section>`;
    const { handles } = await extract();
    const clicks = countClicks(document.querySelectorAll("input"));

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["A"] }],
      handles,
      noMonaco,
    );

    expect(result.applied).toEqual([1]);
    expect(clicks()).toBe(0);
  });

  it("checks the answers and clears other checked boxes", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleResponseQuestion">${prompt("Pick")}${option("A", "checkbox", true)}${option("B", "checkbox")}</section>`;
    const { handles } = await extract();
    const [a, b] = document.querySelectorAll("input");

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["B"] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(a?.checked).toBe(false);
    expect(b?.checked).toBe(true);
  });
});

describe("applyAnswers text fields (F4)", () => {
  it("writes through the prototype setter and fires input and change", async () => {
    // Guards content.js:285 in v1.1.0 (c2f8b71): a direct .value write hit React's instance setter.
    document.body.innerHTML = `
      <section data-testid="part-Submission_TextQuestion">${prompt("Type")}<input id="field" type="text"></section>`;
    const { handles } = await extract();
    const field = byId<HTMLInputElement>("field");
    const spy = vi.fn();
    Object.defineProperty(field, "value", {
      configurable: true,
      get: () => "instance",
      set: spy,
    });
    const events: Event[] = [];
    field.addEventListener("input", (event) => events.push(event));
    field.addEventListener("change", (event) => events.push(event));

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["42"] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(spy).not.toHaveBeenCalled();
    const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.get;
    expect(nativeValue?.call(field)).toBe("42");
    expect(events.map((event) => event.type)).toEqual(["input", "change"]);
    const [input, change] = events;
    expect(input).toBeInstanceOf(InputEvent);
    expect(input).toMatchObject({ inputType: "insertText", data: "42", bubbles: true });
    expect(change?.bubbles).toBe(true);
  });

  it("writes a textarea through the textarea prototype setter", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_TextQuestion">${prompt("Type")}<textarea id="field"></textarea></section>`;
    const { handles } = await extract();

    await applyAnswers([{ questionNumber: 1, correctOptions: ["long answer"] }], handles, noMonaco);

    expect(byId<HTMLTextAreaElement>("field").value).toBe("long answer");
  });
});

describe("applyAnswers essays", () => {
  it("focuses the Slate editor, waits, then replaces its text through execCommand", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <section data-testid="part-Submission_EssayQuestion">${prompt("Write")}<div id="editor" data-slate-editor="true" contenteditable="true"></div></section>`;
      const { handles } = await extract();
      const editor = byId("editor");
      const focus = vi.spyOn(editor, "focus");
      // happy-dom has no execCommand; the stub is removed in finally.
      const execCommand = vi.fn(() => true);
      document.execCommand = execCommand;

      const pending = applyAnswers(
        [{ questionNumber: 1, correctOptions: ["An essay."] }],
        handles,
        noMonaco,
        { slateDelayMs: 80 },
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(focus).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(79);
      expect(execCommand).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      await expect(pending).resolves.toEqual({ applied: [1], failures: [] });
      expect(execCommand.mock.calls).toEqual([["selectAll"], ["insertText", false, "An essay."]]);
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(document, "execCommand");
    }
  });
});

describe("applyAnswers code", () => {
  function codeHandles(): Map<number, QuestionHandle> {
    document.body.innerHTML = `<section id="block"></section>`;
    return new Map([
      [
        1,
        {
          kind: "code",
          block: byId("block"),
          modelUri: "inmemory://model/1",
          expectedValue: "print(0)",
        },
      ],
    ]);
  }

  it("replaces the model with the unfenced code", async () => {
    const replace = vi.fn(async () => {});

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["```python\nprint(1)\n```"] }],
      codeHandles(),
      { replace },
    );

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(replace).toHaveBeenCalledExactlyOnceWith("inmemory://model/1", "print(0)", "print(1)");
  });

  it("fails on empty code without touching the editor", async () => {
    const replace = vi.fn(async () => {});

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["```\n  \n```"] }],
      codeHandles(),
      { replace },
    );

    expect(result).toEqual({
      applied: [],
      failures: [{ questionNumber: 1, message: "The AI returned empty code." }],
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("reports the editor's rejection as the failure", async () => {
    const replace = vi.fn(async () => {
      throw new Error("The code changed while the AI answer was being generated.");
    });

    const result = await applyAnswers(
      [{ questionNumber: 1, correctOptions: ["print(1)"] }],
      codeHandles(),
      { replace },
    );

    expect(result.failures).toEqual([
      { questionNumber: 1, message: "The code changed while the AI answer was being generated." },
    ]);
  });
});

// Ported from content.js:208-212 in v1.1.0 (c2f8b71).
describe("cleanCodeAnswer", () => {
  it("strips one surrounding Markdown fence and keeps unfenced code", () => {
    expect(cleanCodeAnswer("```js\r\nconst a = 1;\r\n```  ")).toBe("const a = 1;");
    expect(cleanCodeAnswer("```\nx = 1\ny = 2\n```")).toBe("x = 1\ny = 2");
    expect(cleanCodeAnswer("x = 1")).toBe("x = 1");
    expect(cleanCodeAnswer("before\n```py\nx\n```")).toBe("before\n```py\nx\n```");
  });
});
