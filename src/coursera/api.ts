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

// An ungraded plugin's page reads a session keyed by learner, course and item; its "Mark as
// completed" button then PUTs { sessionId, progressState: "Completed" } to the progress resource
// under the same key (WidgetItemActions.markItemComplete in Coursera's ondemand bundle).
export function buildWidgetSessionUrl(userId: string, courseId: string, itemId: string): string {
  return `https://www.coursera.org/api/onDemandWidgetSessions.v1/${userId}~${courseId}~${itemId}?fields=sessionId`;
}

export function buildWidgetProgressUrl(userId: string, courseId: string, itemId: string): string {
  return `https://www.coursera.org/api/onDemandWidgetProgress.v1/${userId}~${courseId}~${itemId}`;
}

// The learner's progress per item, keyed by item id, e.g. { "pXaVo": { "progressState": "Completed" } }.
export function buildCourseProgressUrl(userId: string, courseId: string): string {
  return `https://www.coursera.org/api/onDemandCoursesProgress.v1/${userId}~${courseId}?fields=items`;
}

/** First entry of a Coursera REST response's `elements` array. */
function firstElement(body: unknown): object | undefined {
  if (typeof body !== "object" || body === null || !("elements" in body)) return undefined;
  if (!Array.isArray(body.elements)) return undefined;
  const first: unknown = body.elements[0];
  return typeof first === "object" && first !== null ? first : undefined;
}

/** The session id from an `onDemandWidgetSessions.v1` response, or "" when there is none. */
export function widgetSessionId(body: unknown): string {
  const element = firstElement(body);
  if (!element || !("sessionId" in element)) return "";
  return typeof element.sessionId === "string" ? element.sessionId : "";
}

/** Ids of the items the learner has completed, from an `onDemandCoursesProgress.v1` response. */
export function completedItemIds(body: unknown): Set<string> {
  const element = firstElement(body);
  if (!element || !("items" in element)) return new Set();
  const { items } = element;
  if (typeof items !== "object" || items === null) return new Set();
  const completed = new Set<string>();
  for (const [id, item] of Object.entries(items)) {
    if (typeof item !== "object" || item === null || !("progressState" in item)) continue;
    if (item.progressState === "Completed") completed.add(id);
  }
  return completed;
}
