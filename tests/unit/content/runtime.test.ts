import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContentHandlers } from "@/content/runtime";
import { createCourseState } from "@/coursera/course-state";
import type { MessageSender } from "@/shared/messaging";

const COURSE_URL = "https://www.coursera.org/learn/sample-course/quiz/abc/attempt";
const sender = {} as MessageSender;

const PROGRESS_URL =
  "https://www.coursera.org/api/onDemandCoursesProgress.v1/42~internal-course?fields=items";

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
  it("marks each requirement with the learner's progress in the route course", async () => {
    const { handlers, fetch } = setup(COURSE_URL, {
      userId: "42",
      route: (url) =>
        url === PROGRESS_URL
          ? Response.json({ elements: [{ items: { "quiz-1": { progressState: "Completed" } } }] })
          : Response.json(courseMaterials()),
    });

    const result = await handlers.getCourseRequirements({}, sender);

    expect(fetch).toHaveBeenLastCalledWith(PROGRESS_URL, { credentials: "include" });
    expect(result.requirements.map(({ id, status }) => [id, status])).toEqual([
      ["quiz-1", "completed"],
      ["exam-1", "notStarted"],
    ]);
    expect(result.summary.completedCount).toBe(1);
  });

  it("returns the requirements without a status when the learner is not known", async () => {
    const { handlers, fetch } = setup(COURSE_URL, {
      route: () => Response.json(courseMaterials()),
    });

    const result = await handlers.getCourseRequirements({}, sender);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.requirements.map(({ status }) => status)).toEqual([null, null]);
    expect(result.summary.completedCount).toBeNull();
  });

  it.each([
    ["refuses the progress request", () => Response.json({}, { status: 403 })],
    ["returns no progress record", () => Response.json({ elements: [] })],
    [
      "cannot be reached",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("returns the requirements without a status when Coursera %s", async (_case, progress) => {
    const { handlers } = setup(COURSE_URL, {
      userId: "42",
      route: (url) => (url === PROGRESS_URL ? progress() : Response.json(courseMaterials())),
    });

    const result = await handlers.getCourseRequirements({}, sender);

    expect(result.requirements.map(({ status }) => status)).toEqual([null, null]);
    expect(result.summary.completedCount).toBeNull();
  });
});
