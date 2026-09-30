import { Check, CircleAlert, GraduationCap, TriangleAlert } from "lucide-react";
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
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** Shown instead of page actions when the active tab is not a course page (F9). */
export function OffCourseNote() {
  return (
    <Note tone="muted" icon={GraduationCap}>
      Open a course on coursera.org/learn/… to use these actions.
    </Note>
  );
}
