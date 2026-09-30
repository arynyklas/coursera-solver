import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Note } from "@/popup/components/Note";
import { SpinningLoader } from "@/popup/components/SpinningLoader";
import type { PageAction } from "@/popup/hooks/usePageAction";

/** The primary run button of Solve, Dialogue and Complete. */
export function RunButton({
  icon: Icon,
  label,
  loadingLabel,
  action,
  disabled,
  large,
}: {
  icon: LucideIcon;
  label: string;
  loadingLabel: string;
  action: PageAction<unknown>;
  disabled: boolean;
  large?: boolean;
}) {
  const running = action.status === "running";
  return (
    <Button
      className={cn("w-full gap-2 rounded-sm", large ? "h-10 text-[13.5px]" : "h-9 text-[13px]")}
      onClick={action.start}
      disabled={disabled || running}
    >
      {running ? <SpinningLoader aria-hidden /> : <Icon aria-hidden />}
      {running ? loadingLabel : label}
    </Button>
  );
}

/** The success or error note under a run button; errors are shown verbatim (F9). */
export function ActionOutcome({
  action,
  success,
}: {
  action: PageAction<unknown>;
  success: string;
}) {
  return (
    // display: contents keeps the always-present live region out of the flex gap.
    <div aria-live="polite" className="contents">
      {action.status === "done" ? <Note tone="success">{success}</Note> : null}
      {action.status === "error" ? <Note tone="error">{action.error}</Note> : null}
    </div>
  );
}

/** Solve and Dialogue need a saved key before they can run. */
export function ProviderGateNote({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <Note tone="warning">
      <span className="flex items-center justify-between gap-2">
        Configure an AI provider first.
        <Button
          variant="outline"
          size="xs"
          className="-my-0.5 rounded-sm text-foreground"
          onClick={onOpenSettings}
        >
          Open settings
        </Button>
      </span>
    </Note>
  );
}
