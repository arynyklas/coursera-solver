import { buildDryRunReport, formatDryRunSummary } from "@/coursera/diagnostics";
import { CopyButton } from "@/popup/components/CopyButton";
import { JsonBlock } from "@/popup/components/JsonBlock";
import { Note } from "@/popup/components/Note";
import { ReadOnlyResult } from "@/popup/components/ReadOnlyResult";
import { ToneBadge } from "@/popup/components/ToneBadge";
import { HINT_CLASS, ViewBody } from "@/popup/components/ViewBody";
import { ViewHeader } from "@/popup/components/ViewHeader";
import { usePageAction } from "@/popup/hooks/usePageAction";
import { type PageContext, requireTabId } from "@/popup/hooks/usePageContext";
import { plural } from "@/popup/lib/format";
import type { Navigate } from "@/popup/navigation";
import { sendToTab } from "@/shared/messaging";
import type { ParserDiagnostics } from "@/shared/types";

export function DryRun({ context, onNavigate }: { context: PageContext; onNavigate: Navigate }) {
  const action = usePageAction(
    "dryRun",
    async () => {
      const tabId = requireTabId(context);
      const { questions, issues } = await sendToTab(tabId, "getQuestions", {});
      let diagnostics: ParserDiagnostics | null = null;
      try {
        diagnostics = await sendToTab(tabId, "getDiagnostics", {});
      } catch {
        // Tolerated as in legacy dry-run.js:129-135: the core report does not need diagnostics.
      }
      const report = buildDryRunReport(questions, issues, diagnostics);
      return { report, json: JSON.stringify(report, null, 2) };
    },
    { auto: context.isCourse },
  );

  return (
    <>
      <ViewHeader
        title="Dry run"
        onBack={() => onNavigate("home")}
        right={
          <CopyButton label="Copy report" text={action.data?.json ?? ""} disabled={!action.data} />
        }
      />
      <ViewBody>
        <ReadOnlyResult
          isCourse={context.isCourse}
          action={action}
          loadingText="Inspecting the current assessment in read-only mode…"
        >
          {({ report, json }) => (
            <>
              <Note tone="success">{formatDryRunSummary(report)}</Note>
              <div className="flex flex-wrap items-center gap-1.5">
                {report.parser?.selectorStrategy ? (
                  <ToneBadge tone="outline">DOM: {report.parser.selectorStrategy}</ToneBadge>
                ) : null}
                {Object.entries(report.questionTypes).map(([type, count]) => (
                  <ToneBadge key={type} tone="outline">
                    {count} {type}
                  </ToneBadge>
                ))}
                {report.issueCount ? (
                  <ToneBadge tone="warning">
                    {plural(report.issueCount, "issue", "issues")}
                  </ToneBadge>
                ) : (
                  <ToneBadge tone="success">No parser issues</ToneBadge>
                )}
              </div>
              <JsonBlock text={json} />
              <p className={HINT_CLASS}>
                This test only reads assessment structure. It does not call an AI provider, fill
                answers, click controls, submit work, or modify course state.
              </p>
            </>
          )}
        </ReadOnlyResult>
      </ViewBody>
    </>
  );
}
