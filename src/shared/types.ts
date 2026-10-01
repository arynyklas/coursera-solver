export type ProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "xai"
  | "deepseek"
  | "groq"
  | "openrouter"
  | "vllm";

export type SupportedQuestionType =
  | "single_answer"
  | "multiple_answer"
  | "text_input"
  | "essay"
  | "code_expression";

export interface Question {
  questionNumber: number;
  type: SupportedQuestionType;
  question: string;
  options: string[];
  language?: string;
  currentCode?: string;
}

export interface Answer {
  questionNumber: number;
  correctOptions: string[];
}

export type ParserIssueCode =
  | "missing-prompt"
  | "unsupported-question"
  | "code-editor-unavailable"
  | "code-read-failed";

export interface ParserIssue {
  questionNumber?: number;
  code: ParserIssueCode;
  message: string;
}

export interface DialogueMessage {
  role: "coach" | "learner";
  text: string;
}

export type SelectorStrategy = "semantic" | "legacy" | "mixed" | "none";

export interface SelectorDiagnostics {
  strategy: SelectorStrategy;
  semanticCandidates: number;
  semanticPrompts: number;
  legacyCandidates: number;
  legacyPrompts: number;
  invalidCandidates: number;
  selectedBlocks: number;
}

export interface CourseStateSnapshot {
  courseSlug: string;
  onCourseRoute: boolean;
  courseRevision: number;
  hasCourseMaterials: boolean;
  observedHeaderNames: string[];
  hasUserContext: boolean;
}

export interface ParserDiagnostics {
  selectors: SelectorDiagnostics;
  state: CourseStateSnapshot;
}

export interface CourseMaterials {
  elements?: Array<{
    id?: string;
    moduleIds?: string[];
    modules?: Array<{ lessons?: Array<{ itemIds?: string[] }> }>;
  }>;
  linked?: Record<string, unknown[] | undefined>;
}

export interface GroupRequirement {
  name: string;
  requiredPassedCount: number;
  choiceCount: number;
}

/**
 * The learner's progress on a requirement, as Coursera records it per item: `completed` once
 * Coursera marks the item completed, `started` once it was opened or attempted.
 */
export type RequirementStatus = "completed" | "started" | "notStarted";

export interface Requirement {
  id: string;
  name: string;
  type: string;
  moduleName: string;
  lessonName: string;
  gradingWeight: number | null;
  weightPercent: number | null;
  requiredForPassing: boolean;
  groupRequirement: GroupRequirement | null;
  locked: boolean;
  lockReason: string;
  timeCommitment: number | null;
  source: "confirmed" | "detected";
  link: string | null;
  /** `null` when the learner's progress could not be read. */
  status: RequirementStatus | null;
}

export interface RequirementsSummary {
  confirmed: boolean;
  totalGradingWeight: number;
  gradingWeightsComplete: boolean;
  requiredCount: number;
  lockedCount: number;
  unmappedCount: number;
  unresolvedCount: number;
  /** `null` when the learner's progress could not be read. */
  completedCount: number | null;
}

export interface CourseRequirementsResult {
  requirements: Requirement[];
  summary: RequirementsSummary;
}

// A handle identifies a question block and the prompt parsed at extraction. Applying re-parses the
// block for fresh nodes and writes only while it still shows that prompt and kind.
export type QuestionHandle =
  | { kind: "choice" | "text" | "essay"; block: HTMLElement; prompt: string }
  | { kind: "code"; block: HTMLElement; prompt: string; modelUri: string; expectedValue: string };

export interface ExtractedAssessment {
  questions: Question[];
  handles: Map<number, QuestionHandle>;
  issues: ParserIssue[];
}
