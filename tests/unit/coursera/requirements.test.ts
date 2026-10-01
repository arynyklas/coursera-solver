import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  courseItemIsLocked,
  itemIdFromPassable,
  normalizeCourseRequirements,
  requirementRoute,
} from "@/coursera/requirements";
import type { CourseMaterials } from "@/shared/types";

type Entry = Record<string, unknown>;
type Fixture = CourseMaterials & {
  linked: {
    "onDemandCourseMaterialItems.v2": Entry[];
    "onDemandCourseMaterialPassableLessonElements.v1": Entry[];
  };
};

const fixture = JSON.parse(
  readFileSync("tests/fixtures/course-materials-confirmed.json", "utf8"),
) as Fixture;

// Ported from tests/course-requirements.test.js in v1.1.0 (c2f8b71).
describe("course requirements", () => {
  it("maps known Coursera activity types to stable routes", () => {
    expect(requirementRoute("quiz")).toBe("quiz");
    expect(requirementRoute("exam")).toBe("exam");
    expect(requirementRoute("gradedProgramming")).toBe("programming");
    expect(requirementRoute("unknown")).toBe("");
  });

  it("normalizes passable identifiers", () => {
    expect(itemIdFromPassable("course~lesson~item-123")).toBe("item-123");
    expect(itemIdFromPassable("item-123")).toBe("item-123");
    expect(itemIdFromPassable("")).toBe("");
  });

  it("detects locked states conservatively", () => {
    expect(courseItemIsLocked({ isLocked: true })).toBe(true);
    expect(courseItemIsLocked({ lockedStatus: "locked_prerequisite" })).toBe(true);
    expect(courseItemIsLocked({ lockedStatus: "available" })).toBe(false);
    expect(courseItemIsLocked({})).toBe(false);
  });

  it("normalizes confirmed course requirements from a sanitized fixture", () => {
    const result = normalizeCourseRequirements(fixture, "sample-course");

    expect(result.requirements).toHaveLength(2);
    expect(result.summary.confirmed).toBe(true);
    expect(result.summary.totalGradingWeight).toBe(4);
    expect(result.summary.gradingWeightsComplete).toBe(true);
    expect(result.summary.requiredCount).toBe(1);
    expect(result.summary.lockedCount).toBe(1);
    expect(result.summary.unresolvedCount).toBe(0);

    const quiz = result.requirements.find((item) => item.id === "quiz-1");
    const exam = result.requirements.find((item) => item.id === "exam-1");

    expect(quiz?.weightPercent).toBe(25);
    expect(exam?.weightPercent).toBe(75);
    expect(exam?.requiredForPassing).toBe(true);
    expect(exam?.locked).toBe(true);
    expect(quiz?.link).toMatch(/\/learn\/sample-course\/quiz\/quiz-1\/practice-checkpoint$/);
    expect(exam?.link).toMatch(/\/learn\/sample-course\/exam\/exam-1\/module-assessment$/);
  });

  it("reports the learner's progress on each requirement", () => {
    const result = normalizeCourseRequirements(
      fixture,
      "sample-course",
      new Map([
        ["quiz-1", "Completed"],
        ["exam-1", "Started"],
      ]),
    );
    expect(result.requirements.map(({ id, status }) => [id, status])).toEqual([
      ["quiz-1", "completed"],
      ["exam-1", "started"],
    ]);
    expect(result.summary.completedCount).toBe(1);

    const untouched = normalizeCourseRequirements(fixture, "sample-course", new Map());
    expect(untouched.requirements.map(({ status }) => status)).toEqual([
      "notStarted",
      "notStarted",
    ]);
    expect(untouched.summary.completedCount).toBe(0);
  });

  it("leaves the status unknown when the learner's progress was not read", () => {
    const result = normalizeCourseRequirements(fixture, "sample-course");

    expect(result.requirements.map(({ status }) => status)).toEqual([null, null]);
    expect(result.summary.completedCount).toBeNull();
  });

  it("does not invent percentages from partial grading-weight metadata", () => {
    const partialFixture = structuredClone(fixture);
    const [, examPassable] =
      partialFixture.linked["onDemandCourseMaterialPassableLessonElements.v1"];
    delete examPassable?.gradingWeight;

    const result = normalizeCourseRequirements(partialFixture, "sample-course");
    const quiz = result.requirements.find((item) => item.id === "quiz-1");
    const exam = result.requirements.find((item) => item.id === "exam-1");

    expect(result.summary.totalGradingWeight).toBe(1);
    expect(result.summary.gradingWeightsComplete).toBe(false);
    expect(quiz?.weightPercent).toBeNull();
    expect(exam?.weightPercent).toBeNull();
  });

  it("encodes course and item slugs exactly once", () => {
    const encodedFixture = structuredClone(fixture);
    const [quizItem] = encodedFixture.linked["onDemandCourseMaterialItems.v2"];
    if (quizItem) quizItem.slug = "checkpoint one/α";
    const result = normalizeCourseRequirements(encodedFixture, "sample course");
    const quiz = result.requirements.find((item) => item.id === "quiz-1");

    expect(quiz?.link).toBe(
      "https://www.coursera.org/learn/sample%20course/quiz/quiz-1/checkpoint%20one%2F%CE%B1",
    );
    expect(quiz?.link?.includes("%252F")).toBe(false);
  });

  it("falls back to grade-relevant item types when passable metadata is absent", () => {
    const materials: CourseMaterials = {
      elements: [{ moduleIds: ["module"] }],
      linked: {
        "onDemandCourseMaterialModules.v1": [{ id: "module", name: "M", lessonIds: ["lesson"] }],
        "onDemandCourseMaterialLessons.v1": [
          { id: "lesson", name: "L", itemIds: ["x~quiz", "x~video"] },
        ],
        "onDemandCourseMaterialItems.v2": [
          {
            id: "quiz",
            moduleId: "module",
            lessonId: "lesson",
            name: "Quiz",
            slug: "quiz",
            contentSummary: { typeName: "quiz" },
          },
          {
            id: "video",
            moduleId: "module",
            lessonId: "lesson",
            name: "Video",
            slug: "video",
            contentSummary: { typeName: "lecture" },
          },
        ],
      },
    };

    const result = normalizeCourseRequirements(materials, "sample");
    expect(result.summary.confirmed).toBe(false);
    expect(result.summary.gradingWeightsComplete).toBe(false);
    expect(result.requirements.map((item) => item.id)).toEqual(["quiz"]);
    expect(result.requirements[0]?.source).toBe("detected");
  });
});
