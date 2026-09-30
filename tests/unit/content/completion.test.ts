import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { BannerContent } from "@/content/banner/store";
import { COMPLETION_BUSY_MESSAGE, createCompletionRunner } from "@/content/completion";
import { createSessionCredentials } from "@/coursera/session";
import type { Capture } from "@/shared/bridge";

const COURSE_A_URL = "https://www.coursera.org/learn/course-a/home/welcome";

interface MaterialItem {
  id: string;
  name?: string;
  itemClass?: string;
  isLocked?: boolean;
}

function materials(items: MaterialItem[]) {
  return {
    elements: [{ id: "internal-a" }],
    linked: { "onDemandCourseMaterialItems.v2": items.map((item) => ({ name: "", ...item })) },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

type Route = (url: string) => Response | Promise<Response>;

function setup(options: { route: Route; token?: string | null; location?: string }) {
  const session = createSessionCredentials();
  if (options.token !== null) {
    // The captured request names course-b; it must never choose the completion course (F1).
    const capture: Capture = {
      url: "https://www.coursera.org/api/onDemandCourses.v1?q=slug&slug=course-b",
      method: "GET",
      headerNames: ["x-csrf3-token"],
      csrf3Token: options.token ?? "token-1",
      urlUserId: "42",
    };
    session.update(capture);
  }
  const calls: { url: string; init?: RequestInit }[] = [];
  const shows: BannerContent[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return options.route(url);
  });
  const runner = createCompletionRunner({
    location: () => options.location ?? COURSE_A_URL,
    session,
    fetch: fetch as unknown as typeof globalThis.fetch,
    banner: { show: (content) => shows.push(content), hide: () => {} },
    delay: async () => {},
  });
  return { runner, calls, shows, last: () => shows.at(-1) };
}

function isMaterials(url: string): boolean {
  return url.includes("onDemandCourseMaterials.v2");
}

function isProgress(url: string): boolean {
  return url.includes("onDemandCoursesProgress.v1");
}

let alertSpy: Mock;

beforeEach(() => {
  alertSpy = vi.fn();
  vi.stubGlobal("alert", alertSpy);
});

afterEach(() => {
  // F5: content.js:486,543,548 in v1.1.0 (c2f8b71) used alert(); the banner is the only surface.
  expect(alertSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("completion course (F1)", () => {
  it("requests only the course from the route, never an intercepted slug", async () => {
    // Guards content.js:80-85,467,514 in v1.1.0 (c2f8b71): an intercepted slug= chose the course.
    const { runner, calls } = setup({
      route: (url) =>
        isMaterials(url)
          ? json(
              materials([
                { id: "L1", itemClass: "lecture" },
                { id: "L2", itemClass: "lecture" },
              ]),
            )
          : json({}),
    });

    await runner.start().done;

    expect(calls).toHaveLength(4);
    for (const { url, init } of calls) {
      // The progress read is keyed by the internal id from the route course's own materials.
      expect(url.includes("course-a") || url.includes("internal-a")).toBe(true);
      expect(url).not.toContain("course-b");
      expect(String(init?.body ?? "")).not.toContain("course-b");
    }
  });
});

describe("completion robustness (F5)", () => {
  it("keeps requesting after an item request rejects", async () => {
    // Guards content.js:514,536 in v1.1.0 (c2f8b71), where a rejected fetch aborted the whole loop.
    const { runner, calls } = setup({
      route: (url) => {
        if (isMaterials(url)) {
          return json(
            materials([
              { id: "L1", itemClass: "lecture" },
              { id: "L2", itemClass: "lecture" },
            ]),
          );
        }
        if (url.includes("/item/L1/")) throw new TypeError("Failed to fetch");
        return json({});
      },
    });

    const summary = await runner.start().done;

    expect(calls.some(({ url }) => url.includes("/item/L2/"))).toBe(true);
    expect(summary).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      skippedLocked: 0,
      alreadyCompleted: 0,
    });
  });

  it("counts a non-OK item response as failed and ends on an error card", async () => {
    // Guards content.js:536-542 in v1.1.0 (c2f8b71), which reported success without status checks.
    const { runner, last } = setup({
      route: (url) => {
        if (isMaterials(url)) {
          return json(
            materials([
              { id: "L1", itemClass: "lecture" },
              { id: "L2", itemClass: "lecture" },
            ]),
          );
        }
        return url.includes("/item/L2/") ? json({}, 401) : json({});
      },
    });

    const summary = await runner.start().done;

    expect(summary).toEqual({
      total: 2,
      completed: 1,
      failed: 1,
      skippedLocked: 0,
      alreadyCompleted: 0,
    });
    expect(last()).toEqual({
      tone: "error",
      title: "Completed 1 of 2",
      description: "1 failed. Refresh the page to see your progress.",
    });
  });

  it("never requests a locked item and reports it as skipped", async () => {
    // Guards content.js:519-525 in v1.1.0 (c2f8b71), which posted locked supplement completions.
    const { runner, calls, last } = setup({
      route: (url) =>
        isMaterials(url)
          ? json(
              materials([
                { id: "L1", itemClass: "lecture" },
                { id: "S-locked", itemClass: "supplement", isLocked: true },
              ]),
            )
          : json({}),
    });

    const summary = await runner.start().done;

    expect(calls.some(({ init }) => String(init?.body ?? "").includes("S-locked"))).toBe(false);
    expect(summary).toEqual({
      total: 1,
      completed: 1,
      failed: 0,
      skippedLocked: 1,
      alreadyCompleted: 0,
    });
    expect(last()).toEqual({
      tone: "success",
      title: "Materials completed",
      description:
        "1 of 1 items completed. Refresh the page to see your progress. 1 locked item(s) skipped.",
      autoHideMs: 6000,
    });
  });

  it("refuses a second run while one is active", async () => {
    // Guards content.js:108-128 in v1.1.0 (c2f8b71), which started overlapping loops.
    const { runner } = setup({
      route: (url) =>
        isMaterials(url) ? json(materials([{ id: "L1", itemClass: "lecture" }])) : json({}),
    });

    const first = runner.start();
    expect(() => runner.start()).toThrow(COMPLETION_BUSY_MESSAGE);
    await first.done;
    await expect(runner.start().done).resolves.toMatchObject({ completed: 1 });
  });

  it("fails with the authorization text when the materials request is rejected", async () => {
    // Guards content.js:474 in v1.1.0 (c2f8b71), which parsed a 403 body as materials.
    const { runner, calls, last } = setup({ route: () => json({}, 403) });

    await expect(runner.start().done).resolves.toBeNull();

    expect(calls).toHaveLength(1);
    expect(last()).toEqual({
      tone: "error",
      title: "Course completion failed",
      description: "Coursera could not authorize the course request. Sign in, then try again.",
    });
  });

  it("throws the missing token text synchronously", () => {
    const { runner, calls } = setup({ route: () => json({}), token: null });

    expect(() => runner.start()).toThrow(
      "Missing Auth Token! Please click around the course (e.g., refresh or open a new video) to grab background security tokens.",
    );
    expect(calls).toHaveLength(0);
  });

  it("throws the missing course text synchronously off a course route", () => {
    const { runner } = setup({ route: () => json({}), location: "https://www.coursera.org/" });

    expect(() => runner.start()).toThrow(
      "Missing Course ID! Please go to the main course page to grab your Course ID.",
    );
  });
});

describe("completion requests", () => {
  it("posts lecture and supplement completions with the session token and user", async () => {
    const { runner, calls } = setup({
      route: (url) =>
        isMaterials(url)
          ? json(
              materials([
                { id: "L1", itemClass: "lecture" },
                { id: "S1", itemClass: "supplement" },
                { id: "D1", itemClass: "discussionPrompt" },
              ]),
            )
          : json({}),
    });

    const summary = await runner.start().done;

    expect(summary).toEqual({
      total: 2,
      completed: 2,
      failed: 0,
      skippedLocked: 0,
      alreadyCompleted: 0,
    });
    expect(calls[0]).toEqual({
      url: expect.stringContaining("slug=course-a"),
      init: { headers: { "X-CSRF3-Token": "token-1" } },
    });
    const headers = { "Content-Type": "application/json", "X-CSRF3-Token": "token-1" };
    expect(calls.slice(2)).toEqual([
      {
        url: "https://www.coursera.org/api/opencourse.v1/user/42/course/course-a/item/L1/lecture/videoEvents/ended?autoEnroll=false",
        init: { method: "POST", headers, body: '{"contentRequestBody":{}}' },
      },
      {
        url: "https://www.coursera.org/api/onDemandSupplementCompletions.v1",
        init: {
          method: "POST",
          headers,
          body: JSON.stringify({ userId: 42, courseId: "internal-a", itemId: "S1" }),
        },
      },
    ]);
  });

  it("marks an ungraded plugin completed through a fresh widget session", async () => {
    // content.js:566 in v1.1.0 (c2f8b71) excluded ungradedWidget, so plugins whose page only asks
    // the learner to press "Mark as completed" stayed incomplete.
    const { runner, calls } = setup({
      route: (url) => {
        if (isMaterials(url)) return json(materials([{ id: "W1", itemClass: "ungradedWidget" }]));
        if (isProgress(url)) return json({});
        if (url.includes("/onDemandWidgetSessions.v1/")) {
          return json({ elements: [{ sessionId: "session-1" }] });
        }
        return new Response(null, { status: 204 });
      },
    });

    const summary = await runner.start().done;

    expect(summary).toEqual({
      total: 1,
      completed: 1,
      failed: 0,
      skippedLocked: 0,
      alreadyCompleted: 0,
    });
    expect(calls.slice(2)).toEqual([
      {
        url: "https://www.coursera.org/api/onDemandWidgetSessions.v1/42~internal-a~W1?fields=sessionId",
        init: { headers: { "X-CSRF3-Token": "token-1" } },
      },
      {
        url: "https://www.coursera.org/api/onDemandWidgetProgress.v1/42~internal-a~W1",
        init: {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-CSRF3-Token": "token-1" },
          body: JSON.stringify({ sessionId: "session-1", progressState: "Completed" }),
        },
      },
    ]);
  });

  it.each([
    ["a failed session request", json({}, 500)],
    ["a session without an id", json({ elements: [] })],
  ])("counts a plugin as failed without marking it after %s", async (_case, session) => {
    const { runner, calls } = setup({
      route: (url) => {
        if (isMaterials(url)) return json(materials([{ id: "W1", itemClass: "ungradedWidget" }]));
        return isProgress(url) ? json({}) : session;
      },
    });

    const summary = await runner.start().done;

    expect(summary).toEqual({
      total: 1,
      completed: 0,
      failed: 1,
      skippedLocked: 0,
      alreadyCompleted: 0,
    });
    expect(calls.map(({ init }) => init?.method ?? "GET")).toEqual(["GET", "GET", "GET"]);
  });

  it("shows chunk progress with the failed count", async () => {
    const items = Array.from({ length: 8 }, (_, index) => ({
      id: `L${index + 1}`,
      itemClass: "lecture",
    }));
    const { runner, shows } = setup({
      route: (url) =>
        isMaterials(url) ? json(materials(items)) : json({}, url.includes("/item/L1/") ? 500 : 200),
    });

    await runner.start().done;

    expect(shows.slice(0, 3)).toEqual([
      { tone: "info", title: "Completing materials", description: "Gathering course data…" },
      { tone: "info", title: "Completing materials", description: "Items 1–6 of 8", progress: 0 },
      {
        tone: "info",
        title: "Completing materials",
        description: "Items 7–8 of 8",
        detail: "1 failed",
        progress: 6 / 8,
      },
    ]);
  });

  it("shows an error card when nothing can be completed", async () => {
    const { runner, last } = setup({ route: () => json(materials([])) });

    await expect(runner.start().done).resolves.toBeNull();

    expect(last()).toEqual({
      tone: "error",
      title: "Nothing to complete",
      description: "Could not find any videos/modules to complete.",
    });
  });
});

describe("already completed items", () => {
  it("requests only the items the learner has not completed", async () => {
    const { runner, calls, last } = setup({
      route: (url) => {
        if (isMaterials(url)) {
          return json(
            materials([
              { id: "L1", itemClass: "lecture" },
              { id: "L2", itemClass: "lecture" },
              { id: "S1", itemClass: "supplement" },
            ]),
          );
        }
        if (isProgress(url)) {
          return json({
            elements: [
              { items: { L1: { progressState: "Completed" }, L2: { progressState: "Started" } } },
            ],
          });
        }
        return json({});
      },
    });

    const summary = await runner.start().done;

    expect(calls[1]).toEqual({
      url: "https://www.coursera.org/api/onDemandCoursesProgress.v1/42~internal-a?fields=items",
      init: { headers: { "X-CSRF3-Token": "token-1" } },
    });
    expect(calls.slice(2).map(({ url, init }) => `${url} ${String(init?.body ?? "")}`)).toEqual([
      expect.stringContaining("/item/L2/"),
      expect.stringContaining('"itemId":"S1"'),
    ]);
    expect(summary).toEqual({
      total: 2,
      completed: 2,
      failed: 0,
      skippedLocked: 0,
      alreadyCompleted: 1,
    });
    expect(last()).toEqual({
      tone: "success",
      title: "Materials completed",
      description:
        "2 of 2 items completed. Refresh the page to see your progress. 1 item(s) already completed.",
      autoHideMs: 6000,
    });
  });

  it("sends no completion request when every item is already completed", async () => {
    const { runner, calls, last } = setup({
      route: (url) =>
        isMaterials(url)
          ? json(
              materials([
                { id: "L1", itemClass: "lecture" },
                { id: "W1", itemClass: "ungradedWidget" },
              ]),
            )
          : json({
              elements: [
                {
                  items: {
                    L1: { progressState: "Completed" },
                    W1: { progressState: "Completed" },
                  },
                },
              ],
            }),
    });

    const summary = await runner.start().done;

    expect(calls).toHaveLength(2);
    expect(summary).toEqual({
      total: 0,
      completed: 0,
      failed: 0,
      skippedLocked: 0,
      alreadyCompleted: 2,
    });
    expect(last()).toEqual({
      tone: "success",
      title: "Materials already completed",
      description: "All 2 items were already completed.",
      autoHideMs: 6000,
    });
  });

  it("requests every item when the learner's progress cannot be read", async () => {
    // Coursera answers 404 for the "~" learner id that completion falls back to.
    const { runner, calls } = setup({
      route: (url) => {
        if (isMaterials(url)) return json(materials([{ id: "L1", itemClass: "lecture" }]));
        return isProgress(url) ? json({}, 404) : json({});
      },
    });

    const summary = await runner.start().done;

    expect(summary).toEqual({
      total: 1,
      completed: 1,
      failed: 0,
      skippedLocked: 0,
      alreadyCompleted: 0,
    });
    expect(calls.at(-1)?.url).toContain("/item/L1/");
  });
});
