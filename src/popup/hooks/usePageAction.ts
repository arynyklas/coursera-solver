import { useCallback, useEffect, useRef, useState } from "react";
import { useBusy } from "@/popup/hooks/busy";
import type { ActionView } from "@/popup/navigation";
import { errorMessage, REFRESH_PAGE_MESSAGE } from "@/shared/messaging";

export interface PageAction<T> {
  status: "idle" | "running" | "done" | "error";
  data: T | null;
  error: string;
  start(): void;
}

type State<T> = Omit<PageAction<T>, "start">;

/**
 * Runs one page action under the popup-wide busy lock (F9) and keeps its own result and error.
 * With `auto`, it starts once on mount, or as soon as another view releases the lock.
 */
export function usePageAction<T>(
  view: ActionView,
  run: () => Promise<T>,
  options: { auto?: boolean } = {},
): PageAction<T> {
  const auto = options.auto ?? false;
  const { busy, acquire, release } = useBusy();
  const [state, setState] = useState<State<T>>({ status: "idle", data: null, error: "" });
  const latestRun = useRef(run);
  const mounted = useRef(false);
  const autoStarted = useRef(false);

  useEffect(() => {
    latestRun.current = run;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const tryStart = useCallback((): boolean => {
    if (!acquire(view)) return false;
    setState({ status: "running", data: null, error: "" });
    // The lock is released even if the view has closed meanwhile; only the state update is skipped.
    // Starting from a resolved promise turns a synchronous throw in `run` into a rejection.
    Promise.resolve()
      .then(() => latestRun.current())
      .then(
        (data) => {
          if (mounted.current) setState({ status: "done", data, error: "" });
        },
        (error: unknown) => {
          if (mounted.current) {
            setState({
              status: "error",
              data: null,
              error: errorMessage(error, REFRESH_PAGE_MESSAGE),
            });
          }
        },
      )
      .finally(() => release(view));
    return true;
  }, [acquire, release, view]);

  useEffect(() => {
    // The ref survives StrictMode's simulated remount, so the automatic run happens once.
    if (!auto || autoStarted.current || busy !== null) return;
    autoStarted.current = tryStart();
  }, [auto, busy, tryStart]);

  const start = useCallback(() => {
    tryStart();
  }, [tryStart]);

  return { ...state, start };
}
