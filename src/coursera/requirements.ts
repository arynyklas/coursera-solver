import type { ItemOutcome, ItemProgress, LearnerProgress } from "@/coursera/api";
import type {
  CourseMaterials,
  CourseRequirementsResult,
  GroupRequirement,
  Requirement,
  RequirementStatus,
} from "@/shared/types";

// Shapes the linked collections are read through; Coursera payloads are not validated.
interface CourseItem {
  id?: string;
  name?: string;
  slug?: unknown;
  moduleId?: string;
  lessonId?: string;
  itemClass?: string;
  contentSummary?: { typeName?: string };
  isLocked?: unknown;
  lockedStatus?: unknown;
  itemLockSummary?: string;
  itemLockedReasonCode?: string;
  timeCommitment?: unknown;
}
interface CourseModule {
  id?: string;
  name?: string;
  lessonIds?: string[];
}
interface CourseLesson {
  id?: string;
  name?: string;
  itemIds?: string[];
  elementIds?: string[];
}
interface PassableElement {
  id?: string;
  gradingWeight?: unknown;
  isRequiredForPassing?: unknown;
}
interface PassableGroup {
  requiredPassedCount?: unknown;
  passableItemGroupChoiceIds?: unknown;
}
interface PassableChoice {
  id?: string;
  name?: string;
  itemIds?: string[];
}

type OrderedRequirement = Requirement & {
  moduleOrder?: number;
  lessonOrder?: number;
  itemOrder?: number;
};

const ROUTES: Record<string, string> = {
  exam: "exam",
  quiz: "quiz",
  staffGraded: "assignment-submission",
  ungradedAssignment: "assignment-submission",
  peer: "peer",
  phasedPeer: "peer",
  programming: "programming",
  gradedProgramming: "programming",
};

export function linkedCourseCollection<T = unknown>(
  materials: CourseMaterials | null | undefined,
  key: string,
): T[] {
  const collection = materials?.linked?.[key];
  return Array.isArray(collection) ? (collection as T[]) : [];
}

export function requirementRoute(type: string): string {
  return (Object.hasOwn(ROUTES, type) && ROUTES[type]) || "";
}

export function courseItemType(item: CourseItem | null | undefined): string {
  return item?.contentSummary?.typeName || item?.itemClass || "unknown";
}

export function courseItemIsLocked(item: CourseItem | null | undefined): boolean {
  if (item?.isLocked === true) return true;
  const status = String(item?.lockedStatus || "")
    .trim()
    .toLowerCase();
  if (!status || ["unlocked", "not_locked", "available"].includes(status)) return false;
  return status === "locked" || status.startsWith("locked_") || status.startsWith("hard_locked");
}

export function itemIdFromPassable(passableId: string | null | undefined): string {
  const parts = String(passableId || "")
    .split("~")
    .filter(Boolean);
  return parts.at(-1) || "";
}

// Coursera reads submission for these types from the item's progress record: StaffGradedState for
// its `isProject()` types, PeerState for peer review. Coursera's StaffGradedState also counts a
// started project as submitted when the record has no `submitted` field; the progress this
// extension reads may lack that field (Coursera showed a started, unsubmitted staffGraded quiz as
// "Not submitted"), so here only an explicit `submitted: true` counts.
const SUBMISSION_TYPES: Record<string, true> = {
  staffGraded: true,
  ungradedAssignment: true,
  peer: true,
  phasedPeer: true,
};

/**
 * A requirement's status as Coursera's computed item (withComputedItem) gives it, in the order its
 * course outline checks: a passing outcome is passed; a grade or a staff adjustment without a pass
 * is failed; then completed progress; then submitted work that has no grade yet.
 */
function requirementStatus(
  type: string,
  progress: ItemProgress | undefined,
  outcome: ItemOutcome | undefined,
): RequirementStatus {
  if (outcome?.isPassed) return "passed";
  if (outcome && (outcome.overridden || outcome.grade !== undefined)) return "failed";
  if (progress?.state === "Completed") return "completed";
  // Other graded items count as submitted only once they have a grade, covered above.
  return Object.hasOwn(SUBMISSION_TYPES, type) && progress?.submitted === true
    ? "submitted"
    : "notSubmitted";
}

