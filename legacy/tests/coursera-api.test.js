const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MATERIAL_FIELDS,
  courseSlugFromPath,
  buildCourseMaterialsUrl,
  hasSupportedCourseMaterials,
  courseMaterialsError
} = require("../coursera-api.js");

test("extracts and decodes a course slug from Coursera paths", () => {
  assert.equal(courseSlugFromPath("/learn/sample-course/home/week/1"), "sample-course");
  assert.equal(courseSlugFromPath("/learn/data%20course/quiz/1"), "data course");
  assert.equal(courseSlugFromPath("/professional-certificates/sample"), "");
});

test("builds the course materials endpoint with required fields", () => {
  const url = new URL(buildCourseMaterialsUrl("sample-course"));
  assert.equal(url.origin, "https://www.coursera.org");
  assert.equal(url.pathname, "/api/onDemandCourseMaterials.v2/");
  assert.equal(url.searchParams.get("q"), "slug");
  assert.equal(url.searchParams.get("slug"), "sample-course");
  assert.equal(url.searchParams.get("showLockedItems"), "true");
  for (const field of MATERIAL_FIELDS) {
    assert.match(url.searchParams.get("fields"), new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const fields = url.searchParams.get("fields");
  for (const requiredItemField of ["moduleId", "lessonId", "itemClass", "contentSummary"]) {
    assert.match(fields, new RegExp(`onDemandCourseMaterialItems\\.v2\\([^)]*${requiredItemField}`));
  }
});

test("rejects empty course slugs", () => {
  assert.throws(() => buildCourseMaterialsUrl(""), /course slug is required/i);
});

test("validates the expected linked item collection", () => {
  assert.equal(hasSupportedCourseMaterials({ linked: { "onDemandCourseMaterialItems.v2": [] } }), true);
  assert.equal(hasSupportedCourseMaterials({ linked: {} }), false);
  assert.equal(hasSupportedCourseMaterials(null), false);
});

test("returns useful authorization and HTTP errors", () => {
  assert.match(courseMaterialsError(401), /authorize/i);
  assert.match(courseMaterialsError(403), /authorize/i);
  assert.match(courseMaterialsError(500), /HTTP 500/);
});
