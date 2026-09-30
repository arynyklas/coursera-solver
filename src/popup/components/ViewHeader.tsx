import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { HEADER_CLASS, TITLE_CLASS } from "./PopupHeader";

export function ViewHeader({
  title,
  onBack,
  right,
  backDisabled,
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  backDisabled?: boolean;
}) {
  return (
    <header className={HEADER_CLASS}>
      <Button
        variant="outline"
        size="icon"
        className="rounded-sm"
        aria-label="Back"
        title="Back"
        onClick={onBack}
        disabled={backDisabled}
      >
        <ArrowLeft aria-hidden />
      </Button>
      <h1 className={TITLE_CLASS}>{title}</h1>
      <div className="flex-1" />
      {right}
    </header>
  );
}
