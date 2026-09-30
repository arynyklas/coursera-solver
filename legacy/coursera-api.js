(function (root, factory) {
  const api = factory();
  root.CourseraApiKit = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MATERIAL_INCLUDES = "modules,lessons,passableItemGroups,passableItemGroupChoices,passableLessonElements,items";
  const MATERIAL_FIELDS = [
    "moduleIds",
    "onDemandCourseMaterialModules.v1(name,slug,lessonIds,optional)",
    "onDemandCourseMaterialLessons.v1(name,slug,itemIds,elementIds,optional)",
    "onDemandCourseMaterialPassableItemGroups.v1(requiredPassedCount,passableItemGroupChoiceIds,trackId)",
    "onDemandCourseMaterialPassableItemGroupChoices.v1(name,description,itemIds)",
    "onDemandCourseMaterialPassableLessonElements.v1(gradingWeight,isRequiredForPassing)",
    "onDemandCourseMaterialItems.v2(name,slug,moduleId,lessonId,timeCommitment,itemClass,contentSummary,isLocked,lockedStatus,itemLockedReasonCode,itemLockSummary)"
  ];

  function courseSlugFromPath(pathname) {
    const match = String(pathname || "").match(/\/learn\/([^/]+)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  function buildCourseMaterialsUrl(courseSlug) {
    const slug = String(courseSlug || "").trim();
    if (!slug) throw new Error("A Coursera course slug is required.");

    const apiUrl = new URL("https://www.coursera.org/api/onDemandCourseMaterials.v2/");
    apiUrl.searchParams.set("q", "slug");
    apiUrl.searchParams.set("slug", slug);
    apiUrl.searchParams.set("includes", MATERIAL_INCLUDES);
    apiUrl.searchParams.set("fields", MATERIAL_FIELDS.join(","));
    apiUrl.searchParams.set("showLockedItems", "true");
    return apiUrl.href;
  }

  function hasSupportedCourseMaterials(materials) {
    return Array.isArray(materials?.linked?.["onDemandCourseMaterialItems.v2"]);
  }

  function courseMaterialsError(status) {
    if (status === 401 || status === 403) {
      return "Coursera could not authorize the course request. Sign in, then try again.";
    }
    return `Coursera course materials request failed with HTTP ${status}.`;
  }

  return {
    MATERIAL_INCLUDES,
    MATERIAL_FIELDS,
    courseSlugFromPath,
    buildCourseMaterialsUrl,
    hasSupportedCourseMaterials,
    courseMaterialsError
  };
});
