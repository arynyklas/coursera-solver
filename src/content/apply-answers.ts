import type { MonacoClient } from "@/content/monaco-client";
import { describeCodeEditor } from "@/coursera/monaco-dom";
import { type HandleDraft, parseQuestionBlock } from "@/coursera/parser";
import type { Answer, QuestionHandle } from "@/shared/types";

export interface ApplyResult {
  applied: number[];
  failures: { questionNumber: number; message: string }[];
}

type ChoiceDraft = Extract<HandleDraft, { kind: "choice" }>;
type CodeHandle = Extract<QuestionHandle, { kind: "code" }>;

const STALE_QUESTION = "The question is no longer on the page.";

// Ported from content.js:208-212 in v1.1.0 (c2f8b71).
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
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }),
  );
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

// React can remount a block's inner nodes during the AI wait, or reuse the block for another
// question. Re-parse it and hand back the nodes rendered now, only while it shows the same question.
function currentDraft(handle: QuestionHandle, questionNumber: number): HandleDraft | null {
  if (!handle.block.isConnected) return null;
  const fresh = parseQuestionBlock(handle.block, questionNumber);
  if (!fresh || fresh.prompt !== handle.prompt) return null;
  return fresh.handle;
}

// F3: check every chosen option before clicking anything. The numbers count the options read at
// extraction, so they apply only while the page shows those options, in that order.
function applyChoice(
  draft: ChoiceDraft,
  extracted: string[],
  optionNumbers: number[],
): string | null {
  const unchanged =
    draft.options.length === extracted.length &&
    draft.options.every(({ text }, index) => text === extracted[index]);
  const targets = optionNumbers.flatMap((number) => draft.options[number - 1]?.input ?? []);
  if (!unchanged || targets.length !== optionNumbers.length) {
    return "The selected option no longer matches the page.";
  }

  for (const input of targets) if (!input.checked) input.click();
  if (draft.multiple) {
    for (const { input } of draft.options) {
      if (input.checked && !targets.includes(input)) input.click();
    }
  }
  return null;
}

async function applyEssay(
  editor: HTMLElement,
  text: string,
  delayMs: number,
): Promise<string | null> {
  // Slate only accepts edits through its beforeinput handling; execCommand is the reliable path.
  editor.focus();
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, delayMs);
  await promise;
  // execCommand edits whatever holds focus, so never type unless the editor has it.
  const active = document.activeElement;
  if (active !== editor && !editor.contains(active)) return "No supported answer field was found.";
  document.execCommand("selectAll");
  document.execCommand("insertText", false, text);
  return null;
}

async function applyCode(
  handle: CodeHandle,
  text: string,
  monaco: Pick<MonacoClient, "replace">,
): Promise<string | null> {
  try {
    if (describeCodeEditor(handle.block).modelUri !== handle.modelUri) return STALE_QUESTION;
  } catch {
    return STALE_QUESTION;
  }

  const code = cleanCodeAnswer(text);
  if (!code.trim()) return "The AI returned empty code.";
  try {
    await monaco.replace(handle.modelUri, handle.expectedValue, code);
    return null;
  } catch (error) {
    return (error instanceof Error && error.message) || "Could not update the code editor.";
  }
}

// Port of content.js:214-293 in v1.1.0 (c2f8b71), writing only into blocks from extraction (F2)
// through the nodes they render at apply time.
export async function applyAnswers(
  answers: Answer[],
  handles: Map<number, QuestionHandle>,
  monaco: Pick<MonacoClient, "replace">,
  options: { slateDelayMs?: number } = {},
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], failures: [] };

  for (const answer of answers) {
    const { questionNumber } = answer;
    const handle = handles.get(questionNumber);
    const draft = handle && currentDraft(handle, questionNumber);
    let failure: string | null = STALE_QUESTION;
    if ("optionNumbers" in answer) {
      if (handle?.kind === "choice" && draft?.kind === "choice") {
        failure = applyChoice(draft, handle.options, answer.optionNumbers);
      }
    } else if (handle?.kind === "text" && draft?.kind === "text") {
      setNativeValue(draft.field, answer.text);
      failure = null;
    } else if (handle?.kind === "essay" && draft?.kind === "essay") {
      failure = await applyEssay(draft.editor, answer.text, options.slateDelayMs ?? 50);
    } else if (handle?.kind === "code" && draft?.kind === "code") {
      failure = await applyCode(handle, answer.text, monaco);
    }

    if (failure) result.failures.push({ questionNumber, message: failure });
    else result.applied.push(questionNumber);
  }

  return result;
}
