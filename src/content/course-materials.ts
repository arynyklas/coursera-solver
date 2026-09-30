import {
  buildCourseMaterialsUrl,
  courseMaterialsError,
  hasSupportedCourseMaterials,
} from "@/coursera/api";
import type { CourseState } from "@/coursera/course-state";
import type { CourseMaterials } from "@/shared/types";

export interface CourseMaterialsDeps {
  state: CourseState;
  fetch: typeof fetch;
  location(): string;
}

// Port of content-adapters.js:62-97 in v1.1.0 (c2f8b71); captured materials already reach
// the state cache.
export async function loadCourseMaterials({
  state,
  fetch,
  location,
}: CourseMaterialsDeps): Promise<CourseMaterials> {
  const slug = state.syncLocation(location());
  if (!slug) throw new Error("Open a Coursera course page first.");

  const cached = state.getCourseMaterials(slug);
  if (cached) return cached;

  const response = await fetch(buildCourseMaterialsUrl(slug), { credentials: "include" });
  if (!response.ok) throw new Error(courseMaterialsError(response.status));

  const materials: unknown = await response.json();
  if (!hasSupportedCourseMaterials(materials)) {
    throw new Error("Coursera returned course materials in an unsupported format.");
  }

  if (state.syncLocation(location()) !== slug) {
    throw new Error(
      "The open Coursera course changed while its materials were loading. Try again.",
    );
  }

  return state.setCourseMaterials(materials as CourseMaterials, slug);
}
