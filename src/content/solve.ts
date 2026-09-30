import { applyAnswers } from "@/content/apply-answers";
import type { BannerController } from "@/content/banner/store";
import { extractAssessment } from "@/content/extract";
import type { MonacoClient } from "@/content/monaco-client";
import { errorMessage } from "@/shared/messaging";
import type { Answer, Question } from "@/shared/types";

export const SOLVE_BUSY_MESSAGE = "A quiz is already being solved on this page.";

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

// Port of legacy content.js:295-325 with the single-run guard (F5) and spec §5.1 banner copy.
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
      banner.show({
        tone: "info",
        title,
        description: `Asking ${label} about ${count} ${count === 1 ? "question" : "questions"}…`,
      });
      const answers = await deps.requestAnswers(questions);

      banner.show({ tone: "info", title, description: "Filling in answers…" });
      const { applied, failures } = await applyAnswers(answers, handles, monaco, {
        slateDelayMs: deps.slateDelayMs,
      });

      const problems = [...failures, ...issues];
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
