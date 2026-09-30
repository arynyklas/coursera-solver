export type ProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "xai"
  | "deepseek"
  | "groq"
  | "openrouter";

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
}

export interface RequirementsSummary {
  confirmed: boolean;
  totalGradingWeight: number;
  gradingWeightsComplete: boolean;
  requiredCount: number;
  lockedCount: number;
  unmappedCount: number;
  unresolvedCount: number;
}

export interface CourseRequirementsResult {
  requirements: Requirement[];
  summary: RequirementsSummary;
}

// `prompt` is the prompt parsed at extraction; applying writes only while the block still shows it.
export type QuestionHandle =
  | {
      kind: "choice";
      block: HTMLElement;
      prompt: string;
      multiple: boolean;
      options: { text: string; input: HTMLInputElement }[];
    }
  | {
      kind: "text";
      block: HTMLElement;
      prompt: string;
      field: HTMLInputElement | HTMLTextAreaElement;
    }
  | { kind: "essay"; block: HTMLElement; prompt: string; editor: HTMLElement }
  | {
      kind: "code";
      block: HTMLElement;
      prompt: string;
      modelUri: string;
      expectedValue: string;
    };

export interface ExtractedAssessment {
  questions: Question[];
  handles: Map<number, QuestionHandle>;
  issues: ParserIssue[];
}
