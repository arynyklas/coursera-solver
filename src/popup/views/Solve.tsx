import { Play } from "lucide-react";
import { PROVIDERS } from "@/ai/providers";
import { ContextRow } from "@/popup/components/ContextRow";
import { OffCourseNote } from "@/popup/components/Note";
import { ActionOutcome, ProviderGateNote, RunButton } from "@/popup/components/RunAction";
import { TEXT_CLASS, ViewBody } from "@/popup/components/ViewBody";
import { ViewHeader } from "@/popup/components/ViewHeader";
import { useBusy } from "@/popup/hooks/busy";
import { usePageAction } from "@/popup/hooks/usePageAction";
import { type PageContext, requireTabId } from "@/popup/hooks/usePageContext";
import { activeModelLabel, type ProviderConfigState } from "@/popup/hooks/useProviderConfig";
import type { Navigate } from "@/popup/navigation";
import { sendToTab } from "@/shared/messaging";

export function Solve({
  context,
  config,
  onNavigate,
}: {
  context: PageContext;
  config: ProviderConfigState;
  onNavigate: Navigate;
}) {
  const { busy } = useBusy();
  const action = usePageAction("solve", () => sendToTab(requireTabId(context), "solveQuiz", {}));
  const label = PROVIDERS[config.activeProvider].label;

  return (
    <>
      <ViewHeader title="Solve current quiz" onBack={() => onNavigate("home")} />
      <ViewBody>
        <ContextRow context={context} providerLabel={activeModelLabel(config)} />
        {context.isCourse ? null : <OffCourseNote />}
        <p className={TEXT_CLASS}>
          Reads every question on this page, asks {label} for answers and fills them in. It never
          submits: review the answers, then submit yourself.
        </p>
        {config.activeReady ? null : (
          <ProviderGateNote onOpenSettings={() => onNavigate("settings")} />
        )}
        <RunButton
          icon={Play}
          label="Solve quiz"
          loadingLabel="Starting…"
          action={action}
          disabled={!context.isCourse || !config.activeReady || busy !== null}
          large
        />
        <ActionOutcome
          action={action}
          success="Started. Progress is shown on the Coursera page; you can close this popup."
        />
      </ViewBody>
    </>
  );
}
