import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App } from "@/popup/App";
import { BusyProvider } from "@/popup/hooks/busy";
import type * as Messaging from "@/shared/messaging";

const verify = vi.hoisted(() => ({ resolve: (_reply: { message: string }) => {} }));

vi.mock("@/shared/messaging", async (importOriginal) => {
  const actual = await importOriginal<typeof Messaging>();
  return {
    ...actual,
    sendToBackground: vi.fn(
      () =>
        new Promise<{ message: string }>((resolve) => {
          verify.resolve = resolve;
        }),
    ),
  };
});

function renderPopup() {
  return render(
    <BusyProvider>
      <App />
    </BusyProvider>,
  );
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

describe("provider settings", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // vi.spyOn types the last overload (callback form, returns void); the popup uses the promise form.
    const query = vi.spyOn(browser.tabs, "query") as unknown as Mock<() => Promise<unknown[]>>;
    query.mockResolvedValue([]);
  });
  // Vitest runs without globals, so Testing Library cannot register its own cleanup.
  afterEach(() => {
    cleanup();
  });

  // F7: popup.js:249-268 in v1.1.0 (c2f8b71) re-read the selected provider after verification.
  it("locks the form while verifying and saves under the provider chosen at click time", async () => {
    const user = userEvent.setup();
    renderPopup();

    const provider = await screen.findByRole("combobox", { name: "Provider" });
    expect(provider.textContent).toContain("Gemini");
    const keyInput = screen.getByLabelText("API key") as HTMLInputElement;
    await user.type(keyInput, "AIza-test");
    await user.click(screen.getByRole("button", { name: "Save & verify" }));

    expect((provider as HTMLButtonElement).disabled).toBe(true);
    expect(keyInput.disabled).toBe(true);

    verify.resolve({ message: "Gemini is connected." });
    await screen.findByText("Gemini is connected.");

    const stored = await browser.storage.local.get(null);
    expect(stored.aiProvider).toBe("gemini");
    expect(stored.aiProviderSettings).toEqual({
      gemini: { apiKey: "AIza-test", model: "gemini-3.7-flash", verifiedAt: expect.any(Number) },
    });
    expect(stored).not.toHaveProperty("userApiKey");
  });

  // Guards Settings redirect leak found in review: Back mid-check left a timer that later sent the user Home.
  it("keeps Back locked through the success redirect and navigates Home once", async () => {
    vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
      manifest_version: 3,
      name: "Coursera Auto Solver",
      version: "2.0.0",
    });
    const user = userEvent.setup();
    renderPopup();

    await user.type(await screen.findByLabelText("API key"), "AIza-test");
    const save = screen.getByRole("button", { name: "Save & verify" }) as HTMLButtonElement;
    await user.click(save);
    const back = screen.getByRole("button", { name: "Back" }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);

    verify.resolve({ message: "Gemini is connected." });
    await screen.findByText("Gemini is connected.");
    expect(back.disabled).toBe(true);
    expect(save.disabled).toBe(true);

    await screen.findByRole("heading", { name: "Auto Solver" }, { timeout: 2000 });
    await user.click(screen.getByRole("button", { name: "AI provider settings" }));
    await screen.findByRole("heading", { name: "AI provider" });
    await sleep(1000);
    expect(screen.queryByRole("heading", { name: "AI provider" })).not.toBeNull();
  });

  // Guards Settings redirect leak found in review: a check resolving after unmount still scheduled the redirect.
  it("stores the verified key but schedules no redirect when the view unmounts mid-check", async () => {
    const user = userEvent.setup();
    const { unmount } = renderPopup();

    await user.type(await screen.findByLabelText("API key"), "AIza-test");
    await user.click(screen.getByRole("button", { name: "Save & verify" }));
    unmount();
    const timers = vi.spyOn(window, "setTimeout");

    verify.resolve({ message: "Gemini is connected." });
    await vi.waitFor(async () => {
      const stored = await browser.storage.local.get(null);
      expect(stored.aiProvider).toBe("gemini");
      expect(stored.aiProviderSettings).toEqual({
        gemini: { apiKey: "AIza-test", model: "gemini-3.7-flash", verifiedAt: expect.any(Number) },
      });
    });
    await sleep(1000);
    expect(timers).not.toHaveBeenCalledWith(expect.any(Function), 750);
  });
});
