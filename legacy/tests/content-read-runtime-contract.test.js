const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");
const adapterSource = fs.readFileSync(path.join(root, "content-adapters.js"), "utf8");


test("content keeps only read delegates still required by legacy mutation integration", () => {
  assert.match(contentSource, /function readRuntime\(\)/);
  assert.match(contentSource, /globalThis\.CourseraReadRuntime/);
  assert.match(contentSource, /return readRuntime\(\)\.assessmentQuestionBlocks\(\);/);
  assert.match(contentSource, /return readRuntime\(\)\.codeEditorDescriptor\(block\);/);
  assert.match(contentSource, /return readRuntime\(\)\.scrapeAssessmentDetailed\(\);/);

  assert.doesNotMatch(contentSource, /function getCurrentCourseSlug\(\)/);
  assert.doesNotMatch(contentSource, /async function loadCourseMaterials\(\)/);
  assert.doesNotMatch(contentSource, /function normalizeCourseRequirements\(materials, courseSlug\)/);
  assert.doesNotMatch(contentSource, /async function getCourseRequirements\(\)/);
});

test("read-only Chrome actions are no longer handled inside content.js", () => {
  assert.doesNotMatch(contentSource, /request\.action === "getSelection"/);
  assert.doesNotMatch(contentSource, /request\.action === "getCourseRequirements"/);
  assert.doesNotMatch(contentSource, /request\.action === "getGradedAssignments"/);
});

test("duplicated read-only implementations do not return to content.js", () => {
  const removedMarkers = [
    "function linkedCourseCollection(",
    "function requirementRoute(",
    "function courseItemType(",
    "function courseItemIsLocked(",
    "function itemIdFromPassable(",
    "showLockedItems",
    "const semanticBlocks = Array.from(document.querySelectorAll"
  ];

  for (const marker of removedMarkers) {
    assert.ok(!contentSource.includes(marker), `content.js must not restore legacy marker: ${marker}`);
  }
});

test("adapter owns course reads, diagnostics, and read-only message registration", () => {
  assert.match(adapterSource, /globalThis\.CourseraReadRuntime = readRuntime;/);
  assert.match(adapterSource, /async function getCourseRequirements\(\)/);
  assert.match(adapterSource, /function getParserDiagnostics\(\)/);
  assert.match(adapterSource, /getCourseRequirements,/);
  assert.match(adapterSource, /getParserDiagnostics/);
  assert.match(adapterSource, /readMessageRouter\.createReadMessageListener\(readRuntime\)/);

  const legacyAssignments = /(?:^|\n)\s*(?:normalizeCourseRequirements|getCurrentCourseSlug|codeEditorDescriptor|assessmentQuestionBlocks|loadCourseMaterials|scrapeAssessmentDetailed)\s*=/m;
  assert.doesNotMatch(adapterSource, legacyAssignments);
});

test("legacy message listener releases actions it does not own", () => {
  assert.match(contentSource, /if \(request\.action === "completeVideos"\)[\s\S]*?startCompletionLoop\(\);\s*return true;\s*}\s*return false;\s*}\);/);
  assert.match(contentSource, /request\.action === "fillDialogueAnswer"/);
  assert.match(contentSource, /request\.action === "solveQuizDirectly"/);
  assert.match(contentSource, /request\.action === "applyAIResponse"/);
});

test("window bridges require same-origin messages and exact postMessage targets", () => {
  const originGuardMatches = contentSource.match(/event\.origin !== window\.location\.origin/g) || [];
  assert.ok(originGuardMatches.length >= 2, "interceptor and Monaco response listeners must verify origin");
  assert.match(contentSource, /source: "auto-coursera-monaco-request"[\s\S]*?}, window\.location\.origin\);/);
  assert.doesNotMatch(contentSource, /}, "\*"\);/);
});

test("existing mutation integration remains outside the read-only cleanup", () => {
  assert.match(contentSource, /function requestMonacoBridge\(action, payload = \{\}\)/);
  assert.match(contentSource, /request\.action === "applyAIResponse"/);
  assert.match(contentSource, /request\.action === "solveQuizDirectly"/);
  assert.match(contentSource, /requestMonacoBridge\("replace-model"/);
});
