import { describe, expect, it } from "vitest";
import { extractCompletionItems } from "@/coursera/completion-items";

describe("extractCompletionItems", () => {
  // F5: guards legacy content.js:566-575, which queued locked items because it ignored isLocked.
  it("skips locked items and counts them, keeping the quiz exclusions", () => {
    const result = extractCompletionItems({
      linked: {
        "onDemandCourseMaterialItems.v2": [
          { id: "lecture-1", name: "Welcome", contentSummary: { typeName: "lecture" } },
          { id: "reading-1", name: "Syllabus", isLocked: true, itemClass: "supplement" },
          { id: "quiz-1", name: "Practice", contentSummary: { typeName: "quiz" } },
          { id: "lecture-2", name: "Challenge quiz", contentSummary: { typeName: "lecture" } },
        ],
      },
    });

    expect(result).toEqual({
      items: [{ id: "lecture-1", type: "lecture", name: "Welcome" }],
      skippedLocked: 1,
    });
  });

  it("walks module lessons as unknown items when linked items are absent", () => {
    const result = extractCompletionItems({
      elements: [
        {
          modules: [
            { lessons: [{ itemIds: ["a", "b"] }, {}] },
            { lessons: [{ itemIds: ["c"] }] },
            {},
          ],
        },
      ],
    });

    expect(result).toEqual({
      items: [
        { id: "a", type: "unknown", name: "" },
        { id: "b", type: "unknown", name: "" },
        { id: "c", type: "unknown", name: "" },
      ],
      skippedLocked: 0,
    });
  });
});
