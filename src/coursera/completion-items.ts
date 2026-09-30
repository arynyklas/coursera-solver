import type { CourseMaterials } from "@/shared/types";

export interface CompletionItem {
  id: string;
  type: string;
  name: string;
}

// Assignment, quiz and widget types that are never auto-completed, as in
// content.js:566 in v1.1.0 (c2f8b71).
export const EXCLUDED_COMPLETION_TYPES: readonly string[] = [
  "quiz",
  "exam",
  "programming",
  "phasedPeer",
  "peer",
  "ungradedAssignment",
  "staffGraded",
  "ungradedWidget",
];

interface MaterialItem {
  id?: string;
  name?: string;
  isLocked?: unknown;
  itemClass?: string;
  contentSummary?: { typeName?: string };
}

// Ported extractVideoAndReadingIds from content.js:554-595 in v1.1.0 (c2f8b71), plus the F5
// locked skip.
export function extractCompletionItems(materials: CourseMaterials): {
  items: CompletionItem[];
  skippedLocked: number;
} {
  const items: CompletionItem[] = [];
  let skippedLocked = 0;

  const linkedItems = materials?.linked?.["onDemandCourseMaterialItems.v2"];
  if (linkedItems) {
    for (const entry of linkedItems) {
      const item = entry as MaterialItem | null | undefined;
      if (!item?.id) continue;
      const type = item.contentSummary?.typeName || item.itemClass || "unknown";
      const name = item.name ?? "";
      const lowerName = name.toLowerCase();
      if (
        EXCLUDED_COMPLETION_TYPES.includes(type) ||
        lowerName.includes("quiz") ||
        lowerName.includes("challenge")
      ) {
        continue;
      }
      if (item.isLocked === true) {
        skippedLocked += 1;
        continue;
      }
      items.push({ id: item.id, type, name });
    }
    return { items, skippedLocked };
  }

  // Fallback for older v1 payloads.
  for (const module of materials?.elements?.[0]?.modules ?? []) {
    for (const lesson of module.lessons ?? []) {
      for (const itemId of lesson.itemIds ?? []) {
        items.push({ id: itemId, type: "unknown", name: "" });
      }
    }
  }

  return { items, skippedLocked };
}
