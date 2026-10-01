import { describe, expect, it } from "vitest";
import {
  formatGradePercent,
  formatRequirementTime,
  formatWeightPercent,
  safeCourseRequirementUrl,
} from "@/popup/lib/format";

describe("requirement formatting", () => {
  it("formats durations like the legacy popup", () => {
    expect(formatRequirementTime(null)).toBe("");
    expect(formatRequirementTime(0)).toBe("");
    expect(formatRequirementTime(20)).toBe("1 min");
    expect(formatRequirementTime(600)).toBe("10 min");
    expect(formatRequirementTime(3600)).toBe("1 hr");
    expect(formatRequirementTime(5400)).toBe("1 hr 30 min");
  });

  it("prints whole weights without decimals and others with one", () => {
    expect(formatWeightPercent(25)).toBe("25");
    expect(formatWeightPercent(12.5)).toBe("12.5");
    expect(formatWeightPercent(null)).toBe("");
  });

  it("prints grades like Coursera: whole percentages bare, others with two decimals", () => {
    expect(formatGradePercent(0.8)).toBe("80");
    expect(formatGradePercent(1)).toBe("100");
    expect(formatGradePercent(0.83333)).toBe("83.33");
    expect(formatGradePercent(0.655)).toBe("65.50");
    expect(formatGradePercent(null)).toBe("");
  });

  it("only opens https www.coursera.org course links", () => {
    expect(safeCourseRequirementUrl("https://www.coursera.org/learn/ml/quiz/q1/x")).toBe(
      "https://www.coursera.org/learn/ml/quiz/q1/x",
    );
    for (const unsafe of [
      "http://www.coursera.org/learn/ml",
      "https://coursera.org.evil.com/learn/ml",
      "https://www.coursera.org/browse",
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(safeCourseRequirementUrl(unsafe)).toBe("");
    }
  });
});
