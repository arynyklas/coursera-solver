(function () {
  "use strict";

  const diagnostics = globalThis.CourseraDiagnostics;
  const button = document.getElementById("dryRunBtn");
  const result = document.getElementById("result");

  if (!button || !result || !diagnostics) return;

  function setLoading(loading) {
    button.disabled = loading;
    button.replaceChildren();
    if (loading) {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      spinner.setAttribute("aria-hidden", "true");
      button.append(spinner, document.createTextNode("Inspecting…"));
      return;
    }
    button.textContent = "Dry Run (Read-only)";
  }

  function showError(message) {
    result.replaceChildren();
    result.textContent = message;
    result.className = "error";
    result.style.display = "block";
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active browser tab was found.");
    return tab;
  }

  function sendTabMessage(tabId, message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      });
    });
  }

  function createBadge(text, tone) {
    const badge = document.createElement("span");
    badge.className = `requirement-badge ${tone}`;
    badge.textContent = text;
    return badge;
  }

  function renderReport(report) {
    result.replaceChildren();
    result.className = "";
    result.style.display = "block";

    const heading = document.createElement("div");
    heading.className = "result-heading";

    const headingCopy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "Read-only assessment diagnostics";
    const summary = document.createElement("span");
    summary.className = "requirements-source";
    summary.textContent = diagnostics.formatDryRunSummary(report);
    headingCopy.append(title, summary);

    const copyButton = document.createElement("button");
    copyButton.className = "btn btn-primary btn-compact";
    copyButton.type = "button";
    copyButton.textContent = "Copy report";
    heading.append(headingCopy, copyButton);

    const badges = document.createElement("div");
    badges.className = "requirement-badges";
    badges.append(createBadge(`${report.totalQuestions} detected`, "weight"));
    if (report.issueCount) {
      badges.append(createBadge(`${report.issueCount} issue${report.issueCount === 1 ? "" : "s"}`, "locked"));
    } else {
      badges.append(createBadge("No parser issues", "required"));
    }
    if (report.parser?.selectorStrategy) {
      badges.append(createBadge(`DOM: ${report.parser.selectorStrategy}`, "detected"));
    }
    Object.entries(report.questionTypes || {}).forEach(([type, count]) => {
      badges.append(createBadge(`${count} ${type}`, "detected"));
    });

    const note = document.createElement("p");
    note.className = "requirements-note";
    note.textContent = "This test only reads assessment structure. It does not call an AI provider, fill answers, click controls, submit work, or modify course state.";

    const rawText = JSON.stringify(report, null, 2);
    const content = document.createElement("div");
    content.className = "result-content";
    content.textContent = rawText;

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(rawText);
        copyButton.textContent = "Copied";
        setTimeout(() => { copyButton.textContent = "Copy report"; }, 1500);
      } catch {
        copyButton.textContent = "Copy failed";
        setTimeout(() => { copyButton.textContent = "Copy report"; }, 1500);
      }
    });

    result.append(heading, badges, note, content);
  }

  button.addEventListener("click", async () => {
    setLoading(true);
    result.replaceChildren();
    result.textContent = "Inspecting the current assessment in read-only mode…";
    result.className = "";
    result.style.display = "block";

    try {
      const tab = await getActiveTab();
      const response = await sendTabMessage(tab.id, { action: "getSelection" });
      if (response?.error) throw new Error(response.error);

      const questions = Array.isArray(response?.data) ? response.data : [];
      const issues = Array.isArray(response?.issues) ? response.issues : [];
      let parserDiagnostics = null;
      try {
        const parserResponse = await sendTabMessage(tab.id, { action: "getParserDiagnostics" });
        parserDiagnostics = parserResponse?.data || null;
      } catch {
        // Older content scripts can still produce the core read-only report.
      }

      const report = diagnostics.buildDryRunReport(questions, issues, parserDiagnostics);
      renderReport(report);
    } catch (error) {
      showError(error.message || "Refresh the Coursera page, then try the dry run again.");
    } finally {
      setLoading(false);
    }
  });
})();
