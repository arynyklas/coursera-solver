import { Check, CircleAlert, TriangleAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "error" | "muted";
/** A lucide icon, or a wrapper such as a spinning loader. */
export type NoteIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  error: "bg-destructive-soft text-destructive",
  muted: "bg-muted text-foreground",
};

const TONE_ICON: Record<Tone, NoteIcon | null> = {
  success: Check,
  warning: TriangleAlert,
  error: CircleAlert,
  muted: null,
};

export function Note({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  /** Overrides the tone's default icon. */
  icon?: NoteIcon;
  children: ReactNode;
}) {
  const Icon = icon ?? TONE_ICON[tone];
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2.5 py-2 text-[12.5px]",
        TONE_CLASS[tone],
      )}
    >
      {Icon ? <Icon className="mt-px size-4 shrink-0" aria-hidden /> : null}
      <span className="min-w-0">{children}</span>
    </div>
  );
}
