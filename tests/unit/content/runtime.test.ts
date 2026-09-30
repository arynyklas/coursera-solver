import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createContentHandlers } from "@/content/runtime";
import { createCourseState } from "@/coursera/course-state";
import type { MessageSender } from "@/shared/messaging";

const COURSE_URL = "https://www.coursera.org/learn/sample-course/quiz/abc/attempt";
const sender = {} as MessageSender;

function setup(location: string) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json({ linked: { "onDemandCourseMaterialItems.v2": [] } }),
  );
  const handlers = createContentHandlers({
    doc: document,
    location: () => location,
    state: createCourseState(),
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
