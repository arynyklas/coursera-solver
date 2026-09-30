import { describe, expect, it } from "vitest";
import {
  buildCompletionMaterialsUrl,
  buildCourseMaterialsUrl,
  buildLectureCompletionUrl,
  courseMaterialsError,
  courseSlugFromPath,
  hasSupportedCourseMaterials,
  MATERIAL_FIELDS,
  supplementCompletionBody,
} from "@/coursera/api";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Ported from legacy/tests/coursera-api.test.js.
describe("coursera api", () => {
  it("extracts and decodes a course slug from Coursera paths", () => {
    expect(courseSlugFromPath("/learn/sample-course/home/week/1")).toBe("sample-course");
    expect(courseSlugFromPath("/learn/data%20course/quiz/1")).toBe("data course");
    expect(courseSlugFromPath("/professional-certificates/sample")).toBe("");
  });

  it("builds the course materials endpoint with required fields", () => {
    const url = new URL(buildCourseMaterialsUrl("sample-course"));
    expect(url.origin).toBe("https://www.coursera.org");
    expect(url.pathname).toBe("/api/onDemandCourseMaterials.v2/");
    expect(url.searchParams.get("q")).toBe("slug");
    expect(url.searchParams.get("slug")).toBe("sample-course");
    expect(url.searchParams.get("showLockedItems")).toBe("true");
    const fields = url.searchParams.get("fields") ?? "";
    for (const field of MATERIAL_FIELDS) {
      expect(fields).toMatch(new RegExp(escapeRegExp(field)));
    }
    for (const requiredItemField of ["moduleId", "lessonId", "itemClass", "contentSummary"]) {
      expect(fields).toMatch(
        new RegExp(`onDemandCourseMaterialItems\\.v2\\([^)]*${requiredItemField}`),
      );
    }
  });

  it("rejects empty course slugs", () => {
    expect(() => buildCourseMaterialsUrl("")).toThrow(/course slug is required/i);
  });

  it("validates the expected linked item collection", () => {
    expect(hasSupportedCourseMaterials({ linked: { "onDemandCourseMaterialItems.v2": [] } })).toBe(
      true,
    );
    expect(hasSupportedCourseMaterials({ linked: {} })).toBe(false);
    expect(hasSupportedCourseMaterials(null)).toBe(false);
  });

  it("returns useful authorization and HTTP errors", () => {
    expect(courseMaterialsError(401)).toMatch(/authorize/i);
    expect(courseMaterialsError(403)).toMatch(/authorize/i);
    expect(courseMaterialsError(500)).toMatch(/HTTP 500/);
  });
});

describe("completion request builders", () => {
  it("builds the lecture completion URL", () => {
    expect(buildLectureCompletionUrl("~", "ml", "abc")).toBe(
      "https://www.coursera.org/api/opencourse.v1/user/~/course/ml/item/abc/lecture/videoEvents/ended?autoEnroll=false",
    );
  });

  it("sends a numeric user id in the supplement completion body", () => {
    expect(JSON.parse(supplementCompletionBody("42", "cid", "i1"))).toEqual({
      userId: 42,
      courseId: "cid",
      itemId: "i1",
    });
  });

  it("keeps a non-numeric user id as text in the supplement completion body", () => {
    expect(JSON.parse(supplementCompletionBody("~", "cid", "i1")).userId).toBe("~");
  });

  it("encodes the slug in the completion materials URL", () => {
    const url = buildCompletionMaterialsUrl("data science");
    expect(url).toContain("slug=data%20science");
    expect(url).toContain("includes=modules,lessons,items");
  });
});
