import type { SelectorDiagnostics, SelectorStrategy, SupportedQuestionType } from "@/shared/types";

export const SELECTORS = {
  semanticBlock: '[data-testid^="part-Submission_"]',
  semanticPrompt: '[id^="prompt-"] [data-testid="cml-viewer"]',
  legacyBlock: ".css-1erl2aq, .css-12u8wr5",
  option: ".rc-Option",
  writtenInput: 'input[type="text"], input:not([type]), textarea:not(.inputarea)',
  optionText: '[data-testid="cml-viewer"]',
  optionInput: 'input[type="radio"], input[type="checkbox"]',
  slateEditor: '[data-slate-editor="true"]',
} as const;

const CODE_QUESTION_TESTID = "part-Submission_CodeExpressionQuestion";

export type HandleDraft =
  | {
      kind: "choice";
      block: HTMLElement;
      multiple: boolean;
      options: { text: string; input: HTMLInputElement }[];
    }
  | { kind: "text"; block: HTMLElement; field: HTMLInputElement | HTMLTextAreaElement }
  | { kind: "essay"; block: HTMLElement; editor: HTMLElement }
  | { kind: "code"; block: HTMLElement }
  | { kind: "unsupported"; block: HTMLElement };

export interface ParsedBlock {
  questionNumber: number;
  prompt: string;
  type: SupportedQuestionType | "unknown";
  options: string[];
  handle: HandleDraft;
}

interface SelectorState {
  strategy: SelectorStrategy;
  semanticCandidates: HTMLElement[];
  semanticBlocks: HTMLElement[];
  legacyCandidates: HTMLElement[];
  legacyBlocks: HTMLElement[];
  selectedBlocks: HTMLElement[];
  invalidCandidates: number;
}

function visibleText(node: Element): string {
  const innerText = "innerText" in node ? String(node.innerText ?? "") : "";
  return (innerText || node.textContent || "").trim();
}

function hasPrompt(block: Element): boolean {
  return block.querySelector(SELECTORS.semanticPrompt) !== null;
}

function selectorState(root: ParentNode): SelectorState {
  const semanticCandidates = Array.from(
    root.querySelectorAll<HTMLElement>(SELECTORS.semanticBlock),
  );
  const semanticBlocks = semanticCandidates.filter(hasPrompt);
  const legacyCandidates = Array.from(root.querySelectorAll<HTMLElement>(SELECTORS.legacyBlock));
  const legacyBlocks = legacyCandidates.filter(hasPrompt);
  const distinctLegacyBlocks = legacyBlocks.filter(
    (legacy) =>
      !semanticBlocks.some(
        (semantic) => legacy === semantic || legacy.contains(semantic) || semantic.contains(legacy),
      ),
  );
  const selectedBlocks = [...semanticBlocks, ...distinctLegacyBlocks].sort((first, second) => {
    if (first === second) return 0;
    const position = first.compareDocumentPosition(second);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  const uniqueCandidates = new Set([...semanticCandidates, ...legacyCandidates]);

  let strategy: SelectorStrategy = "none";
  if (semanticBlocks.length > 0 && distinctLegacyBlocks.length > 0) strategy = "mixed";
  else if (semanticBlocks.length > 0) strategy = "semantic";
  else if (legacyBlocks.length > 0) strategy = "legacy";

  let invalidCandidates = 0;
  for (const candidate of uniqueCandidates) if (!hasPrompt(candidate)) invalidCandidates += 1;

  return {
    strategy,
    semanticCandidates,
    semanticBlocks,
    legacyCandidates,
    legacyBlocks,
    selectedBlocks,
    invalidCandidates,
  };
}

export function assessmentQuestionBlocks(root: ParentNode): HTMLElement[] {
  return selectorState(root).selectedBlocks;
}

export function selectorDiagnostics(root: ParentNode): SelectorDiagnostics {
  const state = selectorState(root);
  return {
    strategy: state.strategy,
    semanticCandidates: state.semanticCandidates.length,
    semanticPrompts: state.semanticBlocks.length,
    legacyCandidates: state.legacyCandidates.length,
    legacyPrompts: state.legacyBlocks.length,
    invalidCandidates: state.invalidCandidates,
    selectedBlocks: state.selectedBlocks.length,
  };
}

export function promptText(block: Element): string {
  const promptNode = block.querySelector(SELECTORS.semanticPrompt);
  return promptNode ? visibleText(promptNode) : "";
}

export function isCodeQuestion(block: Element): boolean {
  return block.getAttribute("data-testid") === CODE_QUESTION_TESTID;
}

export function optionText(option: Element): string {
  const textNode = option.querySelector(SELECTORS.optionText);
  return textNode ? visibleText(textNode) : "";
}

function classify(block: HTMLElement): Pick<ParsedBlock, "type" | "options" | "handle"> {
  if (isCodeQuestion(block)) {
    return { type: "code_expression", options: [], handle: { kind: "code", block } };
  }

  const choices: { text: string; input: HTMLInputElement }[] = [];
  for (const option of block.querySelectorAll(SELECTORS.option)) {
    const input = option.querySelector<HTMLInputElement>(SELECTORS.optionInput);
    const text = optionText(option);
    if (input && text) choices.push({ text, input });
  }
  const firstChoice = choices[0];
  if (firstChoice) {
    const type = firstChoice.input.type === "radio" ? "single_answer" : "multiple_answer";
    return {
      type,
      options: choices.map((choice) => choice.text),
      handle: { kind: "choice", block, multiple: type === "multiple_answer", options: choices },
    };
  }

  const editor = block.querySelector<HTMLElement>(SELECTORS.slateEditor);
  if (editor) return { type: "essay", options: [], handle: { kind: "essay", block, editor } };

  const field = block.querySelector<HTMLInputElement | HTMLTextAreaElement>(SELECTORS.writtenInput);
  if (field) return { type: "text_input", options: [], handle: { kind: "text", block, field } };

  return { type: "unknown", options: [], handle: { kind: "unsupported", block } };
}

export function parseQuestionBlock(block: HTMLElement, questionNumber: number): ParsedBlock | null {
  const prompt = promptText(block);
  if (!prompt) return null;
  return { questionNumber, prompt, ...classify(block) };
}

export function parseAssessment(root: ParentNode): {
  blocks: ParsedBlock[];
  missingPrompt: number[];
} {
  const blocks: ParsedBlock[] = [];
  const missingPrompt: number[] = [];

  assessmentQuestionBlocks(root).forEach((block, index) => {
    const questionNumber = index + 1;
    const parsed = parseQuestionBlock(block, questionNumber);
    if (parsed) blocks.push(parsed);
    else missingPrompt.push(questionNumber);
  });

  return { blocks, missingPrompt };
}
