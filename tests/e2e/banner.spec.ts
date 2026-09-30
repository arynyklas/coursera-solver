import { BRIDGE, type BridgeMessage } from "@/shared/bridge";
import {
  expect,
  routeCourseraPage,
  sendToTab,
  tabIdOf,
  test,
  waitForContentScript,
} from "./extension";

// The course's own materials request, then a background request for another course. The
// other-course capture is held until the materials capture was posted, so it is the latest captured
// slug: content.js:80-85 in v1.1.0 (c2f8b71) completed whichever course was captured last (F1).
const PAGE = `<script>
  const headers = { "x-csrf3-token": "fixture-token" };
  fetch("/api/onDemandCourses.v1?q=slug&slug=other-course", { headers });
  fetch("/api/onDemandCourseMaterials.v2/?q=slug&slug=sample-course&includes=items", { headers });
</script>`;

const MATERIALS = {
  elements: [{ id: "internal-course-id" }],
  linked: {
    "onDemandCourseMaterialItems.v2": [
      { id: "L1", name: "Welcome video", contentSummary: { typeName: "lecture" } },
      { id: "L2", name: "Second video", contentSummary: { typeName: "lecture" } },
      { id: "S1", name: "Course reading", contentSummary: { typeName: "supplement" } },
      { id: "L3", name: "Locked video", contentSummary: { typeName: "lecture" }, isLocked: true },
      { id: "Q1", name: "Module check", contentSummary: { typeName: "quiz" } },
    ],
  },
};

const HOLD_TIMEOUT_MS = 10_000;

type FixtureWindow = Window & { __bridgeLog?: BridgeMessage[]; __alertCalls?: number };

interface CompletionRequest {
  url: string;
  body: string | null;
}

test("completes materials of the routed course and reports the result in the banner", async ({
  context,
  page,
  serviceWorker,
}, testInfo) => {
  await page.addInitScript((sources) => {
    const win = window as FixtureWindow;
    const log: BridgeMessage[] = [];
    win.__bridgeLog = log;
    window.addEventListener("message", (event: MessageEvent<BridgeMessage>) => {
      if (sources.includes(event.data?.source)) log.push(event.data);
    });
    win.__alertCalls = 0;
    window.alert = () => {
      win.__alertCalls = (win.__alertCalls ?? 0) + 1;
    };
  }, Object.values(BRIDGE));
  // The init-script stub only covers the page world; a dialog from any world lands here.
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });

  const url = await routeCourseraPage(context, "/learn/sample-course/home/welcome", PAGE);
  await context.route("**/api/onDemandCourseMaterials.v2/**", (route) =>
    route.fulfill({ json: MATERIALS }),
  );
  let holdError: Error | null = null;
  await context.route("**/api/onDemandCourses.v1**", async (route) => {
    try {
      await page.waitForFunction(
        (source) =>
          ((window as FixtureWindow).__bridgeLog ?? []).some(
            (message) => message.source === source && message.capture.materials !== undefined,
          ),
        BRIDGE.capture,
        { polling: 50, timeout: HOLD_TIMEOUT_MS },
      );
    } catch (error) {
      holdError = new Error(
        `The materials capture never reached the bridge within ${HOLD_TIMEOUT_MS} ms. ` +
          `Cause: ${error instanceof Error ? error.message : error}`,
      );
    }
    await route.fulfill({ json: {} });
  });
  const completions: CompletionRequest[] = [];
  await context.route("**/api/opencourse.v1/user/**", (route) => {
    const request = route.request();
    completions.push({ url: request.url(), body: request.postData() });
    return route.fulfill({ status: request.url().includes("/item/L1/") ? 200 : 500, json: {} });
  });
  await context.route("**/api/onDemandSupplementCompletions.v1", (route) => {
    const request = route.request();
    completions.push({ url: request.url(), body: request.postData() });
    return route.fulfill({ json: {} });
  });

  await page.goto(url);
  await page.waitForFunction(
    (source) =>
      ((window as FixtureWindow).__bridgeLog ?? []).some(
        (message) => message.source === source && message.capture.url.includes("slug=other-course"),
      ),
    BRIDGE.capture,
    { polling: 50, timeout: HOLD_TIMEOUT_MS },
  );
  if (holdError) throw holdError;
  const capturedSlugs = await page.evaluate(
    (source) =>
      ((window as FixtureWindow).__bridgeLog ?? []).flatMap((message) =>
        message.source === source ? [new URL(message.capture.url).searchParams.get("slug")] : [],
      ),
    BRIDGE.capture,
  );
  expect(capturedSlugs.filter(Boolean).at(-1)).toBe("other-course");

  const tabId = await tabIdOf(serviceWorker, url);
  await waitForContentScript(serviceWorker, tabId);
  // The ISOLATED runtime has ingested the token-bearing capture (live or from the snapshot).
  await expect
    .poll(async () => {
      const reply = await sendToTab(serviceWorker, tabId, { type: "getDiagnostics" });
      return reply.ok ? reply.data.state.observedHeaderNames : [];
    })
    .toContain("x-csrf3-token");

  expect(await sendToTab(serviceWorker, tabId, { type: "completeMaterials" })).toEqual({
    ok: true,
    data: { status: "started" },
  });

  await expect(page.locator("coursera-solver-banner")).toBeAttached();
  const card = page.locator("coursera-solver-banner .csb-card");
  await expect(card.locator(".csb-title")).toHaveText("Completed 2 of 3");
  await expect(card.locator(".csb-desc")).toContainText("1 failed");
  await expect(card.locator(".csb-desc")).toContainText("1 locked item(s) skipped.");
  // Proves the web-accessible stylesheet reached the shadow root.
  await expect(card).toHaveCSS("background-color", "rgb(10, 10, 10)");
  await expect(card).toHaveCSS("position", "fixed");

  const lectures = completions.filter(({ url }) => url.includes("/api/opencourse.v1/"));
  expect(lectures).toHaveLength(2);
  for (const { url } of lectures) {
    expect(url).toContain("/course/sample-course/");
    expect(url).not.toContain("other-course");
  }
  const supplements = completions.filter(({ url }) =>
    url.includes("/api/onDemandSupplementCompletions.v1"),
  );
  expect(supplements).toHaveLength(1);
  const supplementBody = JSON.parse(supplements[0]?.body ?? "null") as Record<string, unknown>;
  expect(supplementBody).toEqual({
    userId: expect.anything(),
    courseId: "internal-course-id",
    itemId: "S1",
  });
  expect(supplementBody.userId === "~" || typeof supplementBody.userId === "number").toBe(true);
  const requestedItems = [
    ...lectures.map(({ url }) => url.match(/\/item\/([^/]+)\//)?.[1]),
    supplementBody.itemId,
  ];
  expect(requestedItems.sort()).toEqual(["L1", "L2", "S1"]);

  expect(await page.evaluate(() => (window as FixtureWindow).__alertCalls)).toBe(0);
  expect(dialogs).toEqual([]);

  const screenshot = testInfo.outputPath("banner-completion-error.png");
  await card.screenshot({ path: screenshot, animations: "disabled" });
  await testInfo.attach("banner-completion-error", { path: screenshot, contentType: "image/png" });
});
