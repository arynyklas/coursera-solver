import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContentHandlers } from "@/content/runtime";
import { createCourseState } from "@/coursera/course-state";
import type { MessageSender } from "@/shared/messaging";

const COURSE_URL = "https://www.coursera.org/learn/sample-course/quiz/abc/attempt";
const sender = {} as MessageSender;

const PROGRESS_URL =
  "https://www.coursera.org/api/onDemandCoursesProgress.v1/42~internal-course?fields=items";
const GRADES_URL =
  "https://www.coursera.org/api/onDemandCourseViewGrades.v1/42~internal-course?includes=items,itemOutcomeOverrides&fields=onDemandCourseViewItemGrades.v1(overallOutcome),onDemandCourseGradeItemOutcomeOverrides.v1(grade,isPassed)";

/** The learner's progress and grades as Coursera returns them for the fixture course. */
function learnerRoute(overrides: { progress?: () => Response; grades?: () => Response } = {}) {
  return (url: string) => {
    if (url === PROGRESS_URL) {
      return overrides.progress
        ? overrides.progress()
        : Response.json({
            elements: [
              {
                items: {
                  "quiz-1": { progressState: "Completed" },
                  "exam-1": {
                    progressState: "Started",
                    content: { definition: { submitted: false } },
                  },
                },
              },
            ],
          });
    }
    if (url === GRADES_URL) {
      return overrides.grades
        ? overrides.grades()
        : Response.json({
            elements: [{ id: "42~internal-course" }],
            linked: {
              "onDemandCourseViewItemGrades.v1": [
                { itemId: "quiz-1", overallOutcome: { grade: 0.8, isPassed: true } },
                // Without `itemId`, the item id is the last part of the record id.
                {
                  id: "42~internal-course~exam-1",
                  overallOutcome: { grade: 0.5, isPassed: false },
                },
              ],
              "onDemandCourseGradeItemOutcomeOverrides.v1": [],
            },
          });
    }
    return Response.json(courseMaterials());
  };
}

/** The sanitized materials fixture, with the internal course id Coursera returns for the course. */
function courseMaterials() {
  const materials = JSON.parse(
    readFileSync("tests/fixtures/course-materials-confirmed.json", "utf8"),
  );
  materials.elements[0].id = "internal-course";
  return materials;
}

function setup(
  location: string,
  options: { userId?: string; route?: (url: string) => Response } = {},
) {
  const route =
    options.route ?? (() => Response.json({ linked: { "onDemandCourseMaterialItems.v2": [] } }));
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    route(String(input)),
  );
  const handlers = createContentHandlers({
    doc: document,
    location: () => location,
    state: createCourseState(),
    session: { get: () => ({ userId: options.userId }) },
    monaco: { read: async () => "", replace: async () => {} },
    solve: { start: () => ({ done: Promise.resolve() }) },
    completion: { start: () => ({ done: Promise.resolve(null) }) },
    fetch,
    draftReply: async () => "reply",
  });
  return { handlers, fetch };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("content handlers", () => {
  it("reports selector diagnostics and the course route", async () => {
    document.body.innerHTML = readFileSync("tests/fixtures/assessment-basic.html", "utf8");
    const { handlers } = setup(COURSE_URL);

    const diagnostics = await handlers.getDiagnostics({}, sender);

    expect(diagnostics.selectors.strategy).toBe("semantic");
    expect(diagnostics.state).toMatchObject({ courseSlug: "sample-course", onCourseRoute: true });
  });

  it("rejects course requirements off a course page", async () => {
    const { handlers, fetch } = setup("https://www.coursera.org/");

    await expect(handlers.getCourseRequirements({}, sender)).rejects.toThrow(
      "Open a Coursera course page first.",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("course requirements handler", () => {
  it("marks each requirement with the learner's progress and grade in the route course", async () => {
    const { handlers, fetch } = setup(COURSE_URL, { userId: "42", route: learnerRoute() });

    const result = await handlers.getCourseRequirements({}, sender);

    expect(fetch).toHaveBeenCalledWith(PROGRESS_URL, { credentials: "include" });
    expect(fetch).toHaveBeenCalledWith(GRADES_URL, { credentials: "include" });
    expect(result.requirements.map(({ id, status, grade }) => [id, status, grade])).toEqual([
      ["quiz-1", "passed", 0.8],
      ["exam-1", "failed", 0.5],
    ]);
    expect(result.summary.completedCount).toBe(1);
  });

  it("returns the requirements without a status when the learner is not known", async () => {
    const { handlers, fetch } = setup(COURSE_URL, { route: learnerRoute() });

    const result = await handlers.getCourseRequirements({}, sender);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.requirements.map(({ status }) => status)).toEqual([null, null]);
    expect(result.summary.completedCount).toBeNull();
  });

  it.each([
    ["refuses the progress request", { progress: () => Response.json({}, { status: 403 }) }],
    ["returns no progress record", { progress: () => Response.json({ elements: [] }) }],
    ["refuses the grades request", { grades: () => Response.json({}, { status: 403 }) }],
    ["returns no grades record", { grades: () => Response.json({ elements: [] }) }],
    [
      "cannot be reached",
      {
        grades: () => {
          throw new TypeError("Failed to fetch");
        },
      },
    ],
  ])("returns the requirements without a status when Coursera %s", async (_case, overrides) => {
    const { handlers } = setup(COURSE_URL, { userId: "42", route: learnerRoute(overrides) });

    const result = await handlers.getCourseRequirements({}, sender);

    expect(result.requirements.map(({ status, grade }) => [status, grade])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(result.summary.completedCount).toBeNull();
  });
});
