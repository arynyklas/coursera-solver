import { cn } from "@/lib/utils";

/** Pretty JSON in a scrolling mono block. */
export function JsonBlock({ text, className }: { text: string; className?: string }) {
  return (
    <pre
      className={cn(
        "max-h-[160px] shrink-0 overflow-auto rounded-md border bg-muted px-2.5 py-2 font-mono text-[11px] leading-normal",
        className,
      )}
    >
      {text}
    </pre>
  );
}
