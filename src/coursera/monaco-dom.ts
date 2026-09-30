export interface CodeEditorDescriptor {
  modelUri: string;
  language: string;
}

export function normalizeModelUri(value: unknown): string {
  const modelUri = String(value || "").trim();
  return modelUri.startsWith("inmemory://model/") ? modelUri : "";
}

export function editableEditorHost(block: Element): Element | null {
  const editorHosts = Array.from(block.querySelectorAll(".monaco-editor[data-uri]"));
  const evaluator = block.querySelector(".cml-code-evaluator");

  if (editorHosts.length === 1) return editorHosts[0] ?? null;
  if (!evaluator || editorHosts.length < 2) return null;

  const precedingEditors = editorHosts.filter((host) =>
    Boolean(host.compareDocumentPosition(evaluator) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  return precedingEditors.at(-1) ?? null;
}

export function describeCodeEditor(block: Element): CodeEditorDescriptor {
  const editorHost = editableEditorHost(block);
  if (!editorHost) throw new Error("Could not identify the editable Coursera code model.");

  const modelUri = normalizeModelUri(editorHost.getAttribute("data-uri"));
  if (!modelUri) throw new Error("Coursera returned an unsupported code model URI.");

  const language = editorHost.closest("[data-mode-id]")?.getAttribute("data-mode-id") || "unknown";
  return { modelUri, language };
}
