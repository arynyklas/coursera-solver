(function (root, factory) {
  const api = factory();
  root.AssessmentParserKit = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SEMANTIC_BLOCK_SELECTOR = '[data-testid^="part-Submission_"]';
  const SEMANTIC_PROMPT_SELECTOR = '[id^="prompt-"] [data-testid="cml-viewer"]';
  const LEGACY_BLOCK_SELECTOR = ".css-1erl2aq, .css-12u8wr5";
  const OPTION_SELECTOR = ".rc-Option";
  const WRITTEN_INPUT_SELECTOR = 'input[type="text"], input:not([type]), textarea:not(.inputarea)';
  const DOCUMENT_POSITION_PRECEDING = 2;
  const DOCUMENT_POSITION_FOLLOWING = 4;

  function hasPrompt(block) {
    return Boolean(block?.querySelector?.(SEMANTIC_PROMPT_SELECTOR));
  }

  function blocksOverlap(first, second) {
    if (first === second) return true;
    if (typeof first?.contains === "function" && first.contains(second)) return true;
    if (typeof second?.contains === "function" && second.contains(first)) return true;
    return false;
  }

  function sortInDocumentOrder(blocks) {
    return blocks.slice().sort((first, second) => {
      if (first === second || typeof first?.compareDocumentPosition !== "function") return 0;
      const position = first.compareDocumentPosition(second);
      if (position & DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  function selectorState(doc) {
    const semanticCandidates = Array.from(doc.querySelectorAll(SEMANTIC_BLOCK_SELECTOR));
    const semanticBlocks = semanticCandidates.filter(hasPrompt);
    const legacyCandidates = Array.from(doc.querySelectorAll(LEGACY_BLOCK_SELECTOR));
    const legacyBlocks = legacyCandidates.filter(hasPrompt);
    const distinctLegacyBlocks = legacyBlocks.filter((legacyBlock) => (
      !semanticBlocks.some((semanticBlock) => blocksOverlap(legacyBlock, semanticBlock))
    ));
    const selectedBlocks = sortInDocumentOrder([...semanticBlocks, ...distinctLegacyBlocks]);
    const uniqueCandidates = [...new Set([...semanticCandidates, ...legacyCandidates])];

    let strategy = "none";
    if (semanticBlocks.length > 0 && distinctLegacyBlocks.length > 0) strategy = "mixed";
    else if (semanticBlocks.length > 0) strategy = "semantic";
    else if (legacyBlocks.length > 0) strategy = "legacy";

    return {
      strategy,
      semanticCandidates,
      semanticBlocks,
      legacyCandidates,
      legacyBlocks,
      distinctLegacyBlocks,
      selectedBlocks,
      invalidCandidates: uniqueCandidates.filter((candidate) => !hasPrompt(candidate)).length
    };
  }

  function assessmentQuestionBlocks(doc) {
    return selectorState(doc).selectedBlocks;
  }

  function promptText(block) {
    const promptNode = block.querySelector(SEMANTIC_PROMPT_SELECTOR);
    return promptNode ? String(promptNode.innerText || promptNode.textContent || "").trim() : "";
  }

  function isCodeQuestion(block) {
    return block?.dataset?.testid === "part-Submission_CodeExpressionQuestion";
  }

  function extractOptionData(block) {
    const options = [];
    let type = "unknown";
    const optionNodes = Array.from(block.querySelectorAll(OPTION_SELECTOR));

    optionNodes.forEach((option) => {
      const textNode = option.querySelector('[data-testid="cml-viewer"]');
      const inputNode = option.querySelector('input[type="radio"], input[type="checkbox"]');
      if (!textNode || !inputNode) return;
      const text = String(textNode.innerText || textNode.textContent || "").trim();
      if (!text) return;
      options.push(text);
      if (type === "unknown") type = inputNode.type === "radio" ? "single_answer" : "multiple_answer";
    });

    return { options, type };
  }

  function detectWrittenType(block) {
    const slateEditor = block.querySelector('[data-slate-editor="true"]');
    const standardInput = block.querySelector(WRITTEN_INPUT_SELECTOR);
    if (slateEditor) return "essay";
    if (standardInput) return "text_input";
    return "unknown";
  }

  function extractQuestionShell(block, questionNumber) {
    const question = {
      questionNumber,
      type: "unknown",
      question: promptText(block),
      options: []
    };

    if (!question.question) return null;
    if (isCodeQuestion(block)) {
      question.type = "code_expression";
      return { question, kind: "code" };
    }

    const optionData = extractOptionData(block);
    if (optionData.options.length > 0) {
      question.options = optionData.options;
      question.type = optionData.type;
    } else {
      question.type = detectWrittenType(block);
    }

    return { question, kind: "standard" };
  }

  function selectorDiagnostics(doc) {
    const state = selectorState(doc);
    return {
      strategy: state.strategy,
      semanticCandidates: state.semanticCandidates.length,
      semanticPrompts: state.semanticBlocks.length,
      legacyCandidates: state.legacyCandidates.length,
      legacyPrompts: state.legacyBlocks.length,
      invalidCandidates: state.invalidCandidates,
      selectedBlocks: state.selectedBlocks.length
    };
  }

  return {
    selectors: {
      semanticBlock: SEMANTIC_BLOCK_SELECTOR,
      semanticPrompt: SEMANTIC_PROMPT_SELECTOR,
      legacyBlock: LEGACY_BLOCK_SELECTOR,
      option: OPTION_SELECTOR,
      writtenInput: WRITTEN_INPUT_SELECTOR
    },
    assessmentQuestionBlocks,
    promptText,
    isCodeQuestion,
    extractOptionData,
    detectWrittenType,
    extractQuestionShell,
    selectorDiagnostics
  };
});
