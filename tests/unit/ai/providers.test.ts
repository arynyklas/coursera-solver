import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/ai/providers";

describe("PROVIDERS", () => {
  // Ported from legacy/tests/ai-providers.test.js:15-25.
  it("registers the seven supported providers", () => {
    expect(Object.keys(PROVIDERS)).toEqual([
      "gemini",
      "openai",
      "anthropic",
      "xai",
      "deepseek",
      "groq",
      "openrouter",
    ]);
  });
});