/** `learner` holds the learner's progress and grade outcomes; without it every status is `null`. */
export function normalizeCourseRequirements(
  materials: CourseMaterials,
  courseSlug: string,
  learner: LearnerProgress | null = null,
): CourseRequirementsResult {
  const items = linkedCourseCollection<CourseItem>(materials, "onDemandCourseMaterialItems.v2");
  const modules = linkedCourseCollection<CourseModule>(
    materials,
    "onDemandCourseMaterialModules.v1",
  );
  const lessons = linkedCourseCollection<CourseLesson>(
    materials,
    "onDemandCourseMaterialLessons.v1",
  );
  const passables = linkedCourseCollection<PassableElement>(
    materials,
    "onDemandCourseMaterialPassableLessonElements.v1",
  );
  const passableGroups = linkedCourseCollection<PassableGroup>(
    materials,
    "onDemandCourseMaterialPassableItemGroups.v1",
  );
  const passableChoices = linkedCourseCollection<PassableChoice>(
    materials,
    "onDemandCourseMaterialPassableItemGroupChoices.v1",
  );

  const itemById = new Map(items.map((item) => [item.id, item]));
  const moduleById = new Map(modules.map((module) => [module.id, module]));
  const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
  const choiceById = new Map(passableChoices.map((choice) => [choice.id, choice]));

  const rootModuleIds = materials?.elements?.[0]?.moduleIds;
  const moduleIds = Array.isArray(rootModuleIds)
    ? rootModuleIds
    : modules.map((module) => module.id);
  const moduleOrder = new Map(moduleIds.map((id, index) => [id, index]));
  const lessonOrder = new Map<string | undefined, number>();
  for (const module of modules) {
    (module.lessonIds || []).forEach((lessonId, index) => {
      lessonOrder.set(lessonId, index);
    });
  }

  const itemOrder = new Map<string, number>();
  for (const lesson of lessons) {
    const lessonItems = lesson.itemIds || lesson.elementIds || [];
    lessonItems.forEach((itemId, index) => {
      itemOrder.set(itemIdFromPassable(itemId), index);
    });
  }

  const passableByItemId = new Map<string, PassableElement>();
  for (const passable of passables) {
    const itemId = itemIdFromPassable(passable.id);
    if (itemId) passableByItemId.set(itemId, passable);
  }

  const groupByItemId = new Map<string, GroupRequirement>();
  for (const group of passableGroups) {
    const choiceIds: unknown[] = Array.isArray(group.passableItemGroupChoiceIds)
      ? group.passableItemGroupChoiceIds
      : [];
    for (const choiceId of choiceIds) {
      const choice = choiceById.get(choiceId as string);
      for (const rawItemId of choice?.itemIds || []) {
        const itemId = itemIdFromPassable(rawItemId);
        if (!itemId || !choice) continue;
        groupByItemId.set(itemId, {
          name: choice.name || "Assignment choice",
          requiredPassedCount: Number(group.requiredPassedCount) || 0,
          choiceCount: choiceIds.length,
        });
      }
    }
  }

  const hasConfirmedMetadata = passableByItemId.size > 0 || groupByItemId.size > 0;
  const fallbackTypes: Record<string, true> = {
    exam: true,
    quiz: true,
    staffGraded: true,
    gradedProgramming: true,
    peer: true,
    phasedPeer: true,
  };
  const candidateIds = hasConfirmedMetadata
    ? new Set<string | undefined>([...passableByItemId.keys(), ...groupByItemId.keys()])
    : new Set(
        items
          .filter((item) => Object.hasOwn(fallbackTypes, courseItemType(item)))
          .map((item) => item.id),
      );

  const requirements: OrderedRequirement[] = [];
  for (const itemId of candidateIds) {
    const item = itemById.get(itemId);
    if (!item) continue;

    const id = item.id as string;
    const passable = passableByItemId.get(id);
    const group = groupByItemId.get(id) || null;
    const module = moduleById.get(item.moduleId);
    const lesson = lessonById.get(item.lessonId);
    const type = courseItemType(item);
    const route = requirementRoute(type);
    const gradingWeight = Number(passable?.gradingWeight);
    const hasGradingWeight = Number.isFinite(gradingWeight) && gradingWeight > 0;
    const itemSlug = item.slug ? String(item.slug) : "";
    const link =
      route && itemSlug
        ? `https://www.coursera.org/learn/${encodeURIComponent(courseSlug)}/${route}/${encodeURIComponent(id)}/${encodeURIComponent(itemSlug)}`
        : null;

    requirements.push({
      id,
      name: item.name || "Graded activity",
      type,
      moduleName: module?.name || "Other course work",
      lessonName: lesson?.name || "",
      gradingWeight: hasGradingWeight ? gradingWeight : null,
      weightPercent: null,
      requiredForPassing: passable?.isRequiredForPassing === true,
      groupRequirement: group,
      locked: courseItemIsLocked(item),
      lockReason: item.itemLockSummary || item.itemLockedReasonCode || "",
      timeCommitment: Number.isFinite(Number(item.timeCommitment))
        ? Number(item.timeCommitment)
        : null,
      source: passable || group ? "confirmed" : "detected",
      link,
      status: learner
        ? requirementStatus(type, learner.items.get(id), learner.outcomes.get(id))
        : null,
      grade: learner?.outcomes.get(id)?.grade ?? null,
      moduleOrder: moduleOrder.get(item.moduleId) ?? Number.MAX_SAFE_INTEGER,
      lessonOrder: lessonOrder.get(item.lessonId) ?? Number.MAX_SAFE_INTEGER,
      itemOrder: itemOrder.get(id) ?? Number.MAX_SAFE_INTEGER,
    });
  }

  requirements.sort(
    (first, second) =>
      (first.moduleOrder as number) - (second.moduleOrder as number) ||
      (first.lessonOrder as number) - (second.lessonOrder as number) ||
      (first.itemOrder as number) - (second.itemOrder as number) ||
      first.name.localeCompare(second.name),
  );

  const totalGradingWeight = requirements.reduce(
    (total, requirement) => total + (requirement.gradingWeight || 0),
    0,
  );
  const unresolvedCount = Math.max(0, candidateIds.size - requirements.length);
  const gradingWeightsComplete =
    requirements.length > 0 &&
    unresolvedCount === 0 &&
    requirements.every((requirement) => requirement.gradingWeight != null);

  if (gradingWeightsComplete && totalGradingWeight > 0) {
    for (const requirement of requirements) {
      requirement.weightPercent =
        Math.round(((requirement.gradingWeight as number) / totalGradingWeight) * 1000) / 10;
    }
  }

  for (const requirement of requirements) {
    delete requirement.moduleOrder;
    delete requirement.lessonOrder;
    delete requirement.itemOrder;
  }

  return {
    requirements,
    summary: {
      confirmed: hasConfirmedMetadata,
      totalGradingWeight,
      gradingWeightsComplete,
      requiredCount: requirements.filter((requirement) => requirement.requiredForPassing).length,
      lockedCount: requirements.filter((requirement) => requirement.locked).length,
      unmappedCount: requirements.filter((requirement) => !requirement.link).length,
      unresolvedCount,
      completedCount: learner
        ? requirements.filter(({ status }) => status === "passed" || status === "completed").length
        : null,
    },
  };
}
