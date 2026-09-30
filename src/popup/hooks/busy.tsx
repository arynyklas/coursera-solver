import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ActionView } from "@/popup/navigation";

interface Busy {
  busy: ActionView | null;
  acquire(view: ActionView): boolean;
  release(view: ActionView): void;
}

const BusyContext = createContext<Busy | null>(null);

/** One action at a time (F9): the lock lives above the views so it survives navigation. */
export function BusyProvider({ children }: { children: ReactNode }) {
  const [busy, setBusy] = useState<ActionView | null>(null);
  // The ref makes acquire synchronous: two clicks in one frame cannot both see a free lock.
  const owner = useRef<ActionView | null>(null);

  const acquire = useCallback((view: ActionView) => {
    if (owner.current !== null) return false;
    owner.current = view;
    setBusy(view);
    return true;
  }, []);

  const release = useCallback((view: ActionView) => {
    if (owner.current !== view) return;
    owner.current = null;
    setBusy(null);
  }, []);

  const value = useMemo(() => ({ busy, acquire, release }), [busy, acquire, release]);
  return <BusyContext value={value}>{children}</BusyContext>;
}

export function useBusy(): Busy {
  const value = useContext(BusyContext);
  if (!value) throw new Error("useBusy must be used inside BusyProvider.");
  return value;
}
