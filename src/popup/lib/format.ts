/** Ported from legacy `popup.js:357-364`. */
export function formatRequirementTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

/** Ported from legacy `popup.js:366-369`. */
export function formatWeightPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * Ported from legacy `popup.js:378-388`: only https links to `www.coursera.org/learn/…` may be
 * opened; anything else returns `""`.
 */
export function safeCourseRequirementUrl(value: string | null): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      url.hostname === "www.coursera.org" &&
      url.pathname.startsWith("/learn/")
    ) {
      return url.href;
    }
  } catch {
    return "";
  }
  return "";
}

/** `"1 question"`, `"5 questions"`: the count followed by the matching word form. */
export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
