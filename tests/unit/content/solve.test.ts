import { afterEach, describe, expect, it, vi } from "vitest";
import type { BannerContent } from "@/content/banner/store";
import { createSolveRunner, SOLVE_BUSY_MESSAGE } from "@/content/solve";
import type { Answer, Question } from "@/shared/types";

function prompt(text: string): string {
  return `<div id="prompt-x"><div data-testid="cml-viewer">${text}</div></div>`;
}

const TEXT_QUESTION = `<section data-testid="part-Submission_TextQuestion">${prompt("Name it.")}<input id="text" type="text"></section>`;
const CHOICE_QUESTION = `<section data-testid="part-Submission_MultipleChoiceQuestion">${prompt("Pick one.")}
  <label class="rc-Option"><input type="radio" name="q"><span data-testid="cml-viewer">Alpha</span></label>
  <label class="rc-Option"><input type="radio" name="q"><span data-testid="cml-viewer">Beta</span></label>
</section>`;
const UNSUPPORTED_QUESTION = `<section data-testid="part-Submission_Question">${prompt("Odd.")}<input type="number"></section>`;

function setup(requestAnswers: (questions: Question[]) => Promise<Answer[]>) {
  const shows: BannerContent[] = [];
  const runner = createSolveRunner({
    doc: document,
    monaco: { read: async () => "", replace: async () => {} },
    banner: { show: (content) => shows.push(content), hide: () => {} },
    requestAnswers,
    providerLabel: async () => "Gemini",
    slateDelayMs: 0,
  });
  return { runner, shows, last: () => shows.at(-1) };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("solve runner", () => {
  it("refuses a second run while one is active", async () => {
    // Guards content.js:97-100 in v1.1.0 (c2f8b71), which started overlapping solves (F5).
    document.body.innerHTML = TEXT_QUESTION;
    const { promise, resolve } = Promise.withResolvers<Answer[]>();
    const { runner } = setup(() => promise);

    const first = runner.start();
    expect(() => runner.start()).toThrow(SOLVE_BUSY_MESSAGE);
    resolve([{ questionNumber: 1, correctOptions: ["x"] }]);
    await first.done;
    expect(() => runner.start()).not.toThrow(SOLVE_BUSY_MESSAGE);
  });

  it("reports a page without questions", async () => {
    const requestAnswers = vi.fn(async () => []);
    const { runner, last } = setup(requestAnswers);

    await runner.start().done;

    expect(requestAnswers).not.toHaveBeenCalled();
    expect(last()).toEqual({
      tone: "error",
      title: "Could not solve this quiz",
      description: "No supported questions were found on this page.",
    });
  });

  it("walks through the progress cards and ends on an auto-hiding success", async () => {
    document.body.innerHTML = TEXT_QUESTION + CHOICE_QUESTION;
    const { runner, shows } = setup(async () => [
      { questionNumber: 1, correctOptions: ["answer"] },
      { questionNumber: 2, correctOptions: ["Beta"] },
    ]);

    await runner.start().done;

    expect(shows).toEqual([
      { tone: "info", title: "Solving quiz", description: "Reading questions…" },
      { tone: "info", title: "Solving quiz", description: "Asking Gemini about 2 questions…" },
      { tone: "info", title: "Solving quiz", description: "Filling in answers…" },
      {
        tone: "success",
        title: "Answers added",
        description: "2 answer(s) filled in. Review them, then submit.",
        autoHideMs: 4000,
      },
    ]);
    expect((document.getElementById("text") as HTMLInputElement).value).toBe("answer");
  });

  it("uses the singular for one question", async () => {
    document.body.innerHTML = TEXT_QUESTION;
    const { runner, shows } = setup(async () => [{ questionNumber: 1, correctOptions: ["a"] }]);

    await runner.start().done;

    expect(shows[1]?.description).toBe("Asking Gemini about 1 question…");
  });

  it("counts the images it sends along", async () => {
    document.body.innerHTML = `<section data-testid="part-Submission_TextQuestion">${prompt(
      'Name the diagram. <img src="https://cdn.example/a.png" alt=""><img src="https://cdn.example/b.png" alt="">',
    )}<input type="text"></section>`;
    const { runner, shows } = setup(async () => [{ questionNumber: 1, correctOptions: ["a"] }]);

    await runner.start().done;

    expect(shows[1]?.description).toBe("Asking Gemini about 1 question with 2 images…");
  });

  it("ends on an error card listing the failed question", async () => {
    document.body.innerHTML = TEXT_QUESTION + CHOICE_QUESTION;
    const { runner, last } = setup(async () => [
      { questionNumber: 1, correctOptions: ["answer"] },
      { questionNumber: 2, correctOptions: ["Gamma"] },
    ]);

    await runner.start().done;

    expect(last()).toEqual({
      tone: "error",
      title: "Applied 1 of 2 answers",
      description: "Check question(s) 2: The selected option no longer matches the page.",
    });
  });

  it("counts parser issues as problems even without apply failures", async () => {
    document.body.innerHTML = TEXT_QUESTION + UNSUPPORTED_QUESTION;
    const requestAnswers = vi.fn(async () => [{ questionNumber: 1, correctOptions: ["answer"] }]);
    const { runner, last } = setup(requestAnswers);

    await runner.start().done;

    expect(requestAnswers).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ questionNumber: 1 }),
    ]);
    expect(last()).toEqual({
      tone: "error",
      title: "Applied 1 of 2 answers",
      description: "Check question(s) 2: Question 2 uses an unsupported question type.",
    });
  });

  it("shows the request error", async () => {
    document.body.innerHTML = TEXT_QUESTION;
    const { runner, last } = setup(async () => {
      throw new Error("Gemini did not respond within 120 seconds. Try again.");
    });

    await runner.start().done;

    expect(last()).toEqual({
      tone: "error",
      title: "Could not solve this quiz",
      description: "Gemini did not respond within 120 seconds. Try again.",
    });
  });
});
