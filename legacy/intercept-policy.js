(function (root, factory) {
  const api = factory();
  root.CourseraInterceptPolicy = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CAPTURED_HEADER_NAMES = new Set([
    "x-csrf2-cookie",
    "x-csrf2-token",
    "x-csrf3-token",
    "x-csrftoken",
    "x-requested-with"
  ]);
  const VALUE_HEADER_NAMES = new Set(["x-csrf3-token"]);
  const FORWARDED_QUERY_NAMES = new Set(["slug", "userId"]);
  const MATERIAL_COLLECTION_FIELDS = Object.freeze({
    "onDemandCourseMaterialModules.v1": Object.freeze(["id", "name", "lessonIds"]),
    "onDemandCourseMaterialLessons.v1": Object.freeze(["id", "name", "itemIds", "elementIds"]),
    "onDemandCourseMaterialItems.v2": Object.freeze([
      "id",
      "moduleId",
      "lessonId",
      "name",
      "slug",
      "timeCommitment",
      "itemClass",
      "contentSummary",
      "isLocked",
      "lockedStatus",
      "itemLockedReasonCode",
      "itemLockSummary"
    ]),
    "onDemandCourseMaterialPassableLessonElements.v1": Object.freeze([
      "id",
      "gradingWeight",
      "isRequiredForPassing"
    ]),
    "onDemandCourseMaterialPassableItemGroups.v1": Object.freeze([
      "id",
      "requiredPassedCount",
      "passableItemGroupChoiceIds"
    ]),
    "onDemandCourseMaterialPassableItemGroupChoices.v1": Object.freeze([
      "id",
      "name",
      "itemIds"
    ])
  });

  function courseraApiUrl(value, baseUrl = "https://www.coursera.org/") {
    try {
      const url = new URL(String(value || ""), baseUrl);
      const hostname = url.hostname.toLowerCase();
      const isCourseraHost = hostname === "coursera.org" || hostname.endsWith(".coursera.org");
      if (!isCourseraHost || !url.pathname.startsWith("/api/")) return null;

      const safeUrl = new URL(`${url.origin}${url.pathname}`);
      FORWARDED_QUERY_NAMES.forEach((name) => {
        url.searchParams.getAll(name).forEach((paramValue) => {
          safeUrl.searchParams.append(name, paramValue);
        });
      });
      return safeUrl;
    } catch {
      return null;
    }
  }

  function normalizeCourseraApiUrl(value, baseUrl) {
    return courseraApiUrl(value, baseUrl)?.href || "";
  }

  function normalizeHeaders(headers) {
    if (!headers) return [];
    if (Array.isArray(headers)) {
      return headers.filter((entry) => Array.isArray(entry) && entry.length >= 2);
    }
    if (typeof headers.entries === "function") {
      try {
        return Array.from(headers.entries());
      } catch {
        return [];
      }
    }
    if (typeof headers === "object") return Object.entries(headers);
    return [];
  }

  function observedRequestHeaderNames(headers) {
    const rawNames = Array.isArray(headers) && headers.every((entry) => typeof entry === "string")
      ? headers
      : normalizeHeaders(headers).map(([name]) => name);

    return [...new Set(rawNames
      .map((name) => String(name || "").toLowerCase())
      .filter((name) => CAPTURED_HEADER_NAMES.has(name)))]
      .sort();
  }

  function filterRequestHeaders(headers) {
    const safeHeaders = [];
    normalizeHeaders(headers).forEach(([name, value]) => {
      const normalizedName = String(name).toLowerCase();
      if (!VALUE_HEADER_NAMES.has(normalizedName) || value == null) return;
      safeHeaders.push([normalizedName, String(value)]);
    });
    return safeHeaders;
  }

  function pickMaterialFields(entry, fields) {
    if (!entry || typeof entry !== "object") return {};
    const safe = {};
    fields.forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) return;
      if (field === "contentSummary") {
        const typeName = entry.contentSummary?.typeName;
        if (typeName != null) safe.contentSummary = { typeName };
        return;
      }
      safe[field] = entry[field];
    });
    return safe;
  }

  function minimizeCourseMaterials(responseBody) {
    const linked = {};
    Object.entries(MATERIAL_COLLECTION_FIELDS).forEach(([key, fields]) => {
      const collection = responseBody?.linked?.[key];
      if (!Array.isArray(collection)) return;
      linked[key] = collection.map((entry) => pickMaterialFields(entry, fields));
    });

    const elements = Array.isArray(responseBody?.elements)
      ? responseBody.elements.map((entry) => ({
        moduleIds: Array.isArray(entry?.moduleIds) ? [...entry.moduleIds] : []
      }))
      : [];

    return { elements, linked };
  }

  function minimizeResponse(urlValue, responseBody) {
    const url = courseraApiUrl(urlValue);
    if (!url || !responseBody || typeof responseBody !== "object") return undefined;

    if (url.pathname.includes("onDemandCourseMaterials.v2")) {
      return minimizeCourseMaterials(responseBody);
    }

    const userId = responseBody?.context?.dispatcher?.stores?.ApplicationStore?.userData?.id;
    if (userId == null) return undefined;

    return {
      context: {
        dispatcher: {
          stores: {
            ApplicationStore: {
              userData: { id: userId }
            }
          }
        }
      }
    };
  }

  function shouldEmit(urlValue, headerNames, responseBody) {
    const url = courseraApiUrl(urlValue);
    if (!url) return false;

    if (observedRequestHeaderNames(headerNames).length > 0) return true;
    if (responseBody) return true;
    if (url.pathname.includes("onDemandCourses.v1") || url.pathname.includes("onDemandCourseMaterials.v2")) return true;
    if (url.searchParams.has("slug") || url.searchParams.has("userId")) return true;
    return /\/user\/\d+/.test(url.pathname);
  }

  return {
    CAPTURED_HEADER_NAMES,
    VALUE_HEADER_NAMES,
    FORWARDED_QUERY_NAMES,
    filterRequestHeaders,
    observedRequestHeaderNames,
    minimizeCourseMaterials,
    minimizeResponse,
    normalizeCourseraApiUrl,
    shouldEmit
  };
});
