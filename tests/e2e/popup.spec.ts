import { readFileSync } from "node:fs";
import type { Page, TestInfo } from "@playwright/test";
import type { Browser } from "wxt/browser";
import {
  expect,
  routeCourseraPage,
  sendToTab,
  tabIdOf,
  test,
  waitForContentScript,
} from "./extension";

// The extension's global; `serviceWorker.evaluate` callbacks and the popup page's scripts use it.
declare const chrome: typeof Browser;

const ACTION_ROWS = [
  "Solve current quiz",
  "Fill dialogue answer",
  "Dry run",
  "Copy questions",
  "Course requirements",
  "Complete materials",
];

/**
 * Review evidence for the design reference; never asserted pixel-wise. The files stay in the test
 * output directory so CI uploads them even when every test passes.
 */
async function attachScreenshots(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    const screenshot = `${name}-${colorScheme}`;
    const path = testInfo.outputPath(`${screenshot}.png`);
    await page.emulateMedia({ colorScheme });
    // Finishes the color transitions started by the scheme switch.
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    await testInfo.attach(screenshot, { path, contentType: "image/png" });
  }
}

test("opens on settings without a key and on the off-course home with one", async ({
  page,
  serviceWorker,
  extensionId,
}, testInfo) => {
  await page.setViewportSize({ width: 380, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const provider = page.getByRole("combobox", { name: "Provider" });
  await expect(provider).toBeVisible();
  await attachScreenshots(page, testInfo, "settings");
  await provider.click();
  await expect(page.getByRole("option")).toHaveText([
    "Gemini",
    "OpenAI",
    "Claude",
    "xAI",
    "DeepSeek",
    "Groq",
    "OpenRouter",
    "vLLM",
  ]);
  await page.keyboard.press("Escape");

  await serviceWorker.evaluate(() =>
    chrome.storage.local.set({
      aiProvider: "gemini",
      aiProviderSettings: {
        gemini: { apiKey: "test", model: "gemini-3.7-flash", verifiedAt: 1 },
      },
    }),
  );
  await page.reload();

  // The popup tab itself is the active tab, so the home view is off course.
  await expect(
    page.getByText("Open a course on coursera.org/learn/… to use these actions."),
  ).toBeVisible();
  for (const title of ACTION_ROWS) {
    await expect(page.getByRole("button", { name: title })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  }
  await attachScreenshots(page, testInfo, "home");
});

const MATERIALS = readFileSync("tests/fixtures/course-materials-confirmed.json", "utf8");

/** The fixture's materials with the course slug in the practice checkpoint's name. */
function materialsFor(slug: string): unknown {
  return JSON.parse(
    MATERIALS.replaceAll('"Practice checkpoint"', `"${slug}: Practice checkpoint"`),
  );
}

test("an open Course requirements view follows its tab to another course", async ({
  context,
  page,
  serviceWorker,
  extensionId,
}) => {
  await serviceWorker.evaluate(() =>
    chrome.storage.local.set({
      aiProvider: "gemini",
      aiProviderSettings: {
        gemini: { apiKey: "test", model: "gemini-3.7-flash", verifiedAt: 1 },
      },
    }),
  );
  const courseA = await routeCourseraPage(context, "/learn/course-a/home/welcome", "<p>A</p>");
  const courseC = "https://www.coursera.org/learn/course-c/home/welcome";
  await context.route(courseC, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><p>C</p></body></html>",
    }),
  );
  const materialSlugs: string[] = [];
  await context.route("**/api/onDemandCourseMaterials.v2/**", (route) => {
    const slug = new URL(route.request().url()).searchParams.get("slug") ?? "";
    materialSlugs.push(slug);
    return route.fulfill({ json: materialsFor(slug) });
  });

  const coursePage = await context.newPage();
  await coursePage.goto(courseA);
  const tabId = await tabIdOf(serviceWorker, courseA);
  await waitForContentScript(serviceWorker, tabId);
  // The popup runs as a page of its own here, so it is pointed at the course tab as the active tab.
  await page.addInitScript((id) => {
    Object.defineProperty(chrome.tabs, "query", { value: async () => [await chrome.tabs.get(id)] });
  }, tabId);
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole("button", { name: "Course requirements" }).click();
  await expect(page.getByText("course-a: Practice checkpoint")).toBeVisible();

  // An in-page navigation, which Chrome reports as loading, then complete.
  await coursePage.evaluate(() => history.pushState({}, "", "/learn/course-b/home/welcome"));
  await expect(page.getByText("course-b: Practice checkpoint")).toBeVisible();

  // A full load through tabs.update, as a requirement link opens; the new page's content script
  // has to answer once Chrome reports the tab complete.
  await page.evaluate(([id, url]) => chrome.tabs.update(id, { url }), [tabId, courseC] as const);
  await expect(page.getByText("course-c: Practice checkpoint")).toBeVisible();
  expect(materialSlugs).toEqual(["course-a", "course-b", "course-c"]);
});

test("Course requirements marks the activities the learner completed", async ({
  context,
  page,
  serviceWorker,
  extensionId,
}, testInfo) => {
  await serviceWorker.evaluate(() =>
    chrome.storage.local.set({
      aiProvider: "gemini",
      aiProviderSettings: {
        gemini: { apiKey: "test", model: "gemini-3.7-flash", verifiedAt: 1 },
      },
    }),
  );
  // The page's own materials request carries the learner id, so the capture gives the content
  // script both the learner and the materials, with the internal course id.
  const courseA = await routeCourseraPage(
    context,
    "/learn/course-a/home/welcome",
    `<script>fetch("/api/onDemandCourseMaterials.v2/?q=slug&slug=course-a&userId=42");</script>`,
  );
  const materials = JSON.parse(MATERIALS);
  materials.elements[0].id = "internal-a";
  await context.route("**/api/onDemandCourseMaterials.v2/**", (route) =>
    route.fulfill({ json: materials }),
  );
  const progressRequests: string[] = [];
  await context.route("**/api/onDemandCoursesProgress.v1/**", (route) => {
    progressRequests.push(route.request().url());
    return route.fulfill({
      json: { elements: [{ items: { "quiz-1": { progressState: "Completed" } } }] },
    });
  });

  const coursePage = await context.newPage();
  await coursePage.goto(courseA);
  const tabId = await tabIdOf(serviceWorker, courseA);
  await waitForContentScript(serviceWorker, tabId);
  await expect
    .poll(async () => {
      const reply = await sendToTab(serviceWorker, tabId, { type: "getDiagnostics" });
      return reply.ok && reply.data.state.hasCourseMaterials;
    })
    .toBe(true);
  await page.addInitScript((id) => {
    Object.defineProperty(chrome.tabs, "query", { value: async () => [await chrome.tabs.get(id)] });
  }, tabId);
  await page.setViewportSize({ width: 380, height: 600 });
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.getByRole("button", { name: "Course requirements" }).click();

  await expect(page.getByText("1 of 2 completed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Completed\s*Practice checkpoint/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Not started\s*Module assessment/ }),
  ).toBeVisible();
  expect(progressRequests).toEqual([
    "https://www.coursera.org/api/onDemandCoursesProgress.v1/42~internal-a?fields=items",
  ]);
  await attachScreenshots(page, testInfo, "requirements");
});
