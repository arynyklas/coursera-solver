import { Settings, Sparkles } from "lucide-react";
import { browser } from "wxt/browser";
import { Button } from "@/components/ui/button";

export const HEADER_CLASS = "flex shrink-0 items-center gap-2.5 border-b px-3.5 py-3";
export const TITLE_CLASS = "text-sm leading-tight font-semibold tracking-[-0.01em]";

export function PopupHeader({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className={HEADER_CLASS}>
      <div className="grid size-[30px] place-items-center rounded-[5px] bg-primary text-primary-foreground">
        <Sparkles className="size-4" aria-hidden />
      </div>
      <div>
        <h1 className={TITLE_CLASS}>Auto Solver</h1>
        <p className="font-mono text-[11.5px] leading-tight text-muted-foreground">
          v{browser.runtime.getManifest().version}
        </p>
      </div>
      <div className="flex-1" />
      <Button
        variant="outline"
        size="icon"
        className="rounded-sm"
        aria-label="AI provider settings"
        title="AI provider settings"
        onClick={onOpenSettings}
      >
        <Settings aria-hidden />
      </Button>
    </header>
  );
}
