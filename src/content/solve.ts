import { applyAnswers } from "@/content/apply-answers";
import type { BannerController } from "@/content/banner/store";
import { extractAssessment } from "@/content/extract";
import type { MonacoClient } from "@/content/monaco-client";
import { errorMessage } from "@/shared/messaging";
import type { Answer, Question } from "@/shared/types";

export const SOLVE_BUSY_MESSAGE = "A quiz is already being solved on this page.";

/**
 * Questions per AI request. A reasoning model can think for minutes over a whole quiz, past the
 * request timeout or a server's own limit; a few questions each finish sooner, side by side.
 */
const QUESTIONS_PER_REQUEST = 5;
/** Requests waiting at once, which keeps a big exam under the providers' per-minute limits. */
const PARALLEL_REQUESTS = 4;

export interface SolveDeps {
  doc: Document;
  monaco: MonacoClient;
  banner: BannerController;
  requestAnswers(questions: Question[]): Promise<Answer[]>;
  providerLabel(): Promise<string>;
  slateDelayMs?: number;
}

export interface SolveRunner {
  start(): { done: Promise<void> };
}

// Port of content.js:295-325 in v1.1.0 (c2f8b71) with the single-run guard (F5) and spec §5.1
// banner copy.
export function createSolveRunner(deps: SolveDeps): SolveRunner {
  const { doc, monaco, banner } = deps;
  let running = false;

  async function run(): Promise<void> {
    const title = "Solving quiz";
    try {
      banner.show({ tone: "info", title, description: "Reading questions…" });
      const { questions, handles, issues } = await extractAssessment(doc, monaco);
      if (questions.length === 0) {
        throw new Error("No supported questions were found on this page.");
      }

      const label = await deps.providerLabel();
      const count = questions.length;
      const imageCount = questions.reduce((total, { images }) => total + (images?.length ?? 0), 0);
      const images =
        imageCount === 0 ? "" : ` with ${imageCount} ${imageCount === 1 ? "image" : "images"}`;
      const parts = Array.from({ length: Math.ceil(count / QUESTIONS_PER_REQUEST) }, (_, index) =>
        questions.slice(index * QUESTIONS_PER_REQUEST, (index + 1) * QUESTIONS_PER_REQUEST),
      );
      const asking = `Asking ${label} about ${count} ${count === 1 ? "question" : "questions"}${images}${parts.length > 1 ? ` in ${parts.length} parts` : ""}…`;
      banner.show({
        tone: "info",
        title,
        description: asking,
        ...(parts.length > 1 ? { progress: 0 } : {}),
      });

      // A part that fails costs only its own questions; the rest are still filled in.
      const answers: Answer[] = [];
      const unanswered: { questionNumber: number; message: string }[] = [];
      let firstError: unknown;
      let finished = 0;
      const queue = parts.values();
      await Promise.all(
        Array.from({ length: Math.min(PARALLEL_REQUESTS, parts.length) }, async () => {
          // The workers share one queue, so each part is asked once.
          for (const part of queue) {
            try {
              answers.push(...(await deps.requestAnswers(part)));
            } catch (error) {
              firstError ??= error;
              const message = errorMessage(error, "Could not solve this assessment.");
              unanswered.push(...part.map(({ questionNumber }) => ({ questionNumber, message })));
            }
            finished += 1;
            if (parts.length > 1) {
              banner.show({
                tone: "info",
                title,
                description: asking,
                progress: finished / parts.length,
              });
            }
          }
        }),
      );
      // Nothing came back: the request error says why, as for a quiz asked in one request.
      if (unanswered.length === count) throw firstError;

      banner.show({ tone: "info", title, description: "Filling in answers…" });
      const { applied, failures } = await applyAnswers(answers, handles, monaco, {
        slateDelayMs: deps.slateDelayMs,
      });

      const problems = [...unanswered, ...failures, ...issues];
      if (problems.length === 0) {
        banner.show({
          tone: "success",
          title: "Answers added",
          description: `${applied.length} answer(s) filled in. Review them, then submit.`,
          autoHideMs: 4000,
        });
        return;
      }

      const numbers = [...new Set(problems.map((problem) => problem.questionNumber))]
        .filter((questionNumber) => questionNumber !== undefined)
        .sort((first, second) => first - second);
      banner.show({
        tone: "error",
        title: `Applied ${applied.length} of ${questions.length + issues.length} answers`,
        description: `Check question(s) ${numbers.join(", ")}: ${problems[0]?.message}`,
      });
    } catch (error) {
      banner.show({
        tone: "error",
        title: "Could not solve this quiz",
        description: errorMessage(error, "Could not solve this assessment."),
      });
    }
  }

  return {
    start() {
      if (running) throw new Error(SOLVE_BUSY_MESSAGE);
      running = true;
      const done = run().finally(() => {
        running = false;
      });
      return { done };
    },
  };
}
