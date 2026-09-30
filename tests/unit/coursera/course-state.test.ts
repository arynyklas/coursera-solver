import { describe, expect, it } from "vitest";
import { createCourseState, normalizeHeaderNames } from "@/coursera/course-state";
import type { CourseMaterials } from "@/shared/types";

function materials(id: string): CourseMaterials {
  return {
    linked: {
      "onDemandCourseMaterialItems.v2": [{ id }],
    },
  };
}

function firstItemId(value: CourseMaterials | null): unknown {
  return (value?.linked?.["onDemandCourseMaterialItems.v2"]?.[0] as { id?: string })?.id;
}

// Ported from legacy/tests/coursera-state.test.js:35-226.
describe("course state", () => {
  it("records only allowlisted observed header names, never values", () => {
    expect(
      normalizeHeaderNames([
        ["Authorization", "Bearer secret"],
        ["Cookie", "private"],
        ["X-CSRF3-Token", "token-value"],
        ["X-Requested-With", "XMLHttpRequest"],
      ]).sort(),
    ).toEqual(["x-csrf3-token", "x-requested-with"]);
    expect(
      normalizeHeaderNames(["X-CSRF2-Token", "Authorization", "X-Requested-With"]).sort(),
    ).toEqual(["x-csrf2-token", "x-requested-with"]);
  });

  it("scopes cached materials to the active course", () => {
    const state = createCourseState();
    state.setCourseMaterials(materials("item-a"), "course-a");

    expect(firstItemId(state.getCourseMaterials("course-a"))).toBe("item-a");
    expect(state.getCourseMaterials("course-b")).toBeNull();

    state.setCourseSlug("course-b");
    expect(state.getCourseMaterials("course-a")).toBeNull();
    expect(state.snapshot().hasCourseMaterials).toBe(false);
    expect(state.snapshot().courseRevision).toBe(2);
  });

  it("SPA location sync invalidates stale course cache and clears state off course routes", () => {
    const state = createCourseState();
    state.syncLocation("https://www.coursera.org/learn/course-a/home/week/1");
    state.setCourseMaterials(materials("item-a"), "course-a");
    const firstRevision = state.snapshot().courseRevision;

    state.syncLocation("https://www.coursera.org/learn/course-a/quiz/example");
    expect(state.snapshot().courseRevision).toBe(firstRevision);
    expect(state.snapshot().hasCourseMaterials).toBe(true);

    state.syncLocation("https://www.coursera.org/learn/course-b/home/week/1");
    expect(state.snapshot().courseSlug).toBe("course-b");
    expect(state.snapshot().hasCourseMaterials).toBe(false);
    expect(state.snapshot().courseRevision).toBe(firstRevision + 1);

    state.syncLocation("https://www.coursera.org/account-settings");
    expect(state.snapshot()).toEqual({
      courseSlug: "",
      onCourseRoute: false,
      courseRevision: firstRevision + 2,
      hasCourseMaterials: false,
      observedHeaderNames: [],
      hasUserContext: false,
    });
  });

  it("ingests sanitized captures without exposing account or header values", () => {
    const state = createCourseState();
    state.ingestCapture({
      url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=course-a",
      method: "GET",
      headerNames: ["x-csrf3-token", "authorization"],
      csrf3Token: "super-secret-token",
      userId: "123456",
      materials: materials("item-1"),
    });
    const snapshot = state.snapshot();
    const serialized = JSON.stringify(snapshot);

    expect(snapshot).toEqual({
      courseSlug: "course-a",
      onCourseRoute: true,
      courseRevision: 1,
      hasCourseMaterials: true,
      observedHeaderNames: ["x-csrf3-token"],
      hasUserContext: true,
    });
    expect(serialized.includes("super-secret-token")).toBe(false);
    expect(serialized.includes("123456")).toBe(false);
  });

  it("course changes reset observed request and user-context metadata", () => {
    const state = createCourseState();
    state.ingestCapture(
      {
        url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?slug=course-a",
        method: "GET",
        headerNames: ["x-csrf3-token"],
        userId: "123456",
        materials: materials("item-a"),
      },
      "https://www.coursera.org/learn/course-a/home",
    );

    expect(state.snapshot().observedHeaderNames).toEqual(["x-csrf3-token"]);
    expect(state.snapshot().hasUserContext).toBe(true);

    state.syncLocation("https://www.coursera.org/learn/course-b/home");
    expect(state.snapshot().observedHeaderNames).toEqual([]);
    expect(state.snapshot().hasUserContext).toBe(false);
  });

  it("active page route wins over intercepted background-course traffic", () => {
    const state = createCourseState();
    state.syncLocation("https://www.coursera.org/learn/course-a/home");
    state.setCourseMaterials(materials("item-a"), "course-a");
    const revision = state.snapshot().courseRevision;

    state.ingestCapture(
      {
        url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?slug=course-b",
        method: "GET",
        headerNames: ["x-requested-with"],
        userId: "123456",
        materials: materials("item-b"),
      },
      "https://www.coursera.org/learn/course-a/quiz/checkpoint",
    );

    expect(state.snapshot().courseSlug).toBe("course-a");
    expect(state.snapshot().courseRevision).toBe(revision);
    expect(state.snapshot().observedHeaderNames).toEqual([]);
    expect(state.snapshot().hasUserContext).toBe(false);
    expect(firstItemId(state.getCourseMaterials("course-a"))).toBe("item-a");
    expect(state.getCourseMaterials("course-b")).toBeNull();
  });

  it("active off-course location prevents intercepted traffic from recreating course state or metadata", () => {
    const state = createCourseState();
    state.syncLocation("https://www.coursera.org/learn/course-a/home");

    state.ingestCapture(
      {
        url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?slug=course-b",
        method: "GET",
        headerNames: ["x-csrf3-token"],
        userId: "123456",
        materials: materials("item-b"),
      },
      "https://www.coursera.org/account-settings",
    );

    expect(state.snapshot().courseSlug).toBe("");
    expect(state.snapshot().onCourseRoute).toBe(false);
    expect(state.snapshot().hasCourseMaterials).toBe(false);
    expect(state.snapshot().observedHeaderNames).toEqual([]);
    expect(state.snapshot().hasUserContext).toBe(false);
  });
});

