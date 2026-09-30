const test = require("node:test");
const assert = require("node:assert/strict");
const {
  filterRequestHeaders,
  observedRequestHeaderNames,
  minimizeCourseMaterials,
  minimizeResponse,
  normalizeCourseraApiUrl,
  shouldEmit
} = require("../intercept-policy.js");

test("accepts only Coursera API URLs and forwards allowlisted query metadata", () => {
  assert.equal(
    normalizeCourseraApiUrl(
      "/api/onDemandCourses.v1?q=slug&slug=test&email=private%40example.com&token=secret",
      "https://www.coursera.org/learn/test"
    ),
    "https://www.coursera.org/api/onDemandCourses.v1?slug=test"
  );
  assert.equal(
    normalizeCourseraApiUrl("https://www.coursera.org/api/foo?userId=123&search=private"),
    "https://www.coursera.org/api/foo?userId=123"
  );
  assert.equal(normalizeCourseraApiUrl("https://api.openai.com/v1/models"), "");
  assert.equal(normalizeCourseraApiUrl("https://www.coursera.org/learn/test"), "");
});

test("forwards only the CSRF3 value while retaining safe observed header names", () => {
  const headers = [
    ["Authorization", "Bearer secret"],
    ["Cookie", "session=secret"],
    ["X-CSRF2-Token", "csrf2-secret"],
    ["X-CSRF3-Token", "csrf3-value"],
    ["X-Requested-With", "XMLHttpRequest"],
    ["Content-Type", "application/json"]
  ];

  assert.deepEqual(filterRequestHeaders(headers), [
    ["x-csrf3-token", "csrf3-value"]
  ]);
  assert.deepEqual(observedRequestHeaderNames(headers), [
    "x-csrf2-token",
    "x-csrf3-token",
    "x-requested-with"
  ]);
});

test("course-material responses retain only fields consumed by the read runtime", () => {
  const materials = {
    elements: [{ moduleIds: ["module-1"], privateRootField: "hidden" }],
    linked: {
      "onDemandCourseMaterialModules.v1": [
        { id: "module-1", name: "Module", lessonIds: ["lesson-1"], privateModuleField: "hidden" }
      ],
      "onDemandCourseMaterialItems.v2": [
        {
          id: "item-1",
          moduleId: "module-1",
          lessonId: "lesson-1",
          name: "Item",
          slug: "item",
          contentSummary: { typeName: "quiz", privateSummary: "hidden" },
          privateItemField: "hidden"
        }
      ],
      "privateCollection.v1": [{ secret: "hidden" }]
    },
    privatePayload: "hidden"
  };

  assert.deepEqual(minimizeCourseMaterials(materials), {
    elements: [{ moduleIds: ["module-1"] }],
    linked: {
      "onDemandCourseMaterialModules.v1": [
        { id: "module-1", name: "Module", lessonIds: ["lesson-1"] }
      ],
      "onDemandCourseMaterialItems.v2": [
        {
          id: "item-1",
          moduleId: "module-1",
          lessonId: "lesson-1",
          name: "Item",
          slug: "item",
          contentSummary: { typeName: "quiz" }
        }
      ]
    }
  });

  const minimized = minimizeResponse(
    "https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=course",
    materials
  );
  assert.equal(JSON.stringify(minimized).includes("hidden"), false);
  assert.equal(minimized.linked["onDemandCourseMaterialItems.v2"][0].id, "item-1");
});

test("minimizes dispatcher responses to the learner identifier only", () => {
  const response = {
    context: {
      dispatcher: {
        stores: {
          ApplicationStore: {
            userData: { id: 123, email: "hidden@example.com", name: "Hidden" }
          },
          OtherStore: { secret: "hidden" }
        }
      }
    },
    privatePayload: "hidden"
  };

  assert.deepEqual(
    minimizeResponse("https://www.coursera.org/api/someEndpoint.v1", response),
    {
      context: {
        dispatcher: {
          stores: {
            ApplicationStore: {
              userData: { id: 123 }
            }
          }
        }
      }
    }
  );
});

test("emits only API events useful to the extension", () => {
  assert.equal(shouldEmit("https://www.coursera.org/api/foo", [], undefined), false);
  assert.equal(shouldEmit("https://www.coursera.org/api/foo?slug=course", [], undefined), true);
  assert.equal(shouldEmit("https://www.coursera.org/api/foo", ["x-requested-with"], undefined), true);
  assert.equal(shouldEmit("https://example.com/api/foo?slug=course", ["x-csrf3-token"], {}), false);
});
