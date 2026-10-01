import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App } from "@/popup/App";
import { BusyProvider } from "@/popup/hooks/busy";
import type * as Messaging from "@/shared/messaging";
import { sendToTab } from "@/shared/messaging";
import type { CourseRequirementsResult, Requirement, RequirementStatus } from "@/shared/types";

vi.mock("@/shared/messaging", async (importOriginal) => {
  const actual = await importOriginal<typeof Messaging>();
  return { ...actual, sendToTab: vi.fn() };
});

const COURSE_A = "https://www.coursera.org/learn/course-a/home/welcome";
const COURSE_B = "https://www.coursera.org/learn/course-b/home/welcome";

/** A graded exam as the content script reports it, with the learner's status and grade on it. */
function requirement(
  name: string,
  status: RequirementStatus | null,
  grade: number | null = null,
): Requirement {
  return {
    id: name,
    name,
    type: "exam",
    moduleName: "Module 1",
    lessonName: "",
    gradingWeight: 1,
    weightPercent: null,
    requiredForPassing: true,
    groupRequirement: null,
    locked: false,
    lockReason: "",
    timeCommitment: null,
    source: "confirmed",
    link: null,
    status,
    grade,
  };
}

function result(requirements: Requirement[]): CourseRequirementsResult {
  const progressKnown = requirements.every(({ status }) => status !== null);
  return {
    requirements,
    summary: {
      confirmed: true,
      totalGradingWeight: requirements.length,
      gradingWeightsComplete: false,
      requiredCount: requirements.length,
      lockedCount: 0,
      unmappedCount: 0,
      unresolvedCount: 0,
      completedCount: progressKnown
        ? requirements.filter(({ status }) => status === "passed" || status === "completed").length
        : null,
    },
  };
}

/**
 * Opens Course requirements in the popup for a course tab; the content script answers with
 * `reply` for the URL the tab shows at that moment.
 */
async function openRequirements(reply: (url: string) => CourseRequirementsResult) {
  const tab = await browser.tabs.create({ url: COURSE_A });
  // vi.spyOn types the last overload (callback form, returns void); the popup uses the promise form.
  const query = vi.spyOn(browser.tabs, "query") as unknown as Mock<() => Promise<unknown[]>>;
  query.mockResolvedValue([{ ...tab, active: true, status: "complete" }]);
  vi.mocked(sendToTab).mockImplementation((async (id: number) => {
    const shown = await browser.tabs.get(id);
    return reply(shown.url ?? "");
  }) as typeof sendToTab);
  const user = userEvent.setup();
  render(
    <BusyProvider>
      <App />
    </BusyProvider>,
  );
  await user.click(await screen.findByRole("button", { name: /^Course requirements/ }));
  return tab;
}

describe("Course requirements view", () => {
  beforeEach(async () => {
    fakeBrowser.reset();
    vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
      manifest_version: 3,
      name: "Coursera Auto Solver",
      version: "2.0.0",
    });
    await browser.storage.local.set({
      aiProvider: "gemini",
      aiProviderSettings: { gemini: { apiKey: "k", model: "gemini-3.7-flash", verifiedAt: 1 } },
    });
  });
  // Vitest runs without globals, so Testing Library cannot register its own cleanup.
  afterEach(() => {
    cleanup();
  });

  // Guards the stale view the user reported: the popup read the tab once, so an open view kept
  // the requirements of the course the tab had left.
  it("starts over for the page the tab finished loading", async () => {
    const tab = await openRequirements((url) =>
      result([requirement(`Final exam of ${new URL(url).pathname.split("/")[2]}`, null)]),
    );
    const tabId = tab.id ?? -1;
    await screen.findByText("Final exam of course-a");

    // A title change on the same page keeps the result.
    await fakeBrowser.tabs.onUpdated.trigger(
      tabId,
      { title: "Course A" },
      { ...tab, title: "Course A", status: "complete" },
    );
    // While the next page loads, its content script may not answer yet.
    await browser.tabs.update(tabId, { url: COURSE_B });
    await fakeBrowser.tabs.onUpdated.trigger(
      tabId,
      { status: "loading", url: COURSE_B },
      { ...tab, url: COURSE_B, status: "loading" },
    );
    expect(sendToTab).toHaveBeenCalledTimes(1);

    await fakeBrowser.tabs.onUpdated.trigger(
      tabId,
      { status: "complete" },
      { ...tab, url: COURSE_B, status: "complete" },
    );

    await screen.findByText("Final exam of course-b");
    expect(screen.queryByText("Final exam of course-a")).toBeNull();
    expect(sendToTab).toHaveBeenCalledTimes(2);
    expect(sendToTab).toHaveBeenLastCalledWith(tabId, "getCourseRequirements", {});
  });

  it("shows each requirement's status and grade the way Coursera's Grades page does", async () => {
    await openRequirements(() =>
      result([
        requirement("Module quiz", "passed", 0.9),
        requirement("Final exam", "failed", 0.4),
        requirement("Peer review", "submitted"),
        requirement("Practice lab", "completed"),
        requirement("Course project", "notSubmitted"),
      ]),
    );

    await screen.findByText("2 of 5 completed");
    // The status leads each row's accessible name, so it is announced with the activity.
    expect(screen.getByRole("button", { name: /^Passed\s*Module quiz.*Grade 90%/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Didn't pass\s*Final exam.*Grade 40%/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Submitted\s*Peer review/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Completed\s*Practice lab/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Not submitted\s*Course project/ })).toBeTruthy();
  });

  it("says so when the learner's progress could not be read", async () => {
    await openRequirements(() => result([requirement("Final exam", null)]));

    await screen.findByText(/Your Coursera progress could not be read/);
    expect(screen.queryByText(/ completed$/)).toBeNull();
    expect(screen.getByRole("button", { name: /^Final exam/ })).toBeTruthy();
  });
});
