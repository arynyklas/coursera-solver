import { describe, expect, it } from "vitest";
import { courseSlugFromUrl, isCourseUrl, itemKindFromUrl } from "@/shared/urls";

describe("isCourseUrl", () => {
  it.each([
    "https://www.coursera.org/learn/ml",
    "http://coursera.org/learn/ml/quiz/abc/x",
    "https://sub.coursera.org/learn/ml?x=1",
  ])("accepts %s", (url) => {
    expect(isCourseUrl(url)).toBe(true);
  });

  it.each([
    "https://www.coursera.org/learn/",
    "https://www.coursera.org/browse",
    "https://evil.com/learn/ml",
    "https://coursera.org.evil.com/learn/ml",
    undefined,
    "",
  ])("rejects %j", (url) => {
    expect(isCourseUrl(url)).toBe(false);
  });
});

describe("courseSlugFromUrl", () => {
  // Ported from legacy/tests/coursera-state.test.js:19-33.
  it("extracts course slugs from API query strings and course paths", () => {
    expect(
      courseSlugFromUrl(
        "https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=machine-learning",
      ),
    ).toBe("machine-learning");
    expect(courseSlugFromUrl("https://www.coursera.org/learn/data%20science/home/week/1")).toBe(
      "data science",
    );
    expect(
      courseSlugFromUrl("https://www.coursera.org/learn/course-a/home?slug=background-course"),
    ).toBe("course-a");
    expect(courseSlugFromUrl("https://www.coursera.org/api/me.v1")).toBe("");
  });

  it("resolves relative URLs against Coursera", () => {
    expect(courseSlugFromUrl("/learn/ml/home/welcome")).toBe("ml");
    expect(courseSlugFromUrl("/api/onDemandCourseMaterials.v2/?slug=ml")).toBe("ml");
  });
});

describe("itemKindFromUrl", () => {
  const base = "https://www.coursera.org/learn/ml";

  it.each([
    [base, "course home"],
    [`${base}/home/week/1`, "course home"],
    [`${base}/quiz/a/b`, "quiz"],
    [`${base}/assignment-submission/a/b`, "assignment"],
    [`${base}/lecture/a/b`, "video"],
    [`${base}/supplement/a/b`, "reading"],
    [`${base}/ungraded-lab/a`, "ungraded lab"],
    ["https://www.coursera.org/browse", ""],
  ])("maps %s to %j", (url, kind) => {
    expect(itemKindFromUrl(url)).toBe(kind);
  });
});
