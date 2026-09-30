const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const contentSource = fs.readFileSync(path.join(root, "content.js"), "utf8");

test("content delegates banner presentation to the extracted runtime", () => {
  assert.match(contentSource, /function presentationRuntime\(\)/);
  assert.match(contentSource, /globalThis\.CourseraPresentation/);
  assert.match(contentSource, /presentationRuntime\(\)\.show\(text, type\);/);
  assert.match(contentSource, /presentationRuntime\(\)\.hide\(\);/);
});

test("legacy banner DOM implementation stays out of content.js", () => {
  assert.doesNotMatch(contentSource, /document\.getElementById\("auto-coursera-banner"\)/);
  assert.doesNotMatch(contentSource, /banner\.innerHTML/);
  assert.doesNotMatch(contentSource, /banner\.style\.position\s*=\s*"fixed"/);
  assert.doesNotMatch(contentSource, /auto-coursera-styles/);
  assert.doesNotMatch(contentSource, /@keyframes spin/);
});
