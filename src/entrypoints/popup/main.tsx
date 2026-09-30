import "@/styles/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const container = document.getElementById("root");
if (!container) throw new Error("Popup root element is missing.");
createRoot(container).render(
  <StrictMode>
    <main className="p-4">Auto Solver</main>
  </StrictMode>,
);
