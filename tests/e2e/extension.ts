import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type Worker,
} from "@playwright/test";
import type { Browser } from "wxt/browser";
import type { ContentRequests, Reply } from "@/shared/messaging";

// The extension service worker's global; `serviceWorker.evaluate` callbacks run there.
declare const chrome: typeof Browser;

const EXT = path.resolve(".output/chrome-mv3");
const COURSERA_ORIGIN = "https://www.coursera.org";

export { expect };

export const test = base.extend<{
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads fixture dependencies from the destructuring pattern.
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    await use(context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker")));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

/**
 * Serves `html` as the body of `https://www.coursera.org<path>`; every other Coursera request is a 404.
 * Routes registered later take precedence, so specs can add API routes afterwards.
 */
export async function routeCourseraPage(
  context: BrowserContext,
  pagePath: string,
  html: string,
): Promise<string> {
  const url = new URL(pagePath, COURSERA_ORIGIN).href;
  await context.route(`${COURSERA_ORIGIN}/**`, (route) => route.fulfill({ status: 404 }));
  await context.route(
    (requestUrl) => requestUrl.href === url,
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`,
      }),
  );
  return url;
}

/** The id of the tab showing `url`, looked up from the extension service worker. */
export async function tabIdOf(serviceWorker: Worker, url: string): Promise<number> {
  const tabId = await serviceWorker.evaluate(
    async (tabUrl) => (await chrome.tabs.query({ url: tabUrl }))[0]?.id,
    url,
  );
  if (tabId === undefined) throw new Error(`No tab shows ${url}`);
  return tabId;
}

/** Sends a raw `{ type }` envelope from the extension service worker to the tab's content script. */
export function sendToTab<K extends keyof ContentRequests>(
  serviceWorker: Worker,
  tabId: number,
  message: { type: K },
): Promise<Reply<ContentRequests[K]["response"]>> {
  return serviceWorker.evaluate(([id, request]) => chrome.tabs.sendMessage(id, request), [
    tabId,
    message,
  ] as const);
}

/** Polls `getDiagnostics` every 100 ms (10 s max) until the ISOLATED content script answers. */
export async function waitForContentScript(serviceWorker: Worker, tabId: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastFailure = "no reply";
  while (Date.now() < deadline) {
    try {
      const reply = await sendToTab(serviceWorker, tabId, { type: "getDiagnostics" });
      if (reply.ok) return;
      lastFailure = `{ ok: false, error: ${JSON.stringify(reply.error)} }`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await delay(100);
  }
  throw new Error(`The content script never answered getDiagnostics; last failure: ${lastFailure}`);
}

export interface DomSnapshot {
  html: string;
  controls: {
    tagName: string;
    type: string;
    checked: boolean;
    value: string;
    textContent: string;
    disabled: boolean;
  }[];
}

/** Body markup plus form-control state (legacy/tests/browser/read-only-smoke.html:25-38). */
export function domSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => ({
    html: document.body.innerHTML,
    controls: Array.from(
      document.querySelectorAll("input, textarea, [contenteditable]"),
      (node) => ({
        tagName: node.tagName,
        type: node.getAttribute("type") || "",
        checked: "checked" in node && Boolean(node.checked),
        value: "value" in node && typeof node.value === "string" ? node.value : "",
        textContent: node.textContent || "",
        disabled: "disabled" in node && Boolean(node.disabled),
      }),
    ),
  }));
}
