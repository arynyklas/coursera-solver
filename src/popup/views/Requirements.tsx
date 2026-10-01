import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";
import { cn } from "@/lib/utils";
import { Note } from "@/popup/components/Note";
import { ReadOnlyResult } from "@/popup/components/ReadOnlyResult";
import { ToneBadge } from "@/popup/components/ToneBadge";
import { HINT_CLASS, ViewBody } from "@/popup/components/ViewBody";
import { ViewHeader } from "@/popup/components/ViewHeader";
import { usePageAction } from "@/popup/hooks/usePageAction";
import { type PageContext, requireTabId } from "@/popup/hooks/usePageContext";
import {
  formatRequirementTime,
  formatWeightPercent,
  plural,
  safeCourseRequirementUrl,
} from "@/popup/lib/format";
import type { Navigate } from "@/popup/navigation";
import { sendToTab } from "@/shared/messaging";
import type { CourseRequirementsResult, Requirement, RequirementStatus } from "@/shared/types";

const OPEN_FAILED = "Coursera could not open that activity. Refresh the page and try again.";

const STATUS: Record<RequirementStatus, { icon: LucideIcon; label: string; className: string }> = {
  completed: { icon: CircleCheck, label: "Completed", className: "text-success" },
  started: { icon: CircleDashed, label: "In progress", className: "text-muted-foreground" },
  notStarted: { icon: Circle, label: "Not started", className: "text-muted-foreground" },
};

export function Requirements({
  context,
  onNavigate,
}: {
  context: PageContext;
  onNavigate: Navigate;
}) {
  const action = usePageAction(
    "requirements",
    () => sendToTab(requireTabId(context), "getCourseRequirements", {}),
    { auto: context.isCourse },
  );
  const [openFailed, setOpenFailed] = useState(false);

  async function open(url: string) {
    setOpenFailed(false);
    try {
      await browser.tabs.update(requireTabId(context), { url });
    } catch {
      setOpenFailed(true);
    }
  }

  return (
    <>
      <ViewHeader title="Course requirements" onBack={() => onNavigate("home")} />
      <ViewBody>
        <ReadOnlyResult
          isCourse={context.isCourse}
          action={action}
          loadingText="Finding course requirements…"
        >
          {(result) =>
            result.requirements.length === 0 ? (
              <Note tone="muted">
                No grade-relevant activities were identified for this course.
              </Note>
            ) : (
              <RequirementList result={result} openFailed={openFailed} onOpen={open} />
            )
          }
        </ReadOnlyResult>
      </ViewBody>
    </>
  );
}

function RequirementList({
  result: { requirements, summary },
  openFailed,
  onOpen,
}: {
  result: CourseRequirementsResult;
  openFailed: boolean;
  onOpen: (url: string) => void;
}) {
  const groups = new Map<string, Requirement[]>();
  for (const requirement of requirements) {
    const moduleName = requirement.moduleName || "Other course work";
    const group = groups.get(moduleName);
    if (group) group.push(requirement);
    else groups.set(moduleName, [requirement]);
  }

  const progressNote =
    summary.completedCount === null
      ? "Your Coursera progress could not be read, so completion is not shown. Refresh the Coursera page to try again."
      : "Completion follows your Coursera progress. Grades are not included.";

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="mr-1 text-[13px] font-semibold">
          {plural(requirements.length, "graded activity", "graded activities")}
        </h2>
        {summary.completedCount === null ? null : (
          <ToneBadge
            tone={summary.completedCount === requirements.length ? "success" : "outline"}
          >{`${summary.completedCount} of ${requirements.length} completed`}</ToneBadge>
        )}
        {summary.confirmed ? (
          <ToneBadge tone="success">Confirmed</ToneBadge>
        ) : (
          <ToneBadge tone="outline">Detected</ToneBadge>
        )}
        <ToneBadge tone="outline">{summary.requiredCount} required</ToneBadge>
        {summary.lockedCount > 0 ? (
          <ToneBadge tone="warning">{summary.lockedCount} locked</ToneBadge>
        ) : null}
      </div>
      <Note tone="muted">
        {summary.unresolvedCount || summary.unmappedCount
          ? `Some course requirements could not be fully linked. ${progressNote}`
          : progressNote}
      </Note>
      {openFailed ? <Note tone="error">{OPEN_FAILED}</Note> : null}
      <div className="shrink-0 overflow-hidden rounded-lg border">
        {[...groups].map(([moduleName, moduleRequirements]) => (
          <section key={moduleName} className="border-t first:border-t-0">
            <h3 className="bg-muted px-2.5 pt-[7px] pb-[5px] text-[10.5px] font-semibold tracking-[.07em] text-muted-foreground uppercase">
              {moduleName}
            </h3>
            {moduleRequirements.map((requirement) => (
              <RequirementRow key={requirement.id} requirement={requirement} onOpen={onOpen} />
            ))}
          </section>
        ))}
      </div>
      <p className={HINT_CLASS}>Click an activity to open it in this tab.</p>
    </>
  );
}

function RequirementRow({
  requirement,
  onOpen,
}: {
  requirement: Requirement;
  onOpen: (url: string) => void;
}) {
  const link = safeCourseRequirementUrl(requirement.link);
  const meta = [requirement.lessonName, formatRequirementTime(requirement.timeCommitment)]
    .filter(Boolean)
    .join(" · ");
  const weight = formatWeightPercent(requirement.weightPercent);
  const passCount = requirement.groupRequirement?.requiredPassedCount ?? 0;
  const status = requirement.status ? STATUS[requirement.status] : null;
  // A completed activity reads as completed even when it is locked now.
  const showLock = requirement.locked && requirement.status !== "completed";
  const StatusIcon = showLock ? Lock : status?.icon;

  return (
    <button
      type="button"
      disabled={!link}
      onClick={link ? () => onOpen(link) : undefined}
      title={requirement.locked ? requirement.lockReason || undefined : undefined}
      className={cn(
        "flex w-full items-center gap-2 border-t px-2.5 py-[7px] text-left outline-none",
        link ? "hover:bg-muted focus-visible:bg-muted" : "cursor-not-allowed",
        requirement.locked && "opacity-60",
      )}
    >
      {StatusIcon ? (
        <StatusIcon
          className={cn("size-4 shrink-0", showLock ? "text-muted-foreground" : status?.className)}
          aria-hidden
        />
      ) : null}
      {status ? <span className="sr-only">{status.label}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium">
          {requirement.name || "Graded activity"}
        </span>
        {meta ? (
          <span className="block font-mono text-[11px] text-muted-foreground">{meta}</span>
        ) : null}
      </span>
      <span className="flex max-w-[55%] flex-wrap justify-end gap-1">
        {requirement.requiredForPassing ? <ToneBadge tone="accent">Required</ToneBadge> : null}
        {passCount ? (
          <ToneBadge tone="outline">Pass {plural(passCount, "choice", "choices")}</ToneBadge>
        ) : null}
        {weight ? <ToneBadge tone="outline">{weight}%</ToneBadge> : null}
        {requirement.source === "detected" ? <ToneBadge tone="outline">Detected</ToneBadge> : null}
        {link ? null : <ToneBadge tone="outline">Link unavailable</ToneBadge>}
      </span>
      {link ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
    </button>
  );
}
