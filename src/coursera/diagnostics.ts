import type { SelectorStrategy } from "@/shared/types";

export interface DryRunQuestionSummary {
  questionNumber: number;
  type: string;
  optionCount: number;
  hasPrompt: boolean;
  hasCode: boolean;
}

export interface DryRunIssueSummary {
  index: number;
  message: "Parser issue";
  questionNumber?: number;
  code?: string;
}

export interface CourseStateSummary {
  onCourseRoute: boolean;
  courseRevision: number;
  hasCourseMaterials: boolean;
  observedHeaderNames: string[];
  hasUserContext: boolean;
}

export interface ParserDiagnosticsSummary {
  selectorStrategy: SelectorStrategy | "unknown";
  semanticCandidates: number;
  semanticPrompts: number;
  legacyCandidates: number;
  legacyPrompts: number;
  invalidCandidates: number;
  selectedBlocks: number;
  state: CourseStateSummary | null;
}

export interface DryRunGuarantees {
  aiCalled: false;
  domModified: false;
  answerFilled: false;
  submitted: false;
}

export interface DryRunReport {
  mode: "read-only";
  generatedAt: string;
  totalQuestions: number;
  issueCount: number;
  questionTypes: Record<string, number>;
  questions: DryRunQuestionSummary[];
  issues: DryRunIssueSummary[];
  truncatedIssues: number;
  parser: ParserDiagnosticsSummary | null;
  guarantees: DryRunGuarantees;
}

// Inputs are sanitized defensively, as in legacy diagnostics.js: the report must never copy
// prompts, answers, slugs or header values, whatever shape the caller passes.
type Loose = Record<string, unknown>;

const SAFE_HEADER_NAMES: ReadonlySet<string> = new Set([
  "x-csrf2-cookie",
  "x-csrf2-token",
  "x-csrf3-token",
  "x-csrftoken",
  "x-requested-with",
]);

const SELECTOR_STRATEGIES: Record<string, true> = {
  semantic: true,
  legacy: true,
  mixed: true,
  none: true,
};

function normalizedText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeCount(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function summarizeQuestion(question: unknown, index: number): DryRunQuestionSummary {
  const safeQuestion: Loose = question && typeof question === "object" ? (question as Loose) : {};
  const options = Array.isArray(safeQuestion.options) ? safeQuestion.options : [];
  const number = Number(safeQuestion.questionNumber);

  return {
    questionNumber: Number.isInteger(number) && number > 0 ? number : index + 1,
    type: normalizedText(safeQuestion.type).toLowerCase() || "unknown",
    optionCount: options.length,
    hasPrompt: Boolean(
      normalizedText(safeQuestion.question) ||
        normalizedText(safeQuestion.prompt) ||
        normalizedText(safeQuestion.text) ||
        normalizedText(safeQuestion.title),
    ),
    hasCode: Boolean(
      normalizedText(safeQuestion.code) ||
        normalizedText(safeQuestion.starterCode) ||
        normalizedText(safeQuestion.editorValue) ||
        normalizedText(safeQuestion.language) ||
        safeQuestion.codeEditor === true ||
        safeQuestion.isCodeQuestion === true,
    ),
  };
}

function summarizeIssue(issue: unknown, index: number): DryRunIssueSummary {
  const summary: DryRunIssueSummary = {
    index: index + 1,
    message: "Parser issue",
  };

  if (!issue || typeof issue !== "object") return summary;
  const safeIssue = issue as Loose;

  const questionNumber = Number(safeIssue.questionNumber);
  if (Number.isInteger(questionNumber) && questionNumber > 0) {
    summary.questionNumber = questionNumber;
  }

  const code = normalizedText(safeIssue.code || safeIssue.type);
  if (code) summary.code = code.slice(0, 80);

  return summary;
}

export function summarizeCourseState(value: unknown): CourseStateSummary | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Loose;
  const observedHeaderNames = Array.isArray(state.observedHeaderNames)
    ? [
        ...new Set(
          state.observedHeaderNames
            .map((name) => normalizedText(name).toLowerCase())
            .filter((name) => SAFE_HEADER_NAMES.has(name)),
        ),
      ]
        .sort()
        .slice(0, 10)
    : [];

  return {
    onCourseRoute: state.onCourseRoute === true,
    courseRevision: safeCount(state.courseRevision),
    hasCourseMaterials: state.hasCourseMaterials === true,
    observedHeaderNames,
    hasUserContext: state.hasUserContext === true,
  };
}

export function summarizeParserDiagnostics(value: unknown): ParserDiagnosticsSummary | null {
  if (!value || typeof value !== "object") return null;
  const diagnostics = value as Loose;
  const selectors: Loose =
    diagnostics.selectors && typeof diagnostics.selectors === "object"
      ? (diagnostics.selectors as Loose)
      : {};

  const strategy = normalizedText(selectors.strategy).toLowerCase();
  return {
    selectorStrategy: Object.hasOwn(SELECTOR_STRATEGIES, strategy)
      ? (strategy as SelectorStrategy)
      : "unknown",
    semanticCandidates: safeCount(selectors.semanticCandidates),
    semanticPrompts: safeCount(selectors.semanticPrompts),
    legacyCandidates: safeCount(selectors.legacyCandidates),
    legacyPrompts: safeCount(selectors.legacyPrompts),
    invalidCandidates: safeCount(selectors.invalidCandidates),
    selectedBlocks: safeCount(selectors.selectedBlocks),
    state: summarizeCourseState(diagnostics.state),
  };
}

/**
 * Accepts `Question[]`, `ParserIssue[]` and `ParserDiagnostics | null`; the parameters are
 * `unknown` so malformed input is sanitized rather than trusted.
 */
export function buildDryRunReport(
  questions: readonly unknown[],
  issues: readonly unknown[],
  parserDiagnostics?: unknown,
): DryRunReport {
  const questionList = Array.isArray(questions) ? questions : [];
  const issueList = Array.isArray(issues) ? issues : [];
  const questionSummaries = questionList.map(summarizeQuestion);
  const typeCounts: Record<string, number> = {};

  for (const question of questionSummaries) {
    typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
  }

  return {
    mode: "read-only",
    generatedAt: new Date().toISOString(),
    totalQuestions: questionSummaries.length,
    issueCount: issueList.length,
    questionTypes: typeCounts,
    questions: questionSummaries,
    issues: issueList.slice(0, 20).map(summarizeIssue),
    truncatedIssues: Math.max(0, issueList.length - 20),
    parser: summarizeParserDiagnostics(parserDiagnostics),
    guarantees: {
      aiCalled: false,
      domModified: false,
      answerFilled: false,
      submitted: false,
    },
  };
}

export function formatDryRunSummary(
  report: Partial<Pick<DryRunReport, "totalQuestions" | "issueCount">> | null | undefined,
): string {
  const totalQuestions = Number(report?.totalQuestions) || 0;
  const issueCount = Number(report?.issueCount) || 0;
  const questionLabel = totalQuestions === 1 ? "question" : "questions";
  const issueLabel = issueCount === 1 ? "parser issue" : "parser issues";
  return `Dry run complete: ${totalQuestions} ${questionLabel} detected, ${issueCount} ${issueLabel}. No page changes were made.`;
}
