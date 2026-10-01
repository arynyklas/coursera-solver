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

/** One item's record in the learner's course progress. */
export interface ItemProgress {
  /** Coursera's `progressState`: "Started" or "Completed". */
  state: string;
  /** `content.definition.submitted`, which staff-graded and peer-graded items record. */
  submitted?: boolean;
}

/** One item's overall grade outcome, as Coursera's Grades page reads it. */
export interface ItemOutcome {
  /** A fraction (0.8 is 80%); absent until the work is graded. */
  grade?: number;
  isPassed: boolean;
  /** Staff adjusted the outcome. */
  overridden: boolean;
}

/** The learner's progress and grade outcomes in one course, by item id. */
export interface LearnerProgress {
  items: ReadonlyMap<string, ItemProgress>;
  outcomes: ReadonlyMap<string, ItemOutcome>;
}

/**
 * Each item's progress record by item id, from an `onDemandCoursesProgress.v1` response. A record
 * without items means nothing was started yet; a response without the learner's record gives
 * `null`.
 */
export function itemProgress(body: unknown): Map<string, ItemProgress> | null {
  const element = firstElement(body);
  if (!element) return null;
  const progress = new Map<string, ItemProgress>();
  const items = "items" in element ? element.items : undefined;
  if (typeof items !== "object" || items === null) return progress;
  for (const [id, item] of Object.entries(items)) {
    if (typeof item !== "object" || item === null || !("progressState" in item)) continue;
    if (typeof item.progressState !== "string") continue;
    const content = "content" in item ? item.content : undefined;
    const definition =
      typeof content === "object" && content !== null && "definition" in content
        ? content.definition
        : undefined;
    const submitted =
      typeof definition === "object" && definition !== null && "submitted" in definition
        ? definition.submitted
        : undefined;
    progress.set(id, {
      state: item.progressState,
      ...(typeof submitted === "boolean" ? { submitted } : {}),
    });
  }
  return progress;
}

// The same grade records Coursera's Grades page loads: each item's overall outcome and any
// outcome a staff member adjusted.
export function buildCourseGradesUrl(userId: string, courseId: string): string {
  return `https://www.coursera.org/api/onDemandCourseViewGrades.v1/${userId}~${courseId}?includes=items,itemOutcomeOverrides&fields=onDemandCourseViewItemGrades.v1(overallOutcome),onDemandCourseGradeItemOutcomeOverrides.v1(grade,isPassed)`;
}

/** The item id of a linked grade record: its `itemId`, else the last part of its `id`. */
function gradeRecordItemId(record: object): string {
  if ("itemId" in record && typeof record.itemId === "string") return record.itemId;
  const id = "id" in record && typeof record.id === "string" ? record.id : "";
  return id.split("~").at(-1) ?? "";
}

/** The linked records of one collection in a Coursera REST response. */
function linkedRecords(body: object, key: string): object[] {
  const linked = "linked" in body ? body.linked : undefined;
  if (typeof linked !== "object" || linked === null) return [];
  const records: unknown = Reflect.get(linked, key);
  return Array.isArray(records)
    ? records.filter((record): record is object => typeof record === "object" && record !== null)
    : [];
}

/**
 * Each graded item's outcome by item id, from an `onDemandCourseViewGrades.v1` response, or
 * `null` when the response has no grade record for the learner.
 */
export function itemOutcomes(body: unknown): Map<string, ItemOutcome> | null {
  if (!firstElement(body) || typeof body !== "object" || body === null) return null;
  const outcomes = new Map<string, ItemOutcome>();
  for (const record of linkedRecords(body, "onDemandCourseViewItemGrades.v1")) {
    const itemId = gradeRecordItemId(record);
    const outcome = "overallOutcome" in record ? record.overallOutcome : undefined;
    if (!itemId || typeof outcome !== "object" || outcome === null) continue;
    const grade =
      "grade" in outcome && typeof outcome.grade === "number" ? outcome.grade : undefined;
    outcomes.set(itemId, {
      ...(grade === undefined ? {} : { grade }),
      isPassed: "isPassed" in outcome && outcome.isPassed === true,
      overridden: false,
    });
  }
  for (const record of linkedRecords(body, "onDemandCourseGradeItemOutcomeOverrides.v1")) {
    const itemId = gradeRecordItemId(record);
    if (!itemId) continue;
    outcomes.set(itemId, { ...(outcomes.get(itemId) ?? { isPassed: false }), overridden: true });
  }
  return outcomes;
}
