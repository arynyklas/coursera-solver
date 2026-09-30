import type { ReactNode } from "react";

/** A view's explanatory paragraph. */
export const TEXT_CLASS = "text-[12.5px] text-muted-foreground";
/** Small print under a form or an action. */
export const HINT_CLASS = "text-[11.5px] text-muted-foreground";

/** The scrolling middle of every view; the header and footer around it stay fixed. */
export function ViewBody({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3.5">{children}</main>
  );
}
