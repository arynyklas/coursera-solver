import "@/styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/popup/App";
import { BusyProvider } from "@/popup/hooks/busy";

const container = document.getElementById("root");
if (!container) throw new Error("Popup root element is missing.");
createRoot(container).render(
  <StrictMode>
    <BusyProvider>
      <App />
    </BusyProvider>
  </StrictMode>,
);
