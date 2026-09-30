import { MessageSquare } from "lucide-react";
import { OffCourseNote } from "@/popup/components/Note";
import { ActionOutcome, ProviderGateNote, RunButton } from "@/popup/components/RunAction";
import { TEXT_CLASS, ViewBody } from "@/popup/components/ViewBody";
import { ViewHeader } from "@/popup/components/ViewHeader";
import { useBusy } from "@/popup/hooks/busy";
import { usePageAction } from "@/popup/hooks/usePageAction";
import { type PageContext, requireTabId } from "@/popup/hooks/usePageContext";
import type { ProviderConfigState } from "@/popup/hooks/useProviderConfig";
import type { Navigate } from "@/popup/navigation";
import { sendToTab } from "@/shared/messaging";

export function Dialogue({
  context,
  config,
  onNavigate,
}: {
  context: PageContext;
  config: ProviderConfigState;
  onNavigate: Navigate;
}) {
  const { busy } = useBusy();
  const action = usePageAction("dialogue", async () => {
    const reply = await sendToTab(requireTabId(context), "fillDialogue", {});
    // Legacy popup.js:327.
    if (reply?.status !== "filled") throw new Error("The dialogue answer could not be filled.");
    return reply;
  });

  return (
    <>
      <ViewHeader title="Fill dialogue answer" onBack={() => onNavigate("home")} />
      <ViewBody>
        {context.isCourse ? null : <OffCourseNote />}
        <p className={TEXT_CLASS}>
          Drafts a reply to the current Coursera Coach question and puts it in the message box. It
          does not send.
        </p>
        {config.activeReady ? null : (
          <ProviderGateNote onOpenSettings={() => onNavigate("settings")} />
        )}
        <RunButton
          icon={MessageSquare}
          label="Draft reply"
          loadingLabel="Writing answer…"
          action={action}
          disabled={!context.isCourse || !config.activeReady || busy !== null}
        />
        <ActionOutcome
          action={action}
          success="Answer added to Coursera. Review it, then click Send."
        />
      </ViewBody>
    </>
  );
}
