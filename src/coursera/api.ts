export const MATERIAL_INCLUDES =
  "modules,lessons,passableItemGroups,passableItemGroupChoices,passableLessonElements,items";
export const MATERIAL_FIELDS = [
  "moduleIds",
  "onDemandCourseMaterialModules.v1(name,slug,lessonIds,optional)",
  "onDemandCourseMaterialLessons.v1(name,slug,itemIds,elementIds,optional)",
  "onDemandCourseMaterialPassableItemGroups.v1(requiredPassedCount,passableItemGroupChoiceIds,trackId)",
  "onDemandCourseMaterialPassableItemGroupChoices.v1(name,description,itemIds)",
  "onDemandCourseMaterialPassableLessonElements.v1(gradingWeight,isRequiredForPassing)",
  "onDemandCourseMaterialItems.v2(name,slug,moduleId,lessonId,timeCommitment,itemClass,contentSummary,isLocked,lockedStatus,itemLockedReasonCode,itemLockSummary)",
] as const;

export const SUPPLEMENT_COMPLETION_URL =
  "https://www.coursera.org/api/onDemandSupplementCompletions.v1";

export function courseSlugFromPath(pathname: string | null | undefined): string {
  const slug = String(pathname || "").match(/\/learn\/([^/]+)/)?.[1];
  if (!slug) return "";
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export function buildCourseMaterialsUrl(courseSlug: string | null | undefined): string {
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

export function hasSupportedCourseMaterials(materials: unknown): boolean {
  return Array.isArray(
    (materials as { linked?: Record<string, unknown> } | null | undefined)?.linked?.[
      "onDemandCourseMaterialItems.v2"
    ],
  );
}

export function courseMaterialsError(status: number): string {
  if (status === 401 || status === 403) {
    return "Coursera could not authorize the course request. Sign in, then try again.";
  }
  return `Coursera course materials request failed with HTTP ${status}.`;
}

// Shape of content.js:467 in v1.1.0 (c2f8b71); the slug is now URL-encoded.
export function buildCompletionMaterialsUrl(slug: string): string {
  return `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${encodeURIComponent(slug)}&includes=modules,lessons,items&fields=moduleIds,onDemandCourseMaterialModules.v1(lessonIds,optional),onDemandCourseMaterialLessons.v1(elementIds,optional,itemIds),onDemandCourseMaterialItems.v2(name,isLocked,itemClass,contentSummary)`;
}

// content.js:514 in v1.1.0 (c2f8b71).
export function buildLectureCompletionUrl(
  userId: string,
  courseSlug: string,
  itemId: string,
): string {
  return `https://www.coursera.org/api/opencourse.v1/user/${userId}/course/${courseSlug}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`;
}

// content.js:524 in v1.1.0 (c2f8b71).
export function supplementCompletionBody(userId: string, courseId: string, itemId: string): string {
  return JSON.stringify({ userId: Number.parseInt(userId, 10) || userId, courseId, itemId });
}
