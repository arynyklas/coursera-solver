import { CopyButton } from "@/popup/components/CopyButton";
import { JsonBlock } from "@/popup/components/JsonBlock";
import { Note } from "@/popup/components/Note";
import { ReadOnlyResult } from "@/popup/components/ReadOnlyResult";
import { ViewBody } from "@/popup/components/ViewBody";
import { ViewHeader } from "@/popup/components/ViewHeader";
import { usePageAction } from "@/popup/hooks/usePageAction";
import { type PageContext, requireTabId } from "@/popup/hooks/usePageContext";
import { plural } from "@/popup/lib/format";
import type { Navigate } from "@/popup/navigation";
import { sendToTab } from "@/shared/messaging";

export function CopyQuestions({
  context,
  onNavigate,
}: {
  context: PageContext;
  onNavigate: Navigate;
}) {
  // F9: read errors reach the view verbatim instead of turning into the empty-page message.
  const action = usePageAction(
    "copyQuestions",
    async () => {
      const { questions } = await sendToTab(requireTabId(context), "getQuestions", {});
      const list = Array.isArray(questions) ? questions : [];
      return { count: list.length, json: JSON.stringify(list, null, 2) };
    },
    { auto: context.isCourse },
  );
  return (
    <>
      <ViewHeader
        title="Copy questions"
        onBack={() => onNavigate("home")}
        right={
          <CopyButton label="Copy" text={action.data?.json ?? ""} disabled={!action.data?.count} />
        }
      />
      <ViewBody>
        <ReadOnlyResult
          isCourse={context.isCourse}
          action={action}
          loadingText="Extracting questions…"
        >
          {({ count, json }) =>
            count === 0 ? (
              <Note tone="muted">No questions were found on this page.</Note>
            ) : (
              <>
                <h2 className="text-[13px] font-semibold">
                  {plural(count, "question", "questions")} found
                </h2>
                <JsonBlock text={json} className="max-h-[400px]" />
              </>
            )
          }
        </ReadOnlyResult>
      </ViewBody>
    </>
  );
}
