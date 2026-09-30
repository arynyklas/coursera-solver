import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Banner } from "@/content/banner/Banner";
import { type BannerStore, createBannerStore, type Scheduler } from "@/content/banner/store";

function createManualScheduler() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const scheduler: Scheduler = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id as number);
    },
  };
  function flush(ms: number) {
    const target = now + ms;
    for (;;) {
      let due: [number, { at: number; fn: () => void }] | undefined;
      for (const entry of pending) {
        if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
      }
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      act(() => due[1].fn());
    }
    now = target;
  }
  return { scheduler, flush };
}

function setup() {
  const { scheduler, flush } = createManualScheduler();
  const store = createBannerStore(scheduler);
  render(<Banner store={store} />);
  const show = (content: Parameters<BannerStore["show"]>[0]) => act(() => store.show(content));
  const hide = () => act(() => store.hide());
  return { store, show, hide, flush };
}

afterEach(cleanup);

describe("banner", () => {
  it("renders dynamic text literally instead of interpreting HTML", () => {
    const { show } = setup();
    const payload = '<img src=x onerror="alert(1)">';

    show({ tone: "success", title: payload });

    const card = screen.getByRole("status");
    expect(card.textContent).toContain(payload);
    expect(card.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector("img")).toBeNull();
  });

  it("show cancels a pending hide so a refreshed banner is not removed", () => {
    const { show, hide, flush } = setup();

    show({ tone: "info", title: "Old" });
    hide();
    show({ tone: "success", title: "New" });
    flush(300);

    expect(screen.getByRole("status").textContent).toContain("New");
  });

  // F10: guards content.js:323 in v1.1.0 (c2f8b71), where an error banner was hidden after 5500 ms.
  it("keeps an error visible even when an auto-hide delay is given", () => {
    const { show, flush } = setup();

    show({ tone: "error", title: "Applied 4 of 5 answers", autoHideMs: 10 });
    flush(10_000);

    expect(screen.getByRole("status").textContent).toContain("Applied 4 of 5 answers");
  });

  it("auto-hides a success after its delay plus the fade", () => {
    const { show, flush } = setup();

    show({ tone: "success", title: "Quiz solved", autoHideMs: 4000 });
    flush(3999);
    expect(screen.queryByRole("status")).not.toBeNull();
    flush(1 + 300);

    expect(screen.queryByRole("status")).toBeNull();
  });

  // F10: guards presentation.js:98 in v1.1.0 (c2f8b71): createBannerPresenter had no close control.
  it("removes the banner after the fade when Dismiss is clicked", async () => {
    const { show, flush } = setup();
    const user = userEvent.setup();

    show({ tone: "error", title: "Something failed" });
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("status").getAttribute("data-leaving")).toBe("true");
    flush(300);

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces errors assertively", () => {
    const { show } = setup();

    show({ tone: "error", title: "Failed" });

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("assertive");
  });

  it("renders progress as a percentage width", () => {
    const { show } = setup();

    show({ tone: "info", title: "Completing materials", progress: 0.43 });

    const fill = document.querySelector<HTMLElement>(".csb-fill");
    expect(fill?.style.width).toBe("43%");
  });

  it("renders the description with a monospace detail", () => {
    const { show } = setup();

    show({
      tone: "info",
      title: "Completing materials",
      description: "Items 13–18 of 42",
      detail: "2 failed",
    });

    expect(screen.getByRole("status").textContent).toContain("Items 13–18 of 42 · 2 failed");
    expect(screen.getByText("2 failed").className).toBe("csb-mono");
  });
});
