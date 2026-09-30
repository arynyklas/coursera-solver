import { BRIDGE, type BridgeMessage } from "@/shared/bridge";
import {
  expect,
  routeCourseraPage,
  sendToTab,
  tabIdOf,
  test,
  waitForContentScript,
} from "./extension";

// The parser-blocking /fixture-hold.js is only fulfilled once both requests have settled. It holds
// DOMContentLoaded, so the ISOLATED script (document_idle) loads after the captures were posted and
// can only learn them from the MAIN-world snapshot answering its hello: this forces the F6(c) path.
// Without the hold, document_idle fires before the routed fetches finish and the live capture
// message would make this test pass without exercising the snapshot.
const PAGE = `<script>
  window.__results = {};
  fetch("/api/onDemandCourseMaterials.v2/?q=slug&slug=sample-course&includes=items", {
    headers: { "x-csrf3-token": "fixture-token" },
  }).then((r) => r.json()).then(() => { window.__results.materials = "ok"; });
  const form = new FormData();
  form.append("field", "value");
  fetch("/api/fixtureEcho.v1", { method: "POST", body: form }).then(
    () => { window.__results.formData = "resolved"; },
    (error) => { window.__results.formData = "rejected: " + error; },
  );
</script>
<script src="/fixture-hold.js"></script>`;

type FixtureWindow = Window & {
  __results?: { materials?: string; formData?: string };
  __bridgeLog?: BridgeMessage[];
};

test("captures course materials without breaking FormData posts", async ({
  context,
  page,
  serviceWorker,
}) => {
  // Page scripts share `window` with the MAIN world and can observe bridge traffic (spec §3.3).
  await page.addInitScript((sources) => {
    const log: BridgeMessage[] = [];
    (window as FixtureWindow).__bridgeLog = log;
    window.addEventListener("message", (event: MessageEvent<BridgeMessage>) => {
      if (sources.includes(event.data?.source)) log.push(event.data);
    });
  }, Object.values(BRIDGE));
  const url = await routeCourseraPage(context, "/learn/sample-course/home/welcome", PAGE);
  await context.route("**/api/onDemandCourseMaterials.v2/**", (route) =>
    route.fulfill({
      path: "tests/fixtures/course-materials-confirmed.json",
      contentType: "application/json",
    }),
  );
  await context.route("**/api/fixtureEcho.v1", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await context.route("**/fixture-hold.js", async (route) => {
    await page.waitForFunction(
      () => {
        const results = (window as FixtureWindow).__results;
        return results?.materials === "ok" && results.formData !== undefined;
      },
      undefined,
      { polling: 50 },
    );
    await route.fulfill({ contentType: "text/javascript", body: "" });
  });

  await page.goto(url);
  const results = await page.evaluate(() => (window as FixtureWindow).__results);
  // Regression for the upstream DataCloneError: the interceptor must never read request bodies.
  expect(results?.formData).toBe("resolved");

  const tabId = await tabIdOf(serviceWorker, url);
  await waitForContentScript(serviceWorker, tabId);
  const diagnostics = await sendToTab(serviceWorker, tabId, { type: "getDiagnostics" });
  if (!diagnostics.ok) throw new Error(`getDiagnostics failed: ${diagnostics.error}`);
  expect(diagnostics.data.state.hasCourseMaterials).toBe(true);
  expect(diagnostics.data.state.observedHeaderNames).toContain("x-csrf3-token");

  // Every capture was posted before the ISOLATED hello, and the snapshot answering it carried them.
  const bridgeLog = await page.evaluate(() => (window as FixtureWindow).__bridgeLog ?? []);
  const sources = bridgeLog.map((message) => message.source);
  expect(sources.filter((source) => source === BRIDGE.hello)).toHaveLength(1);
  expect(sources).toContain(BRIDGE.capture);
  expect(sources.indexOf(BRIDGE.hello)).toBeGreaterThan(sources.lastIndexOf(BRIDGE.capture));
  expect(bridgeLog.find((message) => message.source === BRIDGE.snapshot)).toMatchObject({
    snapshot: {
      headerNames: expect.arrayContaining(["x-csrf3-token"]),
      materials: { url: expect.stringContaining("slug=sample-course") },
    },
  });
});
