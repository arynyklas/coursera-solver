import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
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

describe("provider settings", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    // vi.spyOn types the last overload (callback form, returns void); the popup uses the promise form.
    const query = vi.spyOn(browser.tabs, "query") as unknown as Mock<() => Promise<unknown[]>>;
    query.mockResolvedValue([]);
  });

  // F7: legacy popup re-read the selected provider after awaiting verification (popup.js:249-268).
  it("locks the form while verifying and saves under the provider chosen at click time", async () => {
    const user = userEvent.setup();
    render(
      <BusyProvider>
        <App />
      </BusyProvider>,
    );

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
});
