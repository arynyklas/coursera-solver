const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createReadMessageListener, serializeError } = require("../read-message-router.js");

function invoke(listener, request) {
  return new Promise((resolve, reject) => {
    const keepAlive = listener(request, {}, resolve);
    if (!keepAlive) reject(new Error("Listener did not claim the read-only action."));
  });
}

test("routes assessment reads and preserves issues", async () => {
  const runtime = {
    async scrapeAssessmentDetailed() {
      return { questions: [{ questionNumber: 1, type: "text_input" }], issues: [{ questionNumber: 2, error: "fixture" }] };
    },
    async getCourseRequirements() { return { requirements: [] }; },
    getParserDiagnostics() { return { selectors: { strategy: "semantic" } }; }
  };
  const listener = createReadMessageListener(runtime);
  assert.deepEqual(await invoke(listener, { action: "getSelection" }), {
    data: [{ questionNumber: 1, type: "text_input" }],
    issues: [{ questionNumber: 2, error: "fixture" }]
  });
});

test("routes both course requirement action names to the same read runtime", async () => {
  let calls = 0;
  const runtime = {
    async scrapeAssessmentDetailed() { return { questions: [], issues: [] }; },
    async getCourseRequirements() { calls += 1; return { requirements: [{ id: "fixture" }] }; },
    getParserDiagnostics() { return {}; }
  };
  const listener = createReadMessageListener(runtime);
  assert.deepEqual((await invoke(listener, { action: "getCourseRequirements" })).data.requirements, [{ id: "fixture" }]);
  assert.deepEqual((await invoke(listener, { action: "getGradedAssignments" })).data.requirements, [{ id: "fixture" }]);
  assert.equal(calls, 2);
});

test("routes parser diagnostics and ignores unrelated actions", async () => {
  const runtime = {
    async scrapeAssessmentDetailed() { return { questions: [], issues: [] }; },
    async getCourseRequirements() { return {}; },
    getParserDiagnostics() { return { state: { courseSlug: "fixture-course" } }; }
  };
  const listener = createReadMessageListener(runtime);
  assert.deepEqual(await invoke(listener, { action: "getParserDiagnostics" }), {
    data: { state: { courseSlug: "fixture-course" } }
  });
  assert.equal(listener({ action: "applyAIResponse" }, {}, () => {}), false);
  assert.equal(listener({ action: "solveQuizDirectly" }, {}, () => {}), false);
});

test("serializes only the error message and uses a stable fallback", async () => {
  assert.deepEqual(serializeError(new Error("safe message"), "fallback"), { error: "safe message" });
  assert.deepEqual(serializeError({}, "fallback"), { error: "fallback" });

  const runtime = {
    async scrapeAssessmentDetailed() { throw new Error("read failed"); },
    async getCourseRequirements() { return {}; },
    getParserDiagnostics() { return {}; }
  };
  const response = await invoke(createReadMessageListener(runtime), { action: "getSelection" });
  assert.deepEqual(response, { error: "read failed" });
  assert.equal("stack" in response, false);
});

test("router source contains no mutation action handlers", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "read-message-router.js"), "utf8");
  assert.doesNotMatch(source, /applyAIResponse|solveQuizDirectly|completeVideos|fillDialogueAnswer/);
  assert.doesNotMatch(source, /\.click\(\)|execCommand|dispatchEvent|replace-model/);
});
