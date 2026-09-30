import { cn } from "@/lib/utils";
import type { PageContext } from "@/popup/hooks/usePageContext";

/**
 * `providerLabel` is the active model's label, or `null` when the active provider has no saved
 * key; then the row reads "No AI provider" and the dot stays amber.
 */
export function ContextRow({
  context,
  providerLabel,
}: {
  context: PageContext;
  providerLabel: string | null;
}) {
  const ready = providerLabel !== null && context.isCourse;
  return (
    <div className="flex items-center gap-2.5 rounded-md bg-muted px-[11px] py-[9px] text-[12.5px]">
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          ready
            ? "bg-[#22c55e] shadow-[0_0_0_3px_rgba(34,197,94,.18)]"
            : "bg-[#f59e0b] shadow-[0_0_0_3px_rgba(245,158,11,.2)]",
        )}
      />
      <p className="min-w-0 truncate font-mono">
        {providerLabel ?? "No AI provider"}
        {context.isCourse ? (
          <>
            {" · "}
            <b className="font-semibold">{context.courseSlug}</b>
            {` · ${context.itemKind}`}
          </>
        ) : (
          " · not a course page"
        )}
      </p>
    </div>
  );
}
