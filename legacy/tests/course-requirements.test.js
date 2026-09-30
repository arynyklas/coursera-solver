const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  requirementRoute,
  courseItemIsLocked,
  itemIdFromPassable,
  normalizeCourseRequirements
} = require("../course-requirements.js");

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "course-materials-confirmed.json"), "utf8")
);

test("maps known Coursera activity types to stable routes", () => {
  assert.equal(requirementRoute("quiz"), "quiz");
  assert.equal(requirementRoute("exam"), "exam");
  assert.equal(requirementRoute("gradedProgramming"), "programming");
  assert.equal(requirementRoute("unknown"), "");
});

test("normalizes passable identifiers", () => {
  assert.equal(itemIdFromPassable("course~lesson~item-123"), "item-123");
  assert.equal(itemIdFromPassable("item-123"), "item-123");
  assert.equal(itemIdFromPassable(""), "");
});

test("detects locked states conservatively", () => {
  assert.equal(courseItemIsLocked({ isLocked: true }), true);
  assert.equal(courseItemIsLocked({ lockedStatus: "locked_prerequisite" }), true);
  assert.equal(courseItemIsLocked({ lockedStatus: "available" }), false);
  assert.equal(courseItemIsLocked({}), false);
});

test("normalizes confirmed course requirements from a sanitized fixture", () => {
  const result = normalizeCourseRequirements(fixture, "sample-course");

  assert.equal(result.requirements.length, 2);
  assert.equal(result.summary.confirmed, true);
  assert.equal(result.summary.totalGradingWeight, 4);
  assert.equal(result.summary.gradingWeightsComplete, true);
  assert.equal(result.summary.requiredCount, 1);
  assert.equal(result.summary.lockedCount, 1);
  assert.equal(result.summary.unresolvedCount, 0);

  const quiz = result.requirements.find((item) => item.id === "quiz-1");
  const exam = result.requirements.find((item) => item.id === "exam-1");

  assert.equal(quiz.weightPercent, 25);
  assert.equal(exam.weightPercent, 75);
  assert.equal(exam.requiredForPassing, true);
  assert.equal(exam.locked, true);
  assert.match(quiz.link, /\/learn\/sample-course\/quiz\/quiz-1\/practice-checkpoint$/);
  assert.match(exam.link, /\/learn\/sample-course\/exam\/exam-1\/module-assessment$/);
});

test("does not invent percentages from partial grading-weight metadata", () => {
  const partialFixture = structuredClone(fixture);
  const passables = partialFixture.linked["onDemandCourseMaterialPassableLessonElements.v1"];
  delete passables[1].gradingWeight;

  const result = normalizeCourseRequirements(partialFixture, "sample-course");
  const quiz = result.requirements.find((item) => item.id === "quiz-1");
  const exam = result.requirements.find((item) => item.id === "exam-1");

  assert.equal(result.summary.totalGradingWeight, 1);
  assert.equal(result.summary.gradingWeightsComplete, false);
  assert.equal(quiz.weightPercent, null);
  assert.equal(exam.weightPercent, null);
});

test("encodes course and item slugs exactly once", () => {
  const encodedFixture = structuredClone(fixture);
  encodedFixture.linked["onDemandCourseMaterialItems.v2"][0].slug = "checkpoint one/α";
  const result = normalizeCourseRequirements(encodedFixture, "sample course");
  const quiz = result.requirements.find((item) => item.id === "quiz-1");

  assert.equal(
    quiz.link,
    "https://www.coursera.org/learn/sample%20course/quiz/quiz-1/checkpoint%20one%2F%CE%B1"
  );
  assert.equal(quiz.link.includes("%252F"), false);
});

test("falls back to grade-relevant item types when passable metadata is absent", () => {
  const materials = {
    elements: [{ moduleIds: ["module"] }],
    linked: {
      "onDemandCourseMaterialModules.v1": [{ id: "module", name: "M", lessonIds: ["lesson"] }],
      "onDemandCourseMaterialLessons.v1": [{ id: "lesson", name: "L", itemIds: ["x~quiz", "x~video"] }],
      "onDemandCourseMaterialItems.v2": [
        { id: "quiz", moduleId: "module", lessonId: "lesson", name: "Quiz", slug: "quiz", contentSummary: { typeName: "quiz" } },
        { id: "video", moduleId: "module", lessonId: "lesson", name: "Video", slug: "video", contentSummary: { typeName: "lecture" } }
      ]
    }
  };

  const result = normalizeCourseRequirements(materials, "sample");
  assert.equal(result.summary.confirmed, false);
  assert.equal(result.summary.gradingWeightsComplete, false);
  assert.deepEqual(result.requirements.map((item) => item.id), ["quiz"]);
  assert.equal(result.requirements[0].source, "detected");
});
