import { CircleCheck } from "lucide-react";
import { ContextRow } from "@/popup/components/ContextRow";
import { Note, OffCourseNote } from "@/popup/components/Note";
import { ActionOutcome, RunButton } from "@/popup/components/RunAction";
import { HINT_CLASS, TEXT_CLASS, ViewBody } from "@/popup/components/ViewBody";
import { ViewHeader } from "@/popup/components/ViewHeader";
import { useBusy } from "@/popup/hooks/busy";
import { usePageAction } from "@/popup/hooks/usePageAction";
import { type PageContext, requireTabId } from "@/popup/hooks/usePageContext";
import { activeModelLabel, type ProviderConfigState } from "@/popup/hooks/useProviderConfig";
import type { Navigate } from "@/popup/navigation";
import { sendToTab } from "@/shared/messaging";

export function Complete({
  context,
  config,
  onNavigate,
}: {
  context: PageContext;
  config: ProviderConfigState;
  onNavigate: Navigate;
}) {
  const { busy } = useBusy();
  const action = usePageAction("complete", () =>
    sendToTab(requireTabId(context), "completeMaterials", {}),
  );

  return (
    <>
      <ViewHeader title="Complete materials" onBack={() => onNavigate("home")} />
      <ViewBody>
        <ContextRow context={context} providerLabel={activeModelLabel(config)} />
        {context.isCourse ? null : <OffCourseNote />}
        <p className={TEXT_CLASS}>
          Marks every video and reading in this course as completed on Coursera. Quizzes, exams and
          other graded work are skipped.
        </p>
        <Note tone="warning">This changes your course progress on Coursera.</Note>
        <RunButton
          icon={CircleCheck}
          label="Complete videos & readings"
          loadingLabel="Working…"
          action={action}
          disabled={!context.isCourse || busy !== null}
          large
        />
        <ActionOutcome
          action={action}
          success="Course completion started. Progress is shown on the Coursera page."
        />
        <span className={HINT_CLASS}>
          Progress appears on the Coursera page. Locked items are skipped.
        </span>
      </ViewBody>
    </>
  );
}
