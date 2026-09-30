import type { DialogueMessage } from "@/shared/types";

export interface DialogueState {
  root: Element;
  composer: HTMLTextAreaElement;
  currentQuestion: string;
  messages: DialogueMessage[];
}

const COACH_MESSAGE = '[data-testid="chat-message-llm"] [data-testid="coach-message-markdown"]';

function innerText(node: Element): string {
  return (node as HTMLElement).innerText.trim();
}

// Learner text without controls or live-region chrome; works on a detached copy.
function dialogueMessageText(item: Element): string {
  const copy = item.cloneNode(true) as Element;
  for (const node of copy.querySelectorAll(
    'button, [role="toolbar"], [role="status"], [aria-live]',
  )) {
    node.remove();
  }
  return innerText(copy);
}

// Ported from legacy content.js:327-378.
export function extractDialogueState(doc: Document): DialogueState {
  const root = doc.querySelector('[data-testid="coursera-coach-item"], #coursera-coach-item');
  if (!root) {
    throw new Error("No Coursera dialogue was found on this page.");
  }

  const composer = root.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Send a message"]:not([aria-hidden="true"]):not([readonly])',
  );
  if (!composer || composer.disabled || composer.closest('[aria-disabled="true"]')) {
    throw new Error("Start the Coursera dialogue and wait for its question first.");
  }

  const currentQuestion = Array.from(root.querySelectorAll(COACH_MESSAGE))
    .map(innerText)
    .filter(Boolean)
    .at(-1);

  if (!currentQuestion) {
    throw new Error("No active Coursera dialogue question was found.");
  }

  const seenMessages = new Set<string>();
  const messages = Array.from(root.querySelectorAll('[role="list"] > [role="listitem"]'))
    .map((item): DialogueMessage => {
      const coachContent = item.querySelector(COACH_MESSAGE);
      return coachContent
        ? { role: "coach", text: innerText(coachContent) }
        : { role: "learner", text: dialogueMessageText(item) };
    })
    .filter((message) => {
      if (!message.text) return false;
      const fingerprint = `${message.role}:${message.text}`;
      if (seenMessages.has(fingerprint)) return false;
      seenMessages.add(fingerprint);
      return true;
    });

  return { root, composer, currentQuestion, messages };
}
