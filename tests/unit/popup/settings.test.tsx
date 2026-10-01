import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { App } from "@/popup/App";
import { BusyProvider } from "@/popup/hooks/busy";
import type * as Messaging from "@/shared/messaging";
import { type BackgroundRequests, sendToBackground } from "@/shared/messaging";
import { serverDraftItem } from "@/shared/storage";

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

type BackgroundReplies = { [K in keyof BackgroundRequests]?: BackgroundRequests[K]["response"] };

function answerBackground(replies: BackgroundReplies) {
  vi.mocked(sendToBackground).mockImplementation((async (type: keyof BackgroundRequests) => {
    const reply = replies[type];
    if (reply === undefined) throw new Error(`Unexpected ${type} request.`);
    return reply;
  }) as typeof sendToBackground);
}

/** Chrome's answer to `permissions.request` or `permissions.contains`. */
function stubPermissions(method: "request" | "contains", answer: Promise<boolean>) {
  // vi.spyOn types the last overload (callback form, returns void); the popup uses the promise form.
  const spy = vi.spyOn(browser.permissions, method) as unknown as Mock<
    (permissions: { origins?: string[] }) => Promise<boolean>
  >;
  return spy.mockReturnValue(answer);
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
      gemini: {
        apiKey: "AIza-test",
        model: "gemini-3.7-flash",
        effort: "medium",
        verifiedAt: expect.any(Number),
      },
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
        gemini: {
          apiKey: "AIza-test",
          model: "gemini-3.7-flash",
          effort: "medium",
          verifiedAt: expect.any(Number),
        },
      });
    });
    await sleep(1000);
    expect(timers).not.toHaveBeenCalledWith(expect.any(Function), 750);
  });

  it("saves the reasoning effort chosen for the provider", async () => {
    answerBackground({ verifyProvider: { message: "Gemini is connected." } });
    const user = userEvent.setup();
    renderPopup();

    const effort = await screen.findByRole("combobox", { name: "Reasoning effort" });
    expect(effort.textContent).toContain("Medium");
    await user.click(effort);
    await user.click(await screen.findByRole("option", { name: "Low — Fast" }));
    await user.type(screen.getByLabelText("API key"), "AIza-test");
    await user.click(screen.getByRole("button", { name: "Save & verify" }));
    await screen.findByText("Gemini is connected.");

    const stored = await browser.storage.local.get(null);
    expect(stored.aiProviderSettings).toEqual({
      gemini: {
        apiKey: "AIza-test",
        model: "gemini-3.7-flash",
        effort: "low",
        verifiedAt: expect.any(Number),
      },
    });
  });

  it("offers no reasoning effort for a model that does not think", async () => {
    await browser.storage.local.set({
      aiProvider: "anthropic",
      aiProviderSettings: { anthropic: { apiKey: "", model: "claude-haiku-4-5" } },
    });
    renderPopup();

    await screen.findByRole("combobox", { name: "Model" });
    expect(screen.queryByRole("combobox", { name: "Reasoning effort" })).toBeNull();
  });

  describe("vLLM server", () => {
    beforeEach(async () => {
      // No saved server yet, so the popup opens on the vLLM settings.
      await browser.storage.local.set({ aiProvider: "vllm" });
    });

    it("asks Chrome for the server's origin, loads its models and saves the chosen one", async () => {
      const request = stubPermissions("request", Promise.resolve(true));
      answerBackground({
        listModels: { models: ["Qwen/Qwen3-8B", "sql-lora"] },
        verifyProvider: { message: "vLLM is connected." },
      });
      const user = userEvent.setup();
      renderPopup();

      await user.type(await screen.findByLabelText("Server URL"), "http://localhost:8000");
      await user.click(screen.getByRole("button", { name: "Load models" }));

      expect(request).toHaveBeenCalledWith({ origins: ["http://localhost:8000/*"] });
      await screen.findByText("2 models available.");
      expect(sendToBackground).toHaveBeenCalledWith("listModels", {
        provider: "vllm",
        apiKey: "",
        baseUrl: "http://localhost:8000/v1",
      });
      expect(screen.getByRole("combobox", { name: "Model" }).textContent).toContain(
        "Qwen/Qwen3-8B",
      );

      await user.click(screen.getByRole("button", { name: "Save & verify" }));
      await screen.findByText("vLLM is connected.");
      expect(sendToBackground).toHaveBeenLastCalledWith("verifyProvider", {
        provider: "vllm",
        apiKey: "",
        model: "Qwen/Qwen3-8B",
        baseUrl: "http://localhost:8000/v1",
      });
      const stored = await browser.storage.local.get(null);
      expect(stored.aiProvider).toBe("vllm");
      expect(stored.aiProviderSettings).toEqual({
        vllm: {
          apiKey: "",
          model: "Qwen/Qwen3-8B",
          baseUrl: "http://localhost:8000/v1",
          effort: "medium",
          verifiedAt: expect.any(Number),
        },
      });
    });

    it("lets a vLLM server answer without thinking", async () => {
      stubPermissions("request", Promise.resolve(true));
      answerBackground({
        listModels: { models: ["Qwen/Qwen3-8B"] },
        verifyProvider: { message: "vLLM is connected." },
      });
      const user = userEvent.setup();
      renderPopup();

      await user.type(await screen.findByLabelText("Server URL"), "http://localhost:8000");
      await user.click(screen.getByRole("button", { name: "Load models" }));
      await screen.findByText("1 model available.");
      await user.click(screen.getByRole("combobox", { name: "Reasoning effort" }));
      await user.click(await screen.findByRole("option", { name: "None — No thinking" }));
      await user.click(screen.getByRole("button", { name: "Save & verify" }));
      await screen.findByText("vLLM is connected.");

      const stored = await browser.storage.local.get(null);
      expect(stored.aiProviderSettings).toMatchObject({ vllm: { effort: "none" } });
    });

    it("loads nothing when Chrome is denied access to the server", async () => {
      stubPermissions("request", Promise.resolve(false));
      const user = userEvent.setup();
      renderPopup();

      await user.type(await screen.findByLabelText("Server URL"), "http://localhost:8000");
      await user.click(screen.getByRole("button", { name: "Load models" }));

      await screen.findByText("Allow access to localhost:8000 to use this server.");
      expect(sendToBackground).not.toHaveBeenCalled();
    });

    it("resumes the server setup when Chrome's access prompt closed the popup", async () => {
      // The prompt never answers the closed popup.
      const prompt = Promise.withResolvers<boolean>();
      stubPermissions("request", prompt.promise);
      const user = userEvent.setup();
      const closedPopup = renderPopup();
      await user.type(await screen.findByLabelText("Server URL"), "http://gpu.lan:8000/v1");
      await user.type(screen.getByLabelText("API key"), "token-abc");
      await user.click(screen.getByRole("button", { name: "Load models" }));
      closedPopup.unmount();

      stubPermissions("contains", Promise.resolve(true));
      answerBackground({ listModels: { models: ["Qwen/Qwen3-8B"] } });
      renderPopup();

      const serverUrl = (await screen.findByLabelText("Server URL")) as HTMLInputElement;
      expect(serverUrl.value).toBe("http://gpu.lan:8000/v1");
      expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("token-abc");
      await screen.findByText("1 model available.");
      expect(sendToBackground).toHaveBeenCalledWith("listModels", {
        provider: "vllm",
        apiKey: "token-abc",
        baseUrl: "http://gpu.lan:8000/v1",
      });
      expect(await browser.storage.session.get(null)).toEqual({});
    });

    it("reopens on the unfinished server setup even while another provider is active", async () => {
      await browser.storage.local.set({
        aiProvider: "gemini",
        aiProviderSettings: {
          gemini: { apiKey: "AIza", model: "gemini-3.7-flash", verifiedAt: 1 },
        },
      });
      await serverDraftItem.setValue({
        provider: "vllm",
        baseUrl: "http://gpu.lan:8000/v1",
        apiKey: "",
        model: "",
        effort: "none",
      });
      stubPermissions("contains", Promise.resolve(false));
      renderPopup();

      const provider = await screen.findByRole("combobox", { name: "Provider" });
      expect(provider.textContent).toContain("vLLM");
      expect((screen.getByLabelText("Server URL") as HTMLInputElement).value).toBe(
        "http://gpu.lan:8000/v1",
      );
      expect(screen.getByRole("combobox", { name: "Reasoning effort" }).textContent).toContain(
        "None",
      );
      expect(sendToBackground).not.toHaveBeenCalled();
    });

    it("counts a saved server without a key as a configured provider", async () => {
      vi.spyOn(browser.runtime, "getManifest").mockReturnValue({
        manifest_version: 3,
        name: "Coursera Auto Solver",
        version: "2.0.0",
      });
      await browser.storage.local.set({
        aiProviderSettings: {
          vllm: {
            apiKey: "",
            model: "Qwen/Qwen3-8B",
            baseUrl: "http://localhost:8000/v1",
            verifiedAt: 1,
          },
        },
      });
      renderPopup();

      await screen.findByRole("heading", { name: "Auto Solver" });
      expect(screen.getByText(/Qwen\/Qwen3-8B/)).toBeTruthy();
    });
  });
});
