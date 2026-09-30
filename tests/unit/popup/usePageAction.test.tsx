import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { BusyProvider, useBusy } from "@/popup/hooks/busy";
import { usePageAction } from "@/popup/hooks/usePageAction";

function wrapper({ children }: { children: ReactNode }) {
  return <BusyProvider>{children}</BusyProvider>;
}

describe("usePageAction", () => {
  // Guards the busy-lock leak found in review: a synchronous throw skipped `.finally(release)`.
  it("reports a synchronous throw as an error and releases the busy lock", async () => {
    const { result } = renderHook(
      () => ({
        action: usePageAction(
          "requirements",
          () => {
            throw new Error("Refresh the Coursera page, then try again.");
          },
          { auto: true },
        ),
        busy: useBusy(),
      }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.action.status).toBe("error"));
    expect(result.current.action.error).toBe("Refresh the Coursera page, then try again.");
    expect(result.current.busy.busy).toBeNull();
    expect(result.current.busy.acquire("solve")).toBe(true);
  });
});
