const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INTERCEPT_SOURCE,
  courseSlugFromUrl,
  normalizeHeaderNames,
  createCourseState
} = require("../coursera-state.js");

function materials(id) {
  return {
    linked: {
      "onDemandCourseMaterialItems.v2": [{ id }]
    }
  };
}

test("extracts course slugs from API query strings and course paths", () => {
  assert.equal(
    courseSlugFromUrl("https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=machine-learning"),
    "machine-learning"
  );
  assert.equal(
    courseSlugFromUrl("https://www.coursera.org/learn/data%20science/home/week/1"),
    "data science"
  );
  assert.equal(
    courseSlugFromUrl("https://www.coursera.org/learn/course-a/home?slug=background-course"),
    "course-a"
  );
  assert.equal(courseSlugFromUrl("https://www.coursera.org/api/me.v1"), "");
});

test("records only allowlisted observed header names, never values", () => {
  assert.deepEqual(
    normalizeHeaderNames([
      ["Authorization", "Bearer secret"],
      ["Cookie", "private"],
      ["X-CSRF3-Token", "token-value"],
      ["X-Requested-With", "XMLHttpRequest"]
    ]).sort(),
    ["x-csrf3-token", "x-requested-with"]
  );
  assert.deepEqual(
    normalizeHeaderNames(["X-CSRF2-Token", "Authorization", "X-Requested-With"]).sort(),
    ["x-csrf2-token", "x-requested-with"]
  );
});

test("scopes cached materials to the active course", () => {
  const state = createCourseState();
  state.setCourseMaterials(materials("item-a"), "course-a");

  assert.equal(state.getCourseMaterials("course-a").linked["onDemandCourseMaterialItems.v2"][0].id, "item-a");
  assert.equal(state.getCourseMaterials("course-b"), null);

  state.setCourseSlug("course-b");
  assert.equal(state.getCourseMaterials("course-a"), null);
  assert.equal(state.snapshot().hasCourseMaterials, false);
  assert.equal(state.snapshot().courseRevision, 2);
});

test("SPA location sync invalidates stale course cache and clears state off course routes", () => {
  const state = createCourseState();
  state.syncLocation("https://www.coursera.org/learn/course-a/home/week/1");
  state.setCourseMaterials(materials("item-a"), "course-a");
  const firstRevision = state.snapshot().courseRevision;

  state.syncLocation("https://www.coursera.org/learn/course-a/quiz/example");
  assert.equal(state.snapshot().courseRevision, firstRevision);
  assert.equal(state.snapshot().hasCourseMaterials, true);

  state.syncLocation("https://www.coursera.org/learn/course-b/home/week/1");
  assert.equal(state.snapshot().courseSlug, "course-b");
  assert.equal(state.snapshot().hasCourseMaterials, false);
  assert.equal(state.snapshot().courseRevision, firstRevision + 1);

  state.syncLocation("https://www.coursera.org/account-settings");
  assert.deepEqual(state.snapshot(), {
    courseSlug: "",
    onCourseRoute: false,
    courseRevision: firstRevision + 2,
    hasCourseMaterials: false,
    observedHeaderNames: [],
    hasUserContext: false
  });
});

test("ingests sanitized interceptor messages without exposing account or header values", () => {
  const state = createCourseState();
  const payload = {
    source: INTERCEPT_SOURCE,
    request: {
      url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=course-a",
      headerNames: ["x-csrf3-token", "authorization"],
      headers: [["x-csrf3-token", "super-secret-token"]]
    },
    response: {
      ...materials("item-1"),
      context: {
        dispatcher: {
          stores: {
            ApplicationStore: {
              userData: { id: 123456 }
            }
          }
        }
      }
    }
  };

  assert.equal(state.ingestInterceptMessage(payload), true);
  const snapshot = state.snapshot();
  const serialized = JSON.stringify(snapshot);

  assert.deepEqual(snapshot, {
    courseSlug: "course-a",
    onCourseRoute: true,
    courseRevision: 1,
    hasCourseMaterials: true,
    observedHeaderNames: ["x-csrf3-token"],
    hasUserContext: true
  });
  assert.equal(serialized.includes("super-secret-token"), false);
  assert.equal(serialized.includes("123456"), false);
});

