import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAnswers, cleanCodeAnswer } from "@/content/apply-answers";
import { extractAssessment } from "@/content/extract";

const noMonaco = { replace: vi.fn(async () => {}) };
const STALE = "The question is no longer on the page.";

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
        { questionNumber: 1, text: "answer" },
        { questionNumber: 2, text: "overwrite" },
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

    const result = await applyAnswers([{ questionNumber: 1, text: "answer" }], handles, noMonaco);

    expect(result).toEqual({
      applied: [],
      failures: [{ questionNumber: 1, message: "The question is no longer on the page." }],
    });
    expect(first.value).toBe("");
    expect(byId<HTMLInputElement>("second").value).toBe("");
  });
});

// FR-I1 (final review): React can remount a block's inner nodes during the AI wait (up to 120 s)
// while the block wrapper stays connected, or reuse the wrapper for another question.
describe("applyAnswers stale nodes", () => {
  it("writes into the input rendered now, not the one extracted", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_TextQuestion">${prompt("Type")}<input id="old" type="text"></section>`;
    const { handles } = await extract();
    const old = byId<HTMLInputElement>("old");
    const current = document.createElement("input");
    current.type = "text";
    old.replaceWith(current);

    const result = await applyAnswers([{ questionNumber: 1, text: "42" }], handles, noMonaco);

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(current.value).toBe("42");
    expect(old.value).toBe("");
  });

  it("fails without writing when the block now shows another question", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_TextQuestion">${prompt("First")}<input id="field" type="text"></section>`;
    const { handles } = await extract();
    const promptNode = document.querySelector('[id^="prompt-"] [data-testid="cml-viewer"]');
    if (!promptNode) throw new Error("missing prompt");
    promptNode.textContent = "Another question";
    const field = byId<HTMLInputElement>("field");
    const events: string[] = [];
    field.addEventListener("input", (event) => events.push(event.type));

    const result = await applyAnswers([{ questionNumber: 1, text: "answer" }], handles, noMonaco);

    expect(result).toEqual({ applied: [], failures: [{ questionNumber: 1, message: STALE }] });
    expect(field.value).toBe("");
    expect(events).toEqual([]);
  });

  it("does not type when focus cannot reach the essay editor", async () => {
    // execCommand edits whatever holds focus, which was usually the previous essay editor.
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `
        <input id="other" type="text">
        <section data-testid="part-Submission_EssayQuestion">${prompt("Write")}<div id="editor" data-slate-editor="true" contenteditable="true"></div></section>`;
      const { handles } = await extract();
      byId("other").focus();
      vi.spyOn(byId("editor"), "focus").mockImplementation(() => {});
      const execCommand = vi.fn(() => true);
      document.execCommand = execCommand;

      const pending = applyAnswers([{ questionNumber: 1, text: "An essay." }], handles, noMonaco, {
        slateDelayMs: 50,
      });
      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toEqual({
        applied: [],
        failures: [{ questionNumber: 1, message: "No supported answer field was found." }],
      });
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      Reflect.deleteProperty(document, "execCommand");
    }
  });

  it("clicks the radio rendered now after the options re-render", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}<div id="options">${option("A", "radio")}${option("B", "radio")}</div></section>`;
    const { handles } = await extract();
    const extracted = Array.from(document.querySelectorAll("input"));
    byId("options").innerHTML = `${option("A", "radio")}${option("B", "radio")}`;
    const [a, b] = document.querySelectorAll("input");

    const result = await applyAnswers(
      [{ questionNumber: 1, optionNumbers: [2] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(a?.checked).toBe(false);
    expect(b?.checked).toBe(true);
    expect(extracted.map((input) => input.checked)).toEqual([false, false]);
  });
});

describe("applyAnswers choices (F3)", () => {
  it("clicks nothing when any chosen number is not an option", async () => {
    // Guards content.js:258-266 in v1.1.0 (c2f8b71), which clicked before checking every answer.
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}${option("A", "radio")}${option("B", "radio")}</section>`;
    const { handles } = await extract();
    const clicks = countClicks(document.querySelectorAll("input"));

    const result = await applyAnswers(
      [{ questionNumber: 1, optionNumbers: [1, 3] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({
      applied: [],
      failures: [{ questionNumber: 1, message: "The selected option no longer matches the page." }],
    });
    expect(clicks()).toBe(0);
  });

  it("clicks nothing when the options are no longer in the order they were read", async () => {
    // The numbers count the options read at extraction; after a reorder they point elsewhere.
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}<div id="options">${option("A", "radio")}${option("B", "radio")}</div></section>`;
    const { handles } = await extract();
    byId("options").innerHTML = `${option("B", "radio")}${option("A", "radio")}`;
    const clicks = countClicks(document.querySelectorAll("input"));

    const result = await applyAnswers(
      [{ questionNumber: 1, optionNumbers: [2] }],
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
      [{ questionNumber: 1, optionNumbers: [2] }],
      handles,
      noMonaco,
    );

    expect(result.failures).toEqual([
      { questionNumber: 1, message: "The selected option no longer matches the page." },
    ]);
    expect(clicks()).toBe(0);
  });

  it("selects the chosen one of two options with the same text", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}${option("Same", "radio")}${option("Same", "radio")}</section>`;
    const { handles } = await extract();
    const [first, second] = document.querySelectorAll("input");

    const result = await applyAnswers(
      [{ questionNumber: 1, optionNumbers: [2] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(first?.checked).toBe(false);
    expect(second?.checked).toBe(true);
  });

  it("selects the matching radio", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick")}${option("A", "radio", true)}${option("B", "radio")}</section>`;
    const { handles } = await extract();
    const [a, b] = document.querySelectorAll("input");

    const result = await applyAnswers(
      [{ questionNumber: 1, optionNumbers: [2] }],
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
      [{ questionNumber: 1, optionNumbers: [1] }],
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
      [{ questionNumber: 1, optionNumbers: [2] }],
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

    const result = await applyAnswers([{ questionNumber: 1, text: "42" }], handles, noMonaco);

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

    await applyAnswers([{ questionNumber: 1, text: "long answer" }], handles, noMonaco);

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

      const pending = applyAnswers([{ questionNumber: 1, text: "An essay." }], handles, noMonaco, {
        slateDelayMs: 80,
      });
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
  async function codeHandles() {
    document.body.innerHTML = `
      <section data-testid="part-Submission_CodeExpressionQuestion">${prompt("Code")}<div class="monaco-editor" data-uri="inmemory://model/1"></div></section>`;
    return (await extractAssessment(document, { read: async () => "print(0)" })).handles;
  }

  it("replaces the model with the unfenced code", async () => {
    const replace = vi.fn(async () => {});

    const result = await applyAnswers(
      [{ questionNumber: 1, text: "```python\nprint(1)\n```" }],
      await codeHandles(),
      { replace },
    );

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(replace).toHaveBeenCalledExactlyOnceWith("inmemory://model/1", "print(0)", "print(1)");
  });

  it("fails on empty code without touching the editor", async () => {
    const replace = vi.fn(async () => {});

    const result = await applyAnswers(
      [{ questionNumber: 1, text: "```\n  \n```" }],
      await codeHandles(),
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
      [{ questionNumber: 1, text: "print(1)" }],
      await codeHandles(),
      { replace },
    );

    expect(result.failures).toEqual([
      { questionNumber: 1, message: "The code changed while the AI answer was being generated." },
    ]);
  });

  // FR-I1 (final review): the block can host a different code model after SPA navigation.
  it("fails without replacing when the block now hosts another code model", async () => {
    const handles = await codeHandles();
    document.querySelector(".monaco-editor")?.setAttribute("data-uri", "inmemory://model/2");
    const replace = vi.fn(async () => {});

    const result = await applyAnswers([{ questionNumber: 1, text: "print(1)" }], handles, {
      replace,
    });

    expect(result).toEqual({ applied: [], failures: [{ questionNumber: 1, message: STALE }] });
    expect(replace).not.toHaveBeenCalled();
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

describe("applyAnswers with image-only options", () => {
  it("selects an option shown only as an image by its number", async () => {
    document.body.innerHTML = `
      <section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Which diagram?")}
        <label class="rc-Option"><input id="first" type="radio" name="q"><span data-testid="cml-viewer"><img src="https://cdn.example/a.png" alt=""></span></label>
        <label class="rc-Option"><input id="second" type="radio" name="q"><span data-testid="cml-viewer"><img src="https://cdn.example/b.png" alt=""></span></label>
      </section>`;
    const { handles } = await extract();

    const result = await applyAnswers(
      [{ questionNumber: 1, optionNumbers: [2] }],
      handles,
      noMonaco,
    );

    expect(result).toEqual({ applied: [1], failures: [] });
    expect(byId<HTMLInputElement>("first").checked).toBe(false);
    expect(byId<HTMLInputElement>("second").checked).toBe(true);
  });
});
