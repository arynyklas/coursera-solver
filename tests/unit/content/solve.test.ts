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
const UNSUPPORTED_QUESTION = `<section data-testid="part-Submission_Question">${prompt("Odd.")}<input type="range"></section>`;

/** `count` text questions, numbered from 1, each with an input `#q<number>`. */
function textQuestions(count: number): string {
  return Array.from(
    { length: count },
    (_, index) =>
      `<section data-testid="part-Submission_TextQuestion">${prompt(`Question ${index + 1}?`)}<input id="q${index + 1}" type="text"></section>`,
  ).join("");
}

function answersTo(questions: Question[]): Answer[] {
  return questions.map(({ questionNumber }) => ({ questionNumber, text: `a${questionNumber}` }));
}

function filled(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => (document.getElementById(`q${index + 1}`) as HTMLInputElement).value,
  );
}

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
    resolve([{ questionNumber: 1, text: "x" }]);
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
      { questionNumber: 1, text: "answer" },
      { questionNumber: 2, optionNumbers: [2] },
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
    const { runner, shows } = setup(async () => [{ questionNumber: 1, text: "a" }]);

    await runner.start().done;

    expect(shows[1]?.description).toBe("Asking Gemini about 1 question…");
  });

  it("counts the images it sends along", async () => {
    document.body.innerHTML = `<section data-testid="part-Submission_TextQuestion">${prompt(
      'Name the diagram. <img src="https://cdn.example/a.png" alt=""><img src="https://cdn.example/b.png" alt="">',
    )}<input type="text"></section>`;
    const { runner, shows } = setup(async () => [{ questionNumber: 1, text: "a" }]);

    await runner.start().done;

    expect(shows[1]?.description).toBe("Asking Gemini about 1 question with 2 images…");
  });

  it("ends on an error card listing the failed question", async () => {
    document.body.innerHTML = TEXT_QUESTION + CHOICE_QUESTION;
    const { runner, last } = setup(async () => [
      { questionNumber: 1, text: "answer" },
      { questionNumber: 2, optionNumbers: [3] },
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
    const requestAnswers = vi.fn(async () => [{ questionNumber: 1, text: "answer" }]);
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

  describe("a quiz too big for one request", () => {
    it("asks about 5 questions per request and fills every answer", async () => {
      document.body.innerHTML = textQuestions(12);
      const requestAnswers = vi.fn(async (questions: Question[]) => answersTo(questions));
      const { runner, shows, last } = setup(requestAnswers);

      await runner.start().done;

      expect(
        requestAnswers.mock.calls.map(([questions]) => questions.map((q) => q.questionNumber)),
      ).toEqual([
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10],
        [11, 12],
      ]);
      expect(shows[1]).toEqual({
        tone: "info",
        title: "Solving quiz",
        description: "Asking Gemini about 12 questions in 3 parts…",
        progress: 0,
      });
      expect(shows.flatMap(({ progress }) => (progress === undefined ? [] : [progress]))).toEqual([
        0,
        1 / 3,
        2 / 3,
        1,
      ]);
      expect(filled(12)).toEqual(Array.from({ length: 12 }, (_, index) => `a${index + 1}`));
      expect(last()).toMatchObject({ tone: "success", title: "Answers added" });
    });

    it("fills the parts that came back and names the questions of a part that failed", async () => {
      document.body.innerHTML = textQuestions(12);
      const { runner, last } = setup(async (questions) => {
        if (questions.some(({ questionNumber }) => questionNumber === 6)) {
          throw new Error("vLLM failed with HTTP 500: upstream request timeout");
        }
        return answersTo(questions);
      });

      await runner.start().done;

      expect(last()).toEqual({
        tone: "error",
        title: "Applied 7 of 12 answers",
        description:
          "Check question(s) 6, 7, 8, 9, 10: vLLM failed with HTTP 500: upstream request timeout",
      });
      expect(filled(12)).toEqual(
        Array.from({ length: 12 }, (_, index) => (index >= 5 && index < 10 ? "" : `a${index + 1}`)),
      );
    });

    it("keeps at most 4 requests waiting on the provider at once", async () => {
      document.body.innerHTML = textQuestions(30);
      const waiting: { questions: Question[]; answer: () => void }[] = [];
      const { runner, last } = setup((questions) => {
        const { promise, resolve } = Promise.withResolvers<Answer[]>();
        waiting.push({ questions, answer: () => resolve(answersTo(questions)) });
        return promise;
      });

      const { done } = runner.start();
      // Without a cap all six would start at once, and the count would never read four.
      await vi.waitFor(() => expect(waiting).toHaveLength(4));

      waiting[0]?.answer();
      await vi.waitFor(() => expect(waiting).toHaveLength(5));
      for (const request of waiting.slice(1)) request.answer();
      await vi.waitFor(() => expect(waiting).toHaveLength(6));
      waiting[5]?.answer();
      await done;

      expect(filled(30)).toEqual(Array.from({ length: 30 }, (_, index) => `a${index + 1}`));
      expect(last()).toMatchObject({ tone: "success" });
    });
  });
});
