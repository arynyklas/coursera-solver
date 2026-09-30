import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOWS_DIR = ".github/workflows";
const workflows = readdirSync(WORKFLOWS_DIR).map((filename) => ({
  filename,
  source: readFileSync(join(WORKFLOWS_DIR, filename), "utf8"),
}));

describe("GitHub workflows", () => {
  it("exist", () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it.each(workflows)("$filename is not a temporary workflow", ({ filename }) => {
    expect(filename).not.toMatch(/temporary|one-shot|cleanup-refactor/i);
  });

  it.each(workflows)("$filename never grants contents: write", ({ source }) => {
    expect(source).not.toMatch(/contents\s*:\s*write/i);
  });

  it.each(workflows)("$filename pins every action to a full commit SHA", ({ source }) => {
    const uses = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    for (const action of uses) {
      expect(action).toMatch(/^[^/@\s]+\/[^@\s]+@[0-9a-f]{40}$/);
    }
  });
});
