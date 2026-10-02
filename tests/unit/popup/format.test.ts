import { describe, expect, it } from "vitest";
import {
  formatGradePercent,
  formatRequirementTime,
  formatWeightPercent,
  safeCourseRequirementUrl,
} from "@/popup/lib/format";

describe("requirement formatting", () => {
  // Guards the unit: Coursera's timeCommitment is in milliseconds; read as seconds, a 30-minute
  // quiz showed as "500 hr".
  it("formats Coursera's millisecond estimates in minutes and hours", () => {
    expect(formatRequirementTime(null)).toBe("");
    expect(formatRequirementTime(0)).toBe("");
    expect(formatRequirementTime(20_000)).toBe("1 min");
    expect(formatRequirementTime(1_800_000)).toBe("30 min");
    expect(formatRequirementTime(7_200_000)).toBe("2 hr");
    expect(formatRequirementTime(5_400_000)).toBe("1 hr 30 min");
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
