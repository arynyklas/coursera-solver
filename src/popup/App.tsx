import { useState } from "react";
import { type PageContext, usePageContext } from "@/popup/hooks/usePageContext";
import { type ProviderConfigState, useProviderConfig } from "@/popup/hooks/useProviderConfig";
import type { View } from "@/popup/navigation";
import { Complete } from "@/popup/views/Complete";
import { CopyQuestions } from "@/popup/views/CopyQuestions";
import { Dialogue } from "@/popup/views/Dialogue";
import { DryRun } from "@/popup/views/DryRun";
import { Home } from "@/popup/views/Home";
import { Requirements } from "@/popup/views/Requirements";
import { Settings } from "@/popup/views/Settings";
import { Solve } from "@/popup/views/Solve";

export function App() {
  const config = useProviderConfig();
  const context = usePageContext();
  if (config.loading || context === null) return null;
  return (
    <Popup
      config={config}
      context={context}
      initialView={config.draft || !config.activeReady ? "settings" : "home"}
    />
  );
}

function Popup({
  config,
  context,
  initialView,
}: {
  config: ProviderConfigState;
  context: PageContext;
  /** Read once: later config changes (a successful save) must not move the user. */
  initialView: View;
}) {
  const [view, setView] = useState<View>(initialView);
  return (
    <div className="flex max-h-[600px] flex-col">{renderView(view, config, context, setView)}</div>
  );
}

function renderView(
  view: View,
  config: ProviderConfigState,
  context: PageContext,
  navigate: (view: View) => void,
) {
  switch (view) {
    case "home":
      return <Home context={context} config={config} onNavigate={navigate} />;
    case "settings":
      return <Settings config={config} onNavigate={navigate} />;
    case "solve":
      return <Solve context={context} config={config} onNavigate={navigate} />;
    case "dialogue":
      return <Dialogue context={context} config={config} onNavigate={navigate} />;
    case "dryRun":
      return <DryRun context={context} onNavigate={navigate} />;
    case "copyQuestions":
      return <CopyQuestions context={context} onNavigate={navigate} />;
    case "requirements":
      return <Requirements context={context} onNavigate={navigate} />;
    case "complete":
      return <Complete context={context} config={config} onNavigate={navigate} />;
  }
}
