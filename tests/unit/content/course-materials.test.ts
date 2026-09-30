import { describe, expect, it, vi } from "vitest";
import { loadCourseMaterials } from "@/content/course-materials";
import { createCourseState } from "@/coursera/course-state";
import type { CourseMaterials } from "@/shared/types";

const COURSE_URL = "https://www.coursera.org/learn/sample-course/home/welcome";
const MATERIALS: CourseMaterials = {
  elements: [{ id: "course-1" }],
  linked: { "onDemandCourseMaterialItems.v2": [{ id: "item-1", name: "Intro" }] },
};

function fakeFetch(respond: () => Response | Promise<Response>) {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => respond());
}

// Ported from legacy/content-adapters.js:62-97 (loadCourseMaterials).
describe("loadCourseMaterials", () => {
  it("returns cached materials without a request", async () => {
    const state = createCourseState();
    state.setCourseMaterials(MATERIALS, "sample-course");
    const fetch = fakeFetch(() => Response.json(MATERIALS));

    const result = await loadCourseMaterials({ state, fetch, location: () => COURSE_URL });

    expect(result).toBe(MATERIALS);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("loads with credentials and caches the result for the course", async () => {
    const state = createCourseState();
    const fetch = fakeFetch(() => Response.json(MATERIALS));

    const result = await loadCourseMaterials({ state, fetch, location: () => COURSE_URL });

    expect(result).toEqual(MATERIALS);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("slug=sample-course"), {
      credentials: "include",
    });
    expect(state.getCourseMaterials("sample-course")).toEqual(MATERIALS);
  });

  it("maps an unauthorized response to the sign-in text", async () => {
    const state = createCourseState();
    const fetch = fakeFetch(() => new Response("", { status: 401 }));

    await expect(loadCourseMaterials({ state, fetch, location: () => COURSE_URL })).rejects.toThrow(
      "Coursera could not authorize the course request. Sign in, then try again.",
    );
  });

  it("rejects a payload without course items", async () => {
    const state = createCourseState();
    const fetch = fakeFetch(() => Response.json({ elements: [] }));

    await expect(loadCourseMaterials({ state, fetch, location: () => COURSE_URL })).rejects.toThrow(
      "Coursera returned course materials in an unsupported format.",
    );
  });

  it("rejects when the open course changes during the load", async () => {
    const state = createCourseState();
    let location = COURSE_URL;
    const fetch = fakeFetch(() => {
      location = "https://www.coursera.org/learn/other-course/home/welcome";
      return Response.json(MATERIALS);
    });

    await expect(loadCourseMaterials({ state, fetch, location: () => location })).rejects.toThrow(
      "The open Coursera course changed while its materials were loading. Try again.",
    );
    expect(state.getCourseMaterials("sample-course")).toBeNull();
  });

  it("requires a course page", async () => {
    const state = createCourseState();
    const fetch = fakeFetch(() => Response.json(MATERIALS));

    await expect(
      loadCourseMaterials({ state, fetch, location: () => "https://www.coursera.org/" }),
    ).rejects.toThrow("Open a Coursera course page first.");
    expect(fetch).not.toHaveBeenCalled();
  });
});
