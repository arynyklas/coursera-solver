import type { ReactNode } from "react";

/** The scrolling middle of every view; the header and footer around it stay fixed. */
export function ViewBody({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">{children}</main>
  );
}
