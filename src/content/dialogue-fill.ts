import { setNativeValue } from "@/content/apply-answers";
import { extractDialogueState } from "@/coursera/dialogue";
import type { DialogueMessage } from "@/shared/types";

// Port of content.js:403-442 in v1.1.0 (c2f8b71).
export async function fillDialogueAnswer(
  doc: Document,
  draftReply: (messages: DialogueMessage[], currentQuestion: string) => Promise<string>,
): Promise<void> {
  const initialState = extractDialogueState(doc);
  if (initialState.composer.value.trim()) {
    throw new Error(
      "The dialogue message box already contains text. Clear it before generating an answer.",
    );
  }

  const reply = await draftReply(initialState.messages, initialState.currentQuestion);
  const currentState = extractDialogueState(doc);

  if (currentState.currentQuestion !== initialState.currentQuestion) {
    throw new Error(
      "The Coursera dialogue changed while the answer was being generated. Try again.",
    );
  }
  if (currentState.composer.value.trim()) {
    throw new Error("The dialogue message box changed while the answer was being generated.");
  }

  const { composer } = currentState;
  setNativeValue(composer, reply);
  composer.focus();
  composer.setSelectionRange(reply.length, reply.length);
}
