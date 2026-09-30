(function (root, factory) {
  const api = factory();
  root.CourseRequirementsKit = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function linkedCourseCollection(materials, key) {
    const collection = materials?.linked?.[key];
    return Array.isArray(collection) ? collection : [];
  }

  function requirementRoute(type) {
    return {
      exam: "exam",
      quiz: "quiz",
      staffGraded: "assignment-submission",
      ungradedAssignment: "assignment-submission",
      peer: "peer",
      phasedPeer: "peer",
      programming: "programming",
      gradedProgramming: "programming"
    }[type] || "";
  }

  function courseItemType(item) {
    return item?.contentSummary?.typeName || item?.itemClass || "unknown";
  }

  function courseItemIsLocked(item) {
    if (item?.isLocked === true) return true;
    const status = String(item?.lockedStatus || "").trim().toLowerCase();
    if (!status || ["unlocked", "not_locked", "available"].includes(status)) return false;
    return status === "locked" || status.startsWith("locked_") || status.startsWith("hard_locked");
  }

  function itemIdFromPassable(passableId) {
    const parts = String(passableId || "").split("~").filter(Boolean);
    return parts.at(-1) || "";
  }

  function normalizeCourseRequirements(materials, courseSlug) {
    const items = linkedCourseCollection(materials, "onDemandCourseMaterialItems.v2");
    const modules = linkedCourseCollection(materials, "onDemandCourseMaterialModules.v1");
    const lessons = linkedCourseCollection(materials, "onDemandCourseMaterialLessons.v1");
    const passables = linkedCourseCollection(materials, "onDemandCourseMaterialPassableLessonElements.v1");
    const passableGroups = linkedCourseCollection(materials, "onDemandCourseMaterialPassableItemGroups.v1");
    const passableChoices = linkedCourseCollection(materials, "onDemandCourseMaterialPassableItemGroupChoices.v1");

    const itemById = new Map(items.map((item) => [item.id, item]));
    const moduleById = new Map(modules.map((module) => [module.id, module]));
    const lessonById = new Map(lessons.map((lesson) => [lesson.id, lesson]));
    const choiceById = new Map(passableChoices.map((choice) => [choice.id, choice]));

    const rootModuleIds = Array.isArray(materials?.elements?.[0]?.moduleIds)
      ? materials.elements[0].moduleIds
      : modules.map((module) => module.id);
    const moduleOrder = new Map(rootModuleIds.map((id, index) => [id, index]));
    const lessonOrder = new Map();
    modules.forEach((module) => {
      (module.lessonIds || []).forEach((lessonId, index) => lessonOrder.set(lessonId, index));
    });

    const itemOrder = new Map();
    lessons.forEach((lesson) => {
      const lessonItems = lesson.itemIds || lesson.elementIds || [];
      lessonItems.forEach((itemId, index) => itemOrder.set(itemIdFromPassable(itemId), index));
    });

    const passableByItemId = new Map();
    passables.forEach((passable) => {
      const itemId = itemIdFromPassable(passable.id);
      if (itemId) passableByItemId.set(itemId, passable);
    });

    const groupByItemId = new Map();
    passableGroups.forEach((group) => {
      const choiceIds = Array.isArray(group.passableItemGroupChoiceIds)
        ? group.passableItemGroupChoiceIds
        : [];
      choiceIds.forEach((choiceId) => {
        const choice = choiceById.get(choiceId);
        (choice?.itemIds || []).forEach((rawItemId) => {
          const itemId = itemIdFromPassable(rawItemId);
          if (!itemId) return;
          groupByItemId.set(itemId, {
            name: choice.name || "Assignment choice",
            requiredPassedCount: Number(group.requiredPassedCount) || 0,
            choiceCount: choiceIds.length
          });
        });
      });
    });

    const hasConfirmedMetadata = passableByItemId.size > 0 || groupByItemId.size > 0;
    const fallbackTypes = new Set(["exam", "quiz", "staffGraded", "gradedProgramming", "peer", "phasedPeer"]);
    const candidateIds = hasConfirmedMetadata
      ? new Set([...passableByItemId.keys(), ...groupByItemId.keys()])
      : new Set(items.filter((item) => fallbackTypes.has(courseItemType(item))).map((item) => item.id));

    const requirements = [];
    candidateIds.forEach((itemId) => {
      const item = itemById.get(itemId);
      if (!item) return;

      const passable = passableByItemId.get(itemId);
      const group = groupByItemId.get(itemId) || null;
      const module = moduleById.get(item.moduleId);
      const lesson = lessonById.get(item.lessonId);
      const type = courseItemType(item);
      const route = requirementRoute(type);
      const gradingWeight = Number(passable?.gradingWeight);
      const hasGradingWeight = Number.isFinite(gradingWeight) && gradingWeight > 0;
      const itemSlug = item.slug ? String(item.slug) : "";
      const link = route && itemSlug
        ? `https://www.coursera.org/learn/${encodeURIComponent(courseSlug)}/${route}/${encodeURIComponent(item.id)}/${encodeURIComponent(itemSlug)}`
        : null;

      requirements.push({
        id: item.id,
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
        timeCommitment: Number.isFinite(Number(item.timeCommitment)) ? Number(item.timeCommitment) : null,
        source: passable || group ? "confirmed" : "detected",
        link,
        moduleOrder: moduleOrder.get(item.moduleId) ?? Number.MAX_SAFE_INTEGER,
        lessonOrder: lessonOrder.get(item.lessonId) ?? Number.MAX_SAFE_INTEGER,
        itemOrder: itemOrder.get(item.id) ?? Number.MAX_SAFE_INTEGER
      });
    });

    requirements.sort((first, second) => (
      first.moduleOrder - second.moduleOrder ||
      first.lessonOrder - second.lessonOrder ||
      first.itemOrder - second.itemOrder ||
      first.name.localeCompare(second.name)
    ));

    const totalGradingWeight = requirements.reduce(
      (total, requirement) => total + (requirement.gradingWeight || 0),
      0
    );
    const unresolvedCount = Math.max(0, candidateIds.size - requirements.length);
    const gradingWeightsComplete = (
      requirements.length > 0 &&
      unresolvedCount === 0 &&
      requirements.every((requirement) => requirement.gradingWeight != null)
    );

    if (gradingWeightsComplete && totalGradingWeight > 0) {
      requirements.forEach((requirement) => {
        requirement.weightPercent = Math.round((requirement.gradingWeight / totalGradingWeight) * 1000) / 10;
      });
    }

    requirements.forEach((requirement) => {
      delete requirement.moduleOrder;
      delete requirement.lessonOrder;
      delete requirement.itemOrder;
    });

    return {
      requirements,
      summary: {
        confirmed: hasConfirmedMetadata,
        totalGradingWeight,
        gradingWeightsComplete,
        requiredCount: requirements.filter((requirement) => requirement.requiredForPassing).length,
        lockedCount: requirements.filter((requirement) => requirement.locked).length,
        unmappedCount: requirements.filter((requirement) => !requirement.link).length,
        unresolvedCount
      }
    };
  }

  return {
    linkedCourseCollection,
    requirementRoute,
    courseItemType,
    courseItemIsLocked,
    itemIdFromPassable,
    normalizeCourseRequirements
  };
});
