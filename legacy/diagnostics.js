(function (root, factory) {
  const api = factory();
  root.CourseraDiagnostics = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SAFE_HEADER_NAMES = new Set([
    "x-csrf2-cookie",
    "x-csrf2-token",
    "x-csrf3-token",
    "x-csrftoken",
    "x-requested-with"
  ]);

  function normalizedText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeQuestionType(value) {
    const type = normalizedText(value).toLowerCase();
    return type || "unknown";
  }

  function normalizedQuestionNumber(value, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function questionHasPrompt(question) {
    return Boolean(
      normalizedText(question?.question) ||
      normalizedText(question?.prompt) ||
      normalizedText(question?.text) ||
      normalizedText(question?.title)
    );
  }

  function questionHasCode(question) {
    return Boolean(
      normalizedText(question?.code) ||
      normalizedText(question?.starterCode) ||
      normalizedText(question?.editorValue) ||
      normalizedText(question?.language) ||
      question?.codeEditor === true ||
      question?.isCodeQuestion === true
    );
  }

  function summarizeQuestion(question, index) {
    const safeQuestion = question && typeof question === "object" ? question : {};
    const options = Array.isArray(safeQuestion.options) ? safeQuestion.options : [];

    return {
      questionNumber: normalizedQuestionNumber(safeQuestion.questionNumber, index + 1),
      type: normalizeQuestionType(safeQuestion.type),
      optionCount: options.length,
      hasPrompt: questionHasPrompt(safeQuestion),
      hasCode: questionHasCode(safeQuestion)
    };
  }

  function summarizeIssue(issue, index) {
    const summary = {
      index: index + 1,
      message: "Parser issue"
    };

    if (!issue || typeof issue !== "object") return summary;

    const questionNumber = Number(issue.questionNumber);
    if (Number.isInteger(questionNumber) && questionNumber > 0) {
      summary.questionNumber = questionNumber;
    }

    const code = normalizedText(issue.code || issue.type);
    if (code) summary.code = code.slice(0, 80);

    return summary;
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }

  function summarizeCourseState(value) {
    if (!value || typeof value !== "object") return null;
    const observedHeaderNames = Array.isArray(value.observedHeaderNames)
      ? [...new Set(value.observedHeaderNames
        .map((name) => normalizedText(name).toLowerCase())
        .filter((name) => SAFE_HEADER_NAMES.has(name)))]
        .sort()
        .slice(0, 10)
      : [];

    return {
      onCourseRoute: value.onCourseRoute === true,
      courseRevision: safeCount(value.courseRevision),
      hasCourseMaterials: value.hasCourseMaterials === true,
      observedHeaderNames,
      hasUserContext: value.hasUserContext === true
    };
  }

  function summarizeParserDiagnostics(value) {
    if (!value || typeof value !== "object") return null;
    const selectors = value.selectors && typeof value.selectors === "object" ? value.selectors : {};
    const modules = value.modules && typeof value.modules === "object" ? value.modules : {};
    const safeModules = {};

    Object.entries(modules).slice(0, 10).forEach(([key, moduleName]) => {
      const safeKey = normalizedText(key).slice(0, 60);
      const safeValue = normalizedText(moduleName).slice(0, 100);
      if (safeKey && safeValue) safeModules[safeKey] = safeValue;
    });

    const strategy = normalizedText(selectors.strategy).toLowerCase();
    return {
      selectorStrategy: ["semantic", "legacy", "mixed", "none"].includes(strategy) ? strategy : "unknown",
      semanticCandidates: safeCount(selectors.semanticCandidates),
      semanticPrompts: safeCount(selectors.semanticPrompts),
      legacyCandidates: safeCount(selectors.legacyCandidates),
      legacyPrompts: safeCount(selectors.legacyPrompts),
      invalidCandidates: safeCount(selectors.invalidCandidates),
      selectedBlocks: safeCount(selectors.selectedBlocks),
      state: summarizeCourseState(value.state),
      modules: safeModules
    };
  }

  function buildDryRunReport(questions, issues, parserDiagnostics) {
    const questionList = Array.isArray(questions) ? questions : [];
    const issueList = Array.isArray(issues) ? issues : [];
    const questionSummaries = questionList.map(summarizeQuestion);
    const typeCounts = {};

    questionSummaries.forEach((question) => {
      typeCounts[question.type] = (typeCounts[question.type] || 0) + 1;
    });

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
        submitted: false
      }
    };
  }

  function formatDryRunSummary(report) {
    const safeReport = report && typeof report === "object" ? report : {};
    const totalQuestions = Number(safeReport.totalQuestions) || 0;
    const issueCount = Number(safeReport.issueCount) || 0;
    const questionLabel = totalQuestions === 1 ? "question" : "questions";
    const issueLabel = issueCount === 1 ? "parser issue" : "parser issues";
    return `Dry run complete: ${totalQuestions} ${questionLabel} detected, ${issueCount} ${issueLabel}. No page changes were made.`;
  }

  return {
    buildDryRunReport,
    formatDryRunSummary,
    summarizeQuestion,
    summarizeIssue,
    summarizeCourseState,
    summarizeParserDiagnostics
  };
});
