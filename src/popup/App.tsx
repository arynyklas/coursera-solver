import { useState } from "react";
import { type PageContext, usePageContext } from "@/popup/hooks/usePageContext";
import { type ProviderConfigState, useProviderConfig } from "@/popup/hooks/useProviderConfig";
import type { View } from "@/popup/navigation";
import { Home } from "@/popup/views/Home";
import { Settings } from "@/popup/views/Settings";

export function App() {
  const config = useProviderConfig();
  const context = usePageContext();
  if (config.loading || context === null) return null;
  return (
    <Popup
      config={config}
      context={context}
      initialView={config.activeReady ? "home" : "settings"}
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
    default:
      return null;
  }
}
