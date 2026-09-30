(function (root, factory) {
  const api = factory();
  root.CourseraReadMessageRouterKit = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FALLBACK_ERRORS = Object.freeze({
    getSelection: "Could not extract this assessment.",
    getCourseRequirements: "Could not load course requirements.",
    getGradedAssignments: "Could not load course requirements.",
    getParserDiagnostics: "Could not load parser diagnostics."
  });

  function serializeError(error, fallback) {
    const message = typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : String(fallback || "Read-only request failed.");
    return { error: message };
  }

  function createReadMessageListener(runtime) {
    if (!runtime || typeof runtime !== "object") {
      throw new Error("A Coursera read runtime is required.");
    }

    const routes = Object.freeze({
      async getSelection() {
        const result = await runtime.scrapeAssessmentDetailed();
        return {
          data: Array.isArray(result?.questions) ? result.questions : [],
          issues: Array.isArray(result?.issues) ? result.issues : []
        };
      },
      async getCourseRequirements() {
        return { data: await runtime.getCourseRequirements() };
      },
      async getGradedAssignments() {
        return { data: await runtime.getCourseRequirements() };
      },
      async getParserDiagnostics() {
        return { data: await runtime.getParserDiagnostics() };
      }
    });

    return function handleReadMessage(request, _sender, sendResponse) {
      const action = typeof request?.action === "string" ? request.action : "";
      const route = routes[action];
      if (!route) return false;

      Promise.resolve()
        .then(() => route())
        .then((response) => sendResponse(response))
        .catch((error) => sendResponse(serializeError(error, FALLBACK_ERRORS[action])));
      return true;
    };
  }

  return {
    FALLBACK_ERRORS,
    serializeError,
    createReadMessageListener
  };
});
