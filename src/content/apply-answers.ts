import type { MonacoClient } from "@/content/monaco-client";
import { optionText, SELECTORS } from "@/coursera/parser";
import type { Answer, QuestionHandle } from "@/shared/types";

export interface ApplyResult {
  applied: number[];
  failures: { questionNumber: number; message: string }[];
}

type ChoiceHandle = Extract<QuestionHandle, { kind: "choice" }>;

// Ported from legacy content.js:208-212.
export function cleanCodeAnswer(value: string): string {
  const fenced = value.match(/^\s*```(?:[a-z0-9_+-]+)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i);
  return fenced?.[1] ?? value;
}

// F4: bypass instance-level setters (React's value tracker) and announce the edit like typing.
export function setNativeValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(field, value);
  else field.value = value;
  field.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
  );
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

// F3: resolve every answer against the options' current text before clicking anything.
function applyChoice(handle: ChoiceHandle, correctOptions: string[]): string | null {
  const targets: HTMLInputElement[] = [];
  for (const answer of correctOptions) {
    const match = handle.options.find(({ input }) => {
      const option = input.closest(SELECTORS.option);
      return option !== null && optionText(option) === answer;
    });
    if (!match) return "The selected option no longer matches the page.";
    targets.push(match.input);
  }

  for (const input of targets) if (!input.checked) input.click();
  if (handle.multiple) {
    for (const { input } of handle.options) {
      if (input.checked && !targets.includes(input)) input.click();
    }
  }
  return null;
}

// Port of legacy content.js:214-293, writing only through extraction handles (F2).
export async function applyAnswers(
  answers: Answer[],
  handles: Map<number, QuestionHandle>,
  monaco: Pick<MonacoClient, "replace">,
  options: { slateDelayMs?: number } = {},
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], failures: [] };

  for (const { questionNumber, correctOptions } of answers) {
    const [text] = correctOptions;
    // Legacy content.js:225 skips answers without options.
    if (text === undefined) continue;

    const handle = handles.get(questionNumber);
    let failure: string | null = null;
    if (!handle?.block.isConnected) {
      failure = "The question is no longer on the page.";
    } else if (handle.kind === "choice") {
      failure = applyChoice(handle, correctOptions);
    } else if (handle.kind === "text") {
      setNativeValue(handle.field, text);
    } else if (handle.kind === "essay") {
      // Slate only accepts edits through its beforeinput handling; execCommand is the reliable path.
      handle.editor.focus();
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, options.slateDelayMs ?? 50);
      await promise;
      document.execCommand("selectAll");
      document.execCommand("insertText", false, text);
    } else {
      const code = cleanCodeAnswer(text);
      if (!code.trim()) {
        failure = "The AI returned empty code.";
      } else {
        try {
          await monaco.replace(handle.modelUri, handle.expectedValue, code);
        } catch (error) {
          failure =
            (error instanceof Error && error.message) || "Could not update the code editor.";
        }
      }
    }

    if (failure) result.failures.push({ questionNumber, message: failure });
    else result.applied.push(questionNumber);
  }

  return result;
}
