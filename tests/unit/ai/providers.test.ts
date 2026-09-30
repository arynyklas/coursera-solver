import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@/ai/providers";

describe("PROVIDERS", () => {
  // Ported from tests/ai-providers.test.js:15-25 in v1.1.0 (c2f8b71).
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
