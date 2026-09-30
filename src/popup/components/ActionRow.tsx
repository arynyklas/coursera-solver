import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function ActionRow({
  icon: Icon,
  title,
  description,
  disabled,
  onOpen,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  disabled: boolean;
  onOpen: () => void;
  /** "brand" colors the icon with the accent text color (the Solve row). */
  tone?: "brand";
}) {
  return (
    <button
      type="button"
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onOpen}
      className={cn(
        "flex w-full items-center gap-[11px] border-t px-2.5 py-[7px] text-left outline-none first:border-t-0 focus-visible:bg-muted",
        disabled ? "cursor-not-allowed opacity-45" : "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "grid size-[26px] shrink-0 place-items-center rounded-sm",
          tone === "brand" ? "text-brand-text" : "text-[#525252] dark:text-[#a3a3a3]",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block font-mono text-[11px] text-muted-foreground">{description}</span>
      </span>
      {disabled ? null : <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
    </button>
  );
}
