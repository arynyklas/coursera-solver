import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Note, OffCourseNote } from "@/popup/components/Note";
import { SpinningLoader } from "@/popup/components/SpinningLoader";
import { useBusy } from "@/popup/hooks/busy";
import type { PageAction } from "@/popup/hooks/usePageAction";

/**
 * The shared states of the read-only views: off course, loading, and an error with "Try again".
 * `children` renders the finished result.
 */
export function ReadOnlyResult<T>({
  isCourse,
  action,
  loadingText,
  children,
}: {
  isCourse: boolean;
  action: PageAction<T>;
  loadingText: string;
  children: (data: T) => ReactNode;
}) {
  const { busy } = useBusy();
  if (!isCourse) return <OffCourseNote />;
  if (action.status === "error") {
    return (
      <>
        <Note tone="error">{action.error}</Note>
        <Button
          variant="outline"
          className="h-8 w-fit rounded-sm px-3 text-[13px]"
          onClick={action.start}
          disabled={busy !== null}
        >
          Try again
        </Button>
      </>
    );
  }
  // Before the first run finishes (or while another view holds the lock) the view is loading.
  if (action.status !== "done" || action.data === null) {
    return (
      <Note tone="muted" icon={SpinningLoader}>
        {loadingText}
      </Note>
    );
  }
  return children(action.data);
}
