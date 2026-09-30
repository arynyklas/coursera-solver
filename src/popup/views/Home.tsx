import {
  CircleCheck,
  Copy,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { ActionRow } from "@/popup/components/ActionRow";
import { ContextRow } from "@/popup/components/ContextRow";
import { Footer } from "@/popup/components/Footer";
import { OffCourseNote } from "@/popup/components/Note";
import { PopupHeader } from "@/popup/components/PopupHeader";
import { ViewBody } from "@/popup/components/ViewBody";
import type { PageContext } from "@/popup/hooks/usePageContext";
import { activeModelLabel, type ProviderConfigState } from "@/popup/hooks/useProviderConfig";
import type { ActionView, Navigate } from "@/popup/navigation";

interface Row {
  view: ActionView;
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: "brand";
}

const SECTIONS: { label: string; rows: Row[] }[] = [
  {
    label: "On this page",
    rows: [
      {
        view: "solve",
        icon: Sparkles,
        title: "Solve current quiz",
        description: "Fill answers with AI · never submits",
        tone: "brand",
      },
      {
        view: "dialogue",
        icon: MessageSquare,
        title: "Fill dialogue answer",
        description: "Draft a Coach reply",
      },
      { view: "dryRun", icon: ScanSearch, title: "Dry run", description: "Read-only parser check" },
      {
        view: "copyQuestions",
        icon: Copy,
        title: "Copy questions",
        description: "Questions as JSON",
      },
    ],
  },
  {
    label: "Course",
    rows: [
      {
        view: "requirements",
        icon: ListChecks,
        title: "Course requirements",
        description: "Graded work, weights, links",
      },
      {
        view: "complete",
        icon: CircleCheck,
        title: "Complete materials",
        description: "Mark videos, readings & plugins done",
      },
    ],
  },
];

export function Home({
  context,
  config,
  onNavigate,
}: {
  context: PageContext;
  config: ProviderConfigState;
  onNavigate: Navigate;
}) {
  return (
    <>
      <PopupHeader onOpenSettings={() => onNavigate("settings")} />
      <ViewBody>
        <ContextRow context={context} providerLabel={activeModelLabel(config)} />
        {context.isCourse ? null : <OffCourseNote />}
        {SECTIONS.map((section) => (
          <section key={section.label} className="flex flex-col gap-2">
            <h2 className="text-[10.5px] font-semibold tracking-[.07em] text-muted-foreground uppercase">
              {section.label}
            </h2>
            <div className="overflow-hidden rounded-lg border">
              {section.rows.map((row) => (
                <ActionRow
                  key={row.view}
                  icon={row.icon}
                  title={row.title}
                  description={row.description}
                  tone={row.tone}
                  disabled={!context.isCourse}
                  onOpen={() => onNavigate(row.view)}
                />
              ))}
            </div>
          </section>
        ))}
      </ViewBody>
      <Footer />
    </>
  );
}
