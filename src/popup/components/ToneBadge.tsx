import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "accent" | "outline";

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  accent: "bg-brand-soft text-brand-text",
  outline: "border-border bg-transparent text-muted-foreground",
};

export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn("text-[11px] font-semibold", TONE_CLASS[tone])}>
      {children}
    </Badge>
  );
}
