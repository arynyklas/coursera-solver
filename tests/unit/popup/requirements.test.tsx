import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App } from "@/popup/App";
import { BusyProvider } from "@/popup/hooks/busy";
import type * as Messaging from "@/shared/messaging";
import { sendToTab } from "@/shared/messaging";
import type { CourseRequirementsResult } from "@/shared/types";

vi.mock("@/shared/messaging", async (importOriginal) => {
  const actual = await importOriginal<typeof Messaging>();
  return { ...actual, sendToTab: vi.fn() };
});

const COURSE_A = "https://www.coursera.org/learn/course-a/home/welcome";
const COURSE_B = "https://www.coursera.org/learn/course-b/home/welcome";

/** One graded exam named after the course in `url`, as the content script would report it. */
function requirementsFor(url: string): CourseRequirementsResult {
  const name = `Final exam of ${new URL(url).pathname.split("/")[2]}`;
  return {
    requirements: [
      {
        id: name,
        name,
        type: "exam",
        moduleName: "Module 1",
        lessonName: "",
        gradingWeight: 1,
        weightPercent: 100,
        requiredForPassing: true,
        groupRequirement: null,
        locked: false,
        lockReason: "",
        timeCommitment: null,
        source: "confirmed",
        link: null,
      },
    ],
    summary: {
      confirmed: true,
      totalGradingWeight: 1,
      gradingWeightsComplete: true,
      requiredCount: 1,
      lockedCount: 0,
      unmappedCount: 0,
      unresolvedCount: 0,
    },
  };
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
    const tab = await browser.tabs.create({ url: COURSE_A });
    const tabId = tab.id ?? -1;
    // vi.spyOn types the last overload (callback form, returns void); the popup uses the promise form.
    const query = vi.spyOn(browser.tabs, "query") as unknown as Mock<() => Promise<unknown[]>>;
    query.mockResolvedValue([{ ...tab, active: true, status: "complete" }]);
    vi.mocked(sendToTab).mockImplementation((async (id: number) => {
      const shown = await browser.tabs.get(id);
      return requirementsFor(shown.url ?? "");
    }) as typeof sendToTab);
    const user = userEvent.setup();
    render(
      <BusyProvider>
        <App />
      </BusyProvider>,
    );

    await user.click(await screen.findByRole("button", { name: /^Course requirements/ }));
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
});
