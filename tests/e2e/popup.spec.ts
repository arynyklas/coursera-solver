import type { Page, TestInfo } from "@playwright/test";
import type { Browser } from "wxt/browser";
import { expect, test } from "./extension";

// The extension service worker's global; `serviceWorker.evaluate` callbacks run there.
declare const chrome: typeof Browser;

const ACTION_ROWS = [
  "Solve current quiz",
  "Fill dialogue answer",
  "Dry run",
  "Copy questions",
  "Course requirements",
  "Complete materials",
];

/** Review evidence for the design reference; never asserted pixel-wise. */
async function attachScreenshots(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    // Finishes the color transitions started by the scheme switch.
    await testInfo.attach(`${name}-${colorScheme}`, {
      body: await page.screenshot({ fullPage: true, animations: "disabled" }),
      contentType: "image/png",
    });
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
  await expect(page.getByRole("option")).toHaveCount(7);
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
