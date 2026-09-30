import { Check, CircleAlert, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const FEEDBACK_MS = 1500;

/** Header button that copies `text`, then reads "Copied" or "Copy failed" for 1500 ms. */
export function CopyButton({
  label,
  text,
  disabled,
}: {
  label: string;
  text: string;
  disabled: boolean;
}) {
  const [feedback, setFeedback] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    let result: "copied" | "failed";
    try {
      await navigator.clipboard.writeText(text);
      result = "copied";
    } catch {
      result = "failed";
    }
    if (!mounted.current) return;
    setFeedback(result);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFeedback(null), FEEDBACK_MS);
  }

  const Icon = feedback === "copied" ? Check : feedback === "failed" ? CircleAlert : Copy;
  return (
    <Button
      variant={
        feedback === "copied" ? "default" : feedback === "failed" ? "destructive" : "outline"
      }
      className="h-[30px] gap-2 rounded-sm px-3 text-[13px]"
      onClick={copy}
      disabled={disabled}
    >
      <Icon aria-hidden />
      {feedback === "copied" ? "Copied" : feedback === "failed" ? "Copy failed" : label}
    </Button>
  );
}
