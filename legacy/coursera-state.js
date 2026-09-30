(function (root, factory) {
  const api = factory();
  root.CourseraStateKit = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INTERCEPT_SOURCE = "auto-coursera-interceptor";
  const OBSERVED_HEADER_NAMES = new Set([
    "x-csrf2-cookie",
    "x-csrf2-token",
    "x-csrf3-token",
    "x-csrftoken",
    "x-requested-with"
  ]);

  function courseSlugFromUrl(value) {
    try {
      const url = new URL(String(value || ""), "https://www.coursera.org/");
      const pathMatch = url.pathname.match(/\/learn\/([^/]+)/);
      if (pathMatch) return decodeURIComponent(pathMatch[1]);
      return url.searchParams.get("slug") || "";
    } catch {
      return "";
    }
  }

  function normalizeHeaderNames(headers) {
    const entries = Array.isArray(headers)
      ? headers
      : headers && typeof headers === "object"
        ? Object.entries(headers)
        : [];

    return entries
      .map((entry) => {
        if (typeof entry === "string") return entry;
        return Array.isArray(entry) && entry.length >= 1 ? entry[0] : "";
      })
      .map((name) => String(name || "").toLowerCase())
      .filter((name) => OBSERVED_HEADER_NAMES.has(name));
  }

  function hasSupportedMaterials(materials) {
    return Array.isArray(materials?.linked?.["onDemandCourseMaterialItems.v2"]);
  }

  function hasUserContext(response) {
    return response?.context?.dispatcher?.stores?.ApplicationStore?.userData?.id != null;
  }

  function createCourseState() {
    let courseSlug = "";
    let materials = null;
    let materialsSlug = "";
    let observedHeaderNames = new Set();
    let observedUserContext = false;
    let courseRevision = 0;

    function invalidateMaterials() {
      materials = null;
      materialsSlug = "";
    }

    function resetObservations() {
      observedHeaderNames = new Set();
      observedUserContext = false;
    }

    function setCourseSlug(nextSlug) {
      const normalized = String(nextSlug || "").trim();
      if (!normalized) return courseSlug;
      if (normalized === courseSlug) return courseSlug;

      courseSlug = normalized;
      courseRevision += 1;
      resetObservations();
      if (materialsSlug && materialsSlug !== normalized) invalidateMaterials();
      return courseSlug;
    }

    function clearCourse() {
      const hadCourseState = Boolean(courseSlug || materials || materialsSlug);
      courseSlug = "";
      invalidateMaterials();
      resetObservations();
      if (hadCourseState) courseRevision += 1;
      return hadCourseState;
    }

    function syncLocation(value) {
      const nextSlug = courseSlugFromUrl(value);
      if (!nextSlug) {
        clearCourse();
        return "";
      }
      return setCourseSlug(nextSlug);
    }

    function setCourseMaterials(nextMaterials, slug) {
      if (!hasSupportedMaterials(nextMaterials)) {
        throw new Error("Unsupported Coursera course materials payload.");
      }
      const normalizedSlug = String(slug || courseSlug || "").trim();
      if (!normalizedSlug) throw new Error("A course slug is required to cache course materials.");

      setCourseSlug(normalizedSlug);
      materialsSlug = normalizedSlug;
      materials = nextMaterials;
      return materials;
    }

    function getCourseMaterials(slug) {
      const normalizedSlug = String(slug || courseSlug || "").trim();
      if (!normalizedSlug || normalizedSlug !== materialsSlug) return null;
      return materials;
    }

    function ingestInterceptMessage(message, activeLocation) {
      if (!message || message.source !== INTERCEPT_SOURCE) return false;

      const requestUrl = message.request?.url || message.url || "";
      const requestSlug = courseSlugFromUrl(requestUrl);
      const hasActiveLocation = activeLocation !== undefined;
      const activeSlug = hasActiveLocation ? courseSlugFromUrl(activeLocation) : "";

      if (hasActiveLocation) {
        if (!activeSlug) {
          clearCourse();
          return true;
        }
        setCourseSlug(activeSlug);
        if (requestSlug && requestSlug !== activeSlug) return true;
      } else if (requestSlug) {
        setCourseSlug(requestSlug);
      }

      normalizeHeaderNames(message.request?.headerNames || message.request?.headers).forEach((name) => {
        observedHeaderNames.add(name);
      });

      if (hasUserContext(message.response)) observedUserContext = true;

      const cacheSlug = hasActiveLocation ? activeSlug : requestSlug;
      if (
        hasSupportedMaterials(message.response) &&
        requestSlug &&
        cacheSlug &&
        requestSlug === cacheSlug
      ) {
        setCourseMaterials(message.response, cacheSlug);
      }

      return true;
    }

    function snapshot() {
      return {
        courseSlug,
        onCourseRoute: Boolean(courseSlug),
        courseRevision,
        hasCourseMaterials: Boolean(materials && materialsSlug === courseSlug),
        observedHeaderNames: [...observedHeaderNames].sort(),
        hasUserContext: observedUserContext
      };
    }

    return Object.freeze({
      setCourseSlug,
      clearCourse,
      syncLocation,
      setCourseMaterials,
      getCourseMaterials,
      ingestInterceptMessage,
      snapshot
    });
  }

  return {
    INTERCEPT_SOURCE,
    OBSERVED_HEADER_NAMES,
    courseSlugFromUrl,
    normalizeHeaderNames,
    hasSupportedMaterials,
    createCourseState
  };
});