test("course changes reset observed request and user-context metadata", () => {
  const state = createCourseState();
  state.ingestInterceptMessage({
    source: INTERCEPT_SOURCE,
    request: {
      url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?slug=course-a",
      headerNames: ["x-csrf3-token"]
    },
    response: {
      ...materials("item-a"),
      context: {
        dispatcher: {
          stores: {
            ApplicationStore: {
              userData: { id: 42 }
            }
          }
        }
      }
    }
  }, "https://www.coursera.org/learn/course-a/home");

  assert.deepEqual(state.snapshot().observedHeaderNames, ["x-csrf3-token"]);
  assert.equal(state.snapshot().hasUserContext, true);

  state.syncLocation("https://www.coursera.org/learn/course-b/home");
  assert.deepEqual(state.snapshot().observedHeaderNames, []);
  assert.equal(state.snapshot().hasUserContext, false);
});

test("active page route wins over intercepted background-course traffic", () => {
  const state = createCourseState();
  state.syncLocation("https://www.coursera.org/learn/course-a/home");
  state.setCourseMaterials(materials("item-a"), "course-a");
  const revision = state.snapshot().courseRevision;

  const payload = {
    source: INTERCEPT_SOURCE,
    request: {
      url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?slug=course-b",
      headerNames: ["x-requested-with"]
    },
    response: {
      ...materials("item-b"),
      context: {
        dispatcher: {
          stores: {
            ApplicationStore: {
              userData: { id: 999 }
            }
          }
        }
      }
    }
  };

  assert.equal(
    state.ingestInterceptMessage(payload, "https://www.coursera.org/learn/course-a/quiz/checkpoint"),
    true
  );
  assert.equal(state.snapshot().courseSlug, "course-a");
  assert.equal(state.snapshot().courseRevision, revision);
  assert.deepEqual(state.snapshot().observedHeaderNames, []);
  assert.equal(state.snapshot().hasUserContext, false);
  assert.equal(state.getCourseMaterials("course-a").linked["onDemandCourseMaterialItems.v2"][0].id, "item-a");
  assert.equal(state.getCourseMaterials("course-b"), null);
});

test("active off-course location prevents intercepted traffic from recreating course state or metadata", () => {
  const state = createCourseState();
  state.syncLocation("https://www.coursera.org/learn/course-a/home");

  state.ingestInterceptMessage({
    source: INTERCEPT_SOURCE,
    request: {
      url: "https://www.coursera.org/api/onDemandCourseMaterials.v2/?slug=course-b",
      headerNames: ["x-csrf3-token"]
    },
    response: {
      ...materials("item-b"),
      context: {
        dispatcher: {
          stores: {
            ApplicationStore: {
              userData: { id: 999 }
            }
          }
        }
      }
    }
  }, "https://www.coursera.org/account-settings");

  assert.equal(state.snapshot().courseSlug, "");
  assert.equal(state.snapshot().onCourseRoute, false);
  assert.equal(state.snapshot().hasCourseMaterials, false);
  assert.deepEqual(state.snapshot().observedHeaderNames, []);
  assert.equal(state.snapshot().hasUserContext, false);
});

test("ignores unrelated window messages", () => {
  const state = createCourseState();
  assert.equal(state.ingestInterceptMessage({ source: "some-page-script" }), false);
  assert.deepEqual(state.snapshot(), {
    courseSlug: "",
    onCourseRoute: false,
    courseRevision: 0,
    hasCourseMaterials: false,
    observedHeaderNames: [],
    hasUserContext: false
  });
});
