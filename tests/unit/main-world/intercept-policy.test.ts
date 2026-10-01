// Ported from tests/intercept-policy.test.js in v1.1.0 (c2f8b71).
import { describe, expect, it } from "vitest";
import {
  filterRequestHeaders,
  type MinimizedMaterials,
  minimizeCourseMaterials,
  minimizeResponse,
  normalizeCourseraApiUrl,
  observedRequestHeaderNames,
  shouldEmit,
} from "@/main-world/intercept-policy";

describe("intercept policy", () => {
  it("accepts only Coursera API URLs and forwards allowlisted query metadata", () => {
    expect(
      normalizeCourseraApiUrl(
        "/api/onDemandCourses.v1?q=slug&slug=test&email=private%40example.com&token=secret",
        "https://www.coursera.org/learn/test",
      ),
    ).toBe("https://www.coursera.org/api/onDemandCourses.v1?slug=test");
    expect(
      normalizeCourseraApiUrl("https://www.coursera.org/api/foo?userId=123&search=private"),
    ).toBe("https://www.coursera.org/api/foo?userId=123");
    expect(normalizeCourseraApiUrl("https://api.openai.com/v1/models")).toBe("");
    expect(normalizeCourseraApiUrl("https://www.coursera.org/learn/test")).toBe("");
  });

  it("forwards only the CSRF3 value while retaining safe observed header names", () => {
    const headers = [
      ["Authorization", "Bearer secret"],
      ["Cookie", "session=secret"],
      ["X-CSRF2-Token", "csrf2-secret"],
      ["X-CSRF3-Token", "csrf3-value"],
      ["X-Requested-With", "XMLHttpRequest"],
      ["Content-Type", "application/json"],
    ];

    expect(filterRequestHeaders(headers)).toEqual([["x-csrf3-token", "csrf3-value"]]);
    expect(observedRequestHeaderNames(headers)).toEqual([
      "x-csrf2-token",
      "x-csrf3-token",
      "x-requested-with",
    ]);
  });

  it("course-material responses retain only fields consumed by the read runtime", () => {
    const materials = {
      elements: [{ id: "course-1", moduleIds: ["module-1"], privateRootField: "hidden" }],
      linked: {
        "onDemandCourseMaterialModules.v1": [
          { id: "module-1", name: "Module", lessonIds: ["lesson-1"], privateModuleField: "hidden" },
        ],
        "onDemandCourseMaterialItems.v2": [
          {
            id: "item-1",
            moduleId: "module-1",
            lessonId: "lesson-1",
            name: "Item",
            slug: "item",
            contentSummary: { typeName: "quiz", privateSummary: "hidden" },
            privateItemField: "hidden",
          },
        ],
        "privateCollection.v1": [{ secret: "hidden" }],
      },
      privatePayload: "hidden",
    };

    expect(minimizeCourseMaterials(materials)).toEqual({
      elements: [{ id: "course-1", moduleIds: ["module-1"] }],
      linked: {
        "onDemandCourseMaterialModules.v1": [
          { id: "module-1", name: "Module", lessonIds: ["lesson-1"] },
        ],
        "onDemandCourseMaterialItems.v2": [
          {
            id: "item-1",
            moduleId: "module-1",
            lessonId: "lesson-1",
            name: "Item",
            slug: "item",
            contentSummary: { typeName: "quiz" },
          },
        ],
      },
    });

    const minimized = minimizeResponse(
      "https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=course",
      materials,
    ) as MinimizedMaterials;
    expect(JSON.stringify(minimized).includes("hidden")).toBe(false);
    expect(minimized.linked["onDemandCourseMaterialItems.v2"]?.[0]?.id).toBe("item-1");
  });

  it("minimizes dispatcher responses to the learner identifier only", () => {
    const response = {
      context: {
        dispatcher: {
          stores: {
            ApplicationStore: {
              userData: { id: 123, email: "hidden@example.com", name: "Hidden" },
            },
            OtherStore: { secret: "hidden" },
          },
        },
      },
      privatePayload: "hidden",
    };

    expect(minimizeResponse("https://www.coursera.org/api/someEndpoint.v1", response)).toEqual({
      context: {
        dispatcher: {
          stores: {
            ApplicationStore: {
              userData: { id: 123 },
            },
          },
        },
      },
    });
  });

  it("emits only API events useful to the extension", () => {
    expect(shouldEmit("https://www.coursera.org/api/foo", [], undefined)).toBe(false);
    expect(shouldEmit("https://www.coursera.org/api/foo?slug=course", [], undefined)).toBe(true);
    expect(shouldEmit("https://www.coursera.org/api/foo", ["x-requested-with"], undefined)).toBe(
      true,
    );
    expect(shouldEmit("https://example.com/api/foo?slug=course", ["x-csrf3-token"], {})).toBe(
      false,
    );
  });
});
