import { describe, expect, it } from "vitest";
import {
  buildDryRunReport,
  formatDryRunSummary,
  summarizeCourseState,
  summarizeParserDiagnostics,
} from "@/coursera/diagnostics";

// Ported from legacy/tests/diagnostics.test.js. Question and issue summaries are read from the
// report, the only public surface that produces them.
describe("dry-run diagnostics", () => {
  it("builds a metadata-only dry-run report", () => {
    const questions = [
      { questionNumber: 1, type: "single_answer", question: "Secret prompt", options: ["A", "B"] },
      {
        questionNumber: 2,
        type: "multiple_answer",
        prompt: "Another prompt",
        options: ["A", "B", "C"],
      },
      { questionNumber: 3, type: "text_input", text: "Written response", options: [] },
    ];

    const report = buildDryRunReport(questions, []);

    expect(report.mode).toBe("read-only");
    expect(report.totalQuestions).toBe(3);
    expect(report.questionTypes).toEqual({
      single_answer: 1,
      multiple_answer: 1,
      text_input: 1,
    });
    expect(report.guarantees).toEqual({
      aiCalled: false,
      domModified: false,
      answerFilled: false,
      submitted: false,
    });
    expect(JSON.stringify(report).includes("Secret prompt")).toBe(false);
  });

  it("summarizes question capabilities without copying content", () => {
    const report = buildDryRunReport(
      [
        {
          questionNumber: 8,
          type: "programming",
          prompt: "Do not expose me",
          options: [],
          language: "python",
        },
      ],
      [],
    );
    expect(report.questions[0]).toEqual({
      questionNumber: 8,
      type: "programming",
      optionCount: 0,
      hasPrompt: true,
      hasCode: true,
    });
  });

  it("sanitizes parser issue details without exporting arbitrary error text", () => {
    const report = buildDryRunReport(
      [],
      [
        {
          questionNumber: 4,
          type: "missing-options",
          message: "Secret prompt fragment: private answer text",
          rawHtml: "<div>private page data</div>",
        },
        "Secret page text",
      ],
    );
    const [summary, stringIssue] = report.issues;

    expect(summary).toEqual({
      index: 1,
      message: "Parser issue",
      questionNumber: 4,
      code: "missing-options",
    });
    const serialized = JSON.stringify(summary);
    expect(serialized.includes("Secret prompt fragment")).toBe(false);
    expect(serialized.includes("private answer text")).toBe(false);
    expect(serialized.includes("private page data")).toBe(false);
    expect(stringIssue).toEqual({
      index: 2,
      message: "Parser issue",
    });
  });

  it("reports the code of a typed parser issue", () => {
    const report = buildDryRunReport(
      [],
      [{ questionNumber: 2, code: "missing-prompt", message: "Question 2 has no prompt text." }],
      null,
    );
    expect(report.issues).toEqual([
      { index: 1, message: "Parser issue", questionNumber: 2, code: "missing-prompt" },
    ]);
  });

  it("sanitizes course state without exporting course slugs or header values", () => {
    const summary = summarizeCourseState({
      courseSlug: "private-course-slug",
      onCourseRoute: true,
      courseRevision: 3,
      hasCourseMaterials: true,
      observedHeaderNames: ["X-CSRF3-Token", "Authorization", "x-requested-with"],
      hasUserContext: true,
      token: "secret",
    });

    expect(summary).toEqual({
      onCourseRoute: true,
      courseRevision: 3,
      hasCourseMaterials: true,
      observedHeaderNames: ["x-csrf3-token", "x-requested-with"],
      hasUserContext: true,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized.includes("private-course-slug")).toBe(false);
    expect(serialized.includes("secret")).toBe(false);
  });

  it("sanitizes mixed parser selector and state diagnostics", () => {
    expect(
      summarizeParserDiagnostics({
        selectors: {
          strategy: "mixed",
          semanticCandidates: 5,
          semanticPrompts: 4,
          legacyCandidates: 2,
          legacyPrompts: 2,
          invalidCandidates: 1,
          selectedBlocks: 6,
          rawHtml: "private",
        },
        state: {
          courseSlug: "do-not-export",
          onCourseRoute: true,
          courseRevision: 2,
          hasCourseMaterials: false,
          observedHeaderNames: ["x-csrf2-token"],
          hasUserContext: true,
        },
        modules: {
          assessmentParser: "assessment-parser.js",
          courseraApi: "coursera-api.js",
        },
        token: "secret",
      }),
    ).toEqual({
      selectorStrategy: "mixed",
      semanticCandidates: 5,
      semanticPrompts: 4,
      legacyCandidates: 2,
      legacyPrompts: 2,
      invalidCandidates: 1,
      selectedBlocks: 6,
      state: {
        onCourseRoute: true,
        courseRevision: 2,
        hasCourseMaterials: false,
        observedHeaderNames: ["x-csrf2-token"],
        hasUserContext: true,
      },
    });
  });

  it("attaches sanitized parser diagnostics to dry-run reports", () => {
    const report = buildDryRunReport([], [], {
      selectors: {
        strategy: "legacy",
        legacyCandidates: 3,
        legacyPrompts: 2,
        invalidCandidates: 1,
        selectedBlocks: 2,
      },
      state: { onCourseRoute: true, courseRevision: 1 },
      modules: { mode: "progressive-extraction" },
    });
    expect(report.parser?.selectorStrategy).toBe("legacy");
    expect(report.parser?.legacyCandidates).toBe(3);
    expect(report.parser?.legacyPrompts).toBe(2);
    expect(report.parser?.invalidCandidates).toBe(1);
    expect(report.parser?.selectedBlocks).toBe(2);
    expect(report.parser?.state?.onCourseRoute).toBe(true);
  });

  it("caps detailed issues while preserving the total count", () => {
    const issues = Array.from({ length: 24 }, (_, index) => `Issue ${index + 1}`);
    const report = buildDryRunReport([], issues);
    expect(report.issueCount).toBe(24);
    expect(report.issues).toHaveLength(20);
    expect(report.truncatedIssues).toBe(4);
  });

  it("formats a human-readable read-only summary", () => {
    expect(formatDryRunSummary({ totalQuestions: 2, issueCount: 1 })).toBe(
      "Dry run complete: 2 questions detected, 1 parser issue. No page changes were made.",
    );
  });
});
