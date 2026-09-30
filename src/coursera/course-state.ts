import type { Capture, CaptureSnapshot } from "@/shared/bridge";
import type { CourseMaterials, CourseStateSnapshot } from "@/shared/types";
import { courseSlugFromUrl } from "@/shared/urls";

export const OBSERVED_HEADER_NAMES: ReadonlySet<string> = new Set([
  "x-csrf2-cookie",
  "x-csrf2-token",
  "x-csrf3-token",
  "x-csrftoken",
  "x-requested-with",
]);

export interface CourseState {
  setCourseSlug(nextSlug: string | null | undefined): string;
  clearCourse(): boolean;
  syncLocation(url: string | undefined): string;
  setCourseMaterials(materials: CourseMaterials, slug?: string): CourseMaterials;
  getCourseMaterials(slug?: string): CourseMaterials | null;
  ingestCapture(capture: Capture, activeLocation?: string): void;
  ingestSnapshot(snapshot: CaptureSnapshot, activeLocation: string): void;
  snapshot(): CourseStateSnapshot;
}

// Accepts header names, `[name, value]` entries or a header object; only names are kept.
export function normalizeHeaderNames(headers: unknown): string[] {
  const entries: unknown[] = Array.isArray(headers)
    ? headers
    : headers && typeof headers === "object"
      ? Object.entries(headers)
      : [];

  return entries
    .map((entry) => {
      if (typeof entry === "string") return entry;
      return Array.isArray(entry) && entry.length >= 1 ? entry[0] : "";
    })
    .map((name) => String(name || "").toLowerCase())
    .filter((name) => OBSERVED_HEADER_NAMES.has(name));
}

export function hasSupportedMaterials(materials: unknown): materials is CourseMaterials {
  return Array.isArray(
    (materials as CourseMaterials | null | undefined)?.linked?.["onDemandCourseMaterialItems.v2"],
  );
}

export function createCourseState(): CourseState {
  let courseSlug = "";
  let materials: CourseMaterials | null = null;
  let materialsSlug = "";
  let observedHeaderNames = new Set<string>();
  let observedUserContext = false;
  let courseRevision = 0;

  function invalidateMaterials(): void {
    materials = null;
    materialsSlug = "";
  }

  function resetObservations(): void {
    observedHeaderNames = new Set();
    observedUserContext = false;
  }

  function recordHeaderNames(headerNames: unknown): void {
    for (const name of normalizeHeaderNames(headerNames)) observedHeaderNames.add(name);
  }

  function setCourseSlug(nextSlug: string | null | undefined): string {
    const normalized = String(nextSlug || "").trim();
    if (!normalized) return courseSlug;
    if (normalized === courseSlug) return courseSlug;

    courseSlug = normalized;
    courseRevision += 1;
    resetObservations();
    if (materialsSlug && materialsSlug !== normalized) invalidateMaterials();
    return courseSlug;
  }

  function clearCourse(): boolean {
    const hadCourseState = Boolean(courseSlug || materials || materialsSlug);
    courseSlug = "";
    invalidateMaterials();
    resetObservations();
    if (hadCourseState) courseRevision += 1;
    return hadCourseState;
  }

  function syncLocation(value: string | undefined): string {
    const nextSlug = courseSlugFromUrl(value);
    if (!nextSlug) {
      clearCourse();
      return "";
    }
    return setCourseSlug(nextSlug);
  }

  function setCourseMaterials(nextMaterials: CourseMaterials, slug?: string): CourseMaterials {
    if (!hasSupportedMaterials(nextMaterials)) {
      throw new Error("Unsupported Coursera course materials payload.");
    }
    const normalizedSlug = String(slug || courseSlug || "").trim();
    if (!normalizedSlug) throw new Error("A course slug is required to cache course materials.");

    setCourseSlug(normalizedSlug);
    materialsSlug = normalizedSlug;
    materials = nextMaterials;
    return materials;
  }

  function getCourseMaterials(slug?: string): CourseMaterials | null {
    const normalizedSlug = String(slug || courseSlug || "").trim();
    if (!normalizedSlug || normalizedSlug !== materialsSlug) return null;
    return materials;
  }

  function ingestCapture(capture: Capture, activeLocation?: string): void {
    const requestSlug = courseSlugFromUrl(capture.url || "");
    const hasActiveLocation = activeLocation !== undefined;
    const activeSlug = hasActiveLocation ? courseSlugFromUrl(activeLocation) : "";

    if (hasActiveLocation) {
      if (!activeSlug) {
        clearCourse();
        return;
      }
      setCourseSlug(activeSlug);
      if (requestSlug && requestSlug !== activeSlug) return;
    } else if (requestSlug) {
      setCourseSlug(requestSlug);
    }

    recordHeaderNames(capture.headerNames);

    if (capture.userId) observedUserContext = true;

    const cacheSlug = hasActiveLocation ? activeSlug : requestSlug;
    if (
      hasSupportedMaterials(capture.materials) &&
      requestSlug &&
      cacheSlug &&
      requestSlug === cacheSlug
    ) {
      setCourseMaterials(capture.materials, cacheSlug);
    }
  }

  function ingestSnapshot(captured: CaptureSnapshot, activeLocation: string): void {
    const activeSlug = courseSlugFromUrl(activeLocation);
    if (!activeSlug) {
      clearCourse();
      return;
    }

    syncLocation(activeLocation);
    recordHeaderNames(captured.headerNames);
    if (captured.userId) observedUserContext = true;

    const capturedMaterials = captured.materials;
    if (
      capturedMaterials &&
      courseSlugFromUrl(capturedMaterials.url) === activeSlug &&
      hasSupportedMaterials(capturedMaterials.data)
    ) {
      setCourseMaterials(capturedMaterials.data, activeSlug);
    }
  }

  function snapshot(): CourseStateSnapshot {
    return {
      courseSlug,
      onCourseRoute: Boolean(courseSlug),
      courseRevision,
      hasCourseMaterials: Boolean(materials && materialsSlug === courseSlug),
      observedHeaderNames: [...observedHeaderNames].sort(),
      hasUserContext: observedUserContext,
    };
  }

  return Object.freeze({
    setCourseSlug,
    clearCourse,
    syncLocation,
    setCourseMaterials,
    getCourseMaterials,
    ingestCapture,
    ingestSnapshot,
    snapshot,
  });
}
