const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

test("normal workflows stay read-only and pin first-party actions to immutable commits", () => {
  const workflowsDir = path.join(root, ".github", "workflows");
  const workflowFiles = fs.readdirSync(workflowsDir).filter((name) => /\.ya?ml$/i.test(name));
  assert.ok(workflowFiles.length > 0);

  for (const filename of workflowFiles) {
    assert.doesNotMatch(filename, /temporary|one-shot|cleanup-refactor/i);
    const source = fs.readFileSync(path.join(workflowsDir, filename), "utf8");
    assert.doesNotMatch(source, /contents\s*:\s*write/i, `${filename} must not grant contents: write`);

    const actionUses = [...source.matchAll(/^\s*uses:\s*([^#\s]+)(?:\s*#.*)?$/gm)]
      .map((match) => match[1]);
    for (const action of actionUses) {
      if (!action.startsWith("actions/")) continue;
      assert.match(
        action,
        /^actions\/[^@\s]+@[a-f0-9]{40}$/i,
        `${filename} must pin ${action} to a full commit SHA`
      );
    }
  }
});

test("manifest keeps only currently required extension permissions", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual([...manifest.permissions].sort(), ["storage"]);
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);

  const isolatedWorld = manifest.content_scripts.find((entry) => !entry.world);
  const mainWorld = manifest.content_scripts.find((entry) => entry.world === "MAIN");
  assert.deepEqual(isolatedWorld.matches, ["*://*.coursera.org/learn/*"]);
  assert.deepEqual(mainWorld.matches, ["*://*.coursera.org/learn/*"]);
  assert.equal(mainWorld.run_at, "document_start");
});

test("sanitized fixtures do not contain credential-like material", () => {
  const fixturesDir = path.join(root, "tests", "fixtures");
  for (const filename of fs.readdirSync(fixturesDir)) {
    const source = fs.readFileSync(path.join(fixturesDir, filename), "utf8");
    assert.doesNotMatch(source, /Authorization\s*:|Bearer\s+[A-Za-z0-9._-]+|Cookie\s*:|x-csrf\w*\s*[:=]/i, filename);
    assert.doesNotMatch(source, /api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com/i, filename);
  }
});
