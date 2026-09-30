import type { CompletionRunner } from "@/content/completion";
import { loadCourseMaterials } from "@/content/course-materials";
import { fillDialogueAnswer } from "@/content/dialogue-fill";
import { extractAssessment } from "@/content/extract";
import type { MonacoClient } from "@/content/monaco-client";
import type { SolveRunner } from "@/content/solve";
import type { CourseState } from "@/coursera/course-state";
import { selectorDiagnostics } from "@/coursera/parser";
import { normalizeCourseRequirements } from "@/coursera/requirements";
import type { ContentRequests, Handlers } from "@/shared/messaging";
import type { DialogueMessage } from "@/shared/types";

export interface ContentRuntimeDeps {
  doc: Document;
  location(): string;
  state: CourseState;
  monaco: MonacoClient;
  solve: SolveRunner;
  completion: CompletionRunner;
  fetch: typeof fetch;
  draftReply(messages: DialogueMessage[], currentQuestion: string): Promise<string>;
}

// Replaces the listener at content.js:89-131 in v1.1.0 (c2f8b71) and the read runtime with
// typed handlers.
export function createContentHandlers(deps: ContentRuntimeDeps): Handlers<ContentRequests> {
  const { doc, location, state } = deps;

  return {
    async getQuestions() {
      const { questions, issues } = await extractAssessment(doc, deps.monaco);
      return { questions, issues };
    },
    async getCourseRequirements() {
      const materials = await loadCourseMaterials({ state, fetch: deps.fetch, location });
      return normalizeCourseRequirements(materials, state.snapshot().courseSlug);
    },
    getDiagnostics() {
      state.syncLocation(location());
      return { selectors: selectorDiagnostics(doc), state: state.snapshot() };
    },
    solveQuiz() {
      deps.solve.start();
      return { status: "started" };
    },
    async fillDialogue() {
      await fillDialogueAnswer(doc, deps.draftReply);
      return { status: "filled" };
    },
    completeMaterials() {
      deps.completion.start();
      return { status: "started" };
    },
  };
}
