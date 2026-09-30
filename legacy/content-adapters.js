(function () {
  "use strict";

  const requirements = globalThis.CourseRequirementsKit;
  const parser = globalThis.AssessmentParserKit;
  const courseraApi = globalThis.CourseraApiKit;
  const courseStateKit = globalThis.CourseraStateKit;
  const monaco = globalThis.MonacoBridgeKit;
  const readMessageRouter = globalThis.CourseraReadMessageRouterKit;

  if (!requirements || !parser || !courseraApi || !courseStateKit || !monaco || !readMessageRouter) {
    console.warn("Coursera content modules were not loaded; read runtime is unavailable.");
    return;
  }

  const courseState = courseStateKit.createCourseState();
  const monacoClient = monaco.createBridgeClient(window, { timeoutMs: 2600 });
  let lastLocationHref = "";

  function currentCourseSlug() {
    return courseStateKit.courseSlugFromUrl(window.location.href);
  }

  function syncCourseLocation(force = false) {
    const href = String(window.location.href || "");
    if (!force && href === lastLocationHref) return false;
    lastLocationHref = href;
    courseState.syncLocation(href);
    return true;
  }

  function seedCourseStateFromLegacyCache() {
    syncCourseLocation(true);
    const slug = currentCourseSlug();
    if (
      slug &&
      capturedCourseId === slug &&
      courseraApi.hasSupportedCourseMaterials(capturedCourseMaterials)
    ) {
      try {
        courseState.setCourseMaterials(capturedCourseMaterials, slug);
      } catch {
        // Ignore stale or unsupported legacy cache entries.
      }
    }
  }

  seedCourseStateFromLegacyCache();

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    courseState.ingestInterceptMessage(event.data, window.location.href);
  });
  window.addEventListener("popstate", () => syncCourseLocation(true));
  window.addEventListener("hashchange", () => syncCourseLocation(true));

  if (typeof MutationObserver === "function" && document.documentElement) {
    const locationObserver = new MutationObserver(() => syncCourseLocation(false));
    locationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  async function loadCourseMaterials() {
    syncCourseLocation(true);
    const courseSlug = currentCourseSlug();
    if (!courseSlug) throw new Error("Open a Coursera course page first.");

    const modularCache = courseState.getCourseMaterials(courseSlug);
    if (modularCache) return modularCache;

    if (
      capturedCourseId === courseSlug &&
      courseraApi.hasSupportedCourseMaterials(capturedCourseMaterials)
    ) {
      courseState.setCourseMaterials(capturedCourseMaterials, courseSlug);
      return capturedCourseMaterials;
    }

    const response = await fetch(courseraApi.buildCourseMaterialsUrl(courseSlug), {
      credentials: "include"
    });
    if (!response.ok) throw new Error(courseraApi.courseMaterialsError(response.status));

    const materials = await response.json();
    if (!courseraApi.hasSupportedCourseMaterials(materials)) {
      throw new Error("Coursera returned course materials in an unsupported format.");
    }

    syncCourseLocation(true);
    if (currentCourseSlug() !== courseSlug) {
      throw new Error("The open Coursera course changed while its materials were loading. Try again.");
    }

    courseState.setCourseMaterials(materials, courseSlug);
    capturedCourseMaterials = materials;
    capturedCourseId = courseSlug;
    return materials;
  }

  async function getCourseRequirements() {
    const courseSlug = currentCourseSlug();
    if (!courseSlug) throw new Error("Open a Coursera course page first.");
    const materials = await loadCourseMaterials();
    return requirements.normalizeCourseRequirements(materials, courseSlug);
  }

  async function scrapeAssessmentDetailed() {
    const questions = [];
    const issues = [];
    const nextCodeBindings = new Map();
    const questionBlocks = parser.assessmentQuestionBlocks(document);

    for (let index = 0; index < questionBlocks.length; index += 1) {
      const block = questionBlocks[index];
      const questionNumber = index + 1;
      const extracted = parser.extractQuestionShell(block, questionNumber);
      if (!extracted) continue;

      const question = extracted.question;
      if (extracted.kind === "code") {
        try {
          const descriptor = monaco.describeCodeEditor(block);
          const modelResponse = await monacoClient.request("read-model", {
            modelUri: descriptor.modelUri
          });
          const currentCode = String(modelResponse.value ?? "");

          question.language = descriptor.language;
          question.currentCode = currentCode;
          nextCodeBindings.set(questionNumber, {
            modelUri: descriptor.modelUri,
            expectedValue: currentCode
          });
          questions.push(question);
        } catch (error) {
          issues.push({
            questionNumber,
            error: error.message || "Could not read the code editor."
          });
        }
        continue;
      }

      questions.push(question);
    }

    latestCodeQuestionBindings = nextCodeBindings;
    return { questions, issues };
  }

  function moduleSnapshot() {
    return {
      requirements: "course-requirements.js",
      assessmentParser: "assessment-parser.js",
      courseraApi: "coursera-api.js",
      courseState: "coursera-state.js",
      monacoBridge: "monaco-bridge.js",
      presentation: "presentation.js",
      readMessageRouter: "read-message-router.js",
      mode: "progressive-extraction"
    };
  }

  function getParserDiagnostics() {
    syncCourseLocation(true);
    return {
      selectors: parser.selectorDiagnostics(document),
      state: courseState.snapshot(),
      modules: moduleSnapshot()
    };
  }

  // content.js owns mutation paths. Read-only parsing/state/messaging delegate here.
  const readRuntime = Object.freeze({
    getCurrentCourseSlug: currentCourseSlug,
    loadCourseMaterials,
    getCourseRequirements,
    normalizeCourseRequirements: requirements.normalizeCourseRequirements,
    assessmentQuestionBlocks() {
      return parser.assessmentQuestionBlocks(document);
    },
    codeEditorDescriptor: monaco.describeCodeEditor,
    scrapeAssessmentDetailed,
    getParserDiagnostics
  });

  globalThis.CourseraReadRuntime = readRuntime;
  chrome.runtime.onMessage.addListener(readMessageRouter.createReadMessageListener(readRuntime));
  globalThis.CourseraContentModules = Object.freeze(moduleSnapshot());
})();