describe("course state snapshot ingestion", () => {
  const courseA = "https://www.coursera.org/learn/course-a/home";

  it("caches snapshot materials captured for the active course", () => {
    const state = createCourseState();
    state.ingestSnapshot(
      {
        headerNames: ["x-csrf3-token", "cookie"],
        userId: "123456",
        materials: {
          url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=course-a",
          data: materials("item-a"),
        },
      },
      courseA,
    );

    expect(firstItemId(state.getCourseMaterials("course-a"))).toBe("item-a");
    expect(state.snapshot()).toEqual({
      courseSlug: "course-a",
      onCourseRoute: true,
      courseRevision: 1,
      hasCourseMaterials: true,
      observedHeaderNames: ["x-csrf3-token"],
      hasUserContext: true,
    });
  });

  it("ignores snapshot materials captured for another course", () => {
    const state = createCourseState();
    state.ingestSnapshot(
      {
        headerNames: [],
        materials: {
          url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=course-b",
          data: materials("item-b"),
        },
      },
      courseA,
    );

    expect(state.snapshot().courseSlug).toBe("course-a");
    expect(state.snapshot().hasCourseMaterials).toBe(false);
    expect(state.getCourseMaterials("course-b")).toBeNull();
  });

  it("clears course state when the active location is off course", () => {
    const state = createCourseState();
    state.setCourseMaterials(materials("item-a"), "course-a");

    state.ingestSnapshot(
      {
        headerNames: ["x-csrf3-token"],
        userId: "123456",
        materials: {
          url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=course-a",
          data: materials("item-a"),
        },
      },
      "https://www.coursera.org/account-settings",
    );

    expect(state.snapshot()).toEqual({
      courseSlug: "",
      onCourseRoute: false,
      courseRevision: 2,
      hasCourseMaterials: false,
      observedHeaderNames: [],
      hasUserContext: false,
    });
    expect(state.getCourseMaterials("course-a")).toBeNull();
  });
});
