import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURES_DIR = "tests/fixtures";
const readFixture = (filename: string) => readFileSync(join(FIXTURES_DIR, filename), "utf8");

const PROVIDER_HOSTS =
  /generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|api\.x\.ai|api\.deepseek\.com|api\.groq\.com|openrouter\.ai/i;
const HTML_FIXTURES = [
  "assessment-basic.html",
  "assessment-legacy.html",
  "assessment-mixed.html",
  "assessment-malformed.html",
];

describe("sanitized fixtures", () => {
  it.each(readdirSync(FIXTURES_DIR))("%s contains no credential-like material", (filename) => {
    const source = readFixture(filename);
    expect(source).not.toMatch(
      /Authorization\s*:|Bearer\s+[A-Za-z0-9._-]+|Cookie\s*:|x-csrf\w*\s*[:=]/i,
    );
    expect(source).not.toMatch(PROVIDER_HOSTS);
  });

  it.each(HTML_FIXTURES)("%s contains no account data", (filename) => {
    expect(readFixture(filename)).not.toMatch(
      /coursera\.org\/api|Authorization|Cookie|Bearer |x-csrf|userId/i,
    );
  });

  it("basic fixture keeps every modern question type and the Monaco model", () => {
    const basic = readFixture("assessment-basic.html");
    expect(basic).toMatch(/part-Submission_MultipleChoiceQuestion/);
    expect(basic).toMatch(/part-Submission_MultipleResponseQuestion/);
    expect(basic).toMatch(/part-Submission_TextQuestion/);
    expect(basic).toMatch(/part-Submission_CodeExpressionQuestion/);
    expect(basic).toMatch(/data-uri="inmemory:\/\/model\/example"/);
  });

  it("legacy fixture keeps only the legacy class-based layout", () => {
    const legacy = readFixture("assessment-legacy.html");
    expect(legacy).toMatch(/css-1erl2aq/);
    expect(legacy).toMatch(/css-12u8wr5/);
    expect(legacy).not.toMatch(/part-Submission_/);
  });

  it("mixed fixture keeps both layouts", () => {
    const mixed = readFixture("assessment-mixed.html");
    expect(mixed).toMatch(/part-Submission_MultipleChoiceQuestion/);
    expect(mixed).toMatch(/css-1erl2aq/);
    expect(mixed).toMatch(/css-12u8wr5/);
  });

  it("malformed fixture keeps its broken blocks", () => {
    const malformed = readFixture("assessment-malformed.html");
    expect(malformed).toMatch(/Missing prompt on purpose/);
    expect(malformed).toMatch(/Broken option without input/);
  });
});
