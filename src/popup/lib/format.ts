/** Ported from `popup.js:357-364` in v1.1.0 (c2f8b71). */
export function formatRequirementTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
}

/** Ported from `popup.js:366-369` in v1.1.0 (c2f8b71). */
export function formatWeightPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * A grade fraction as Coursera's Grades page prints it (its FormattedPercent): `"80"` for 0.8,
 * `"83.33"` for 0.83333, two decimals whenever the percentage is not whole.
 */
export function formatGradePercent(grade: number | null): string {
  if (grade === null || !Number.isFinite(grade)) return "";
  const percent = Math.round(grade * 10000) / 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(2);
}

/**
 * Ported from `popup.js:378-388` in v1.1.0 (c2f8b71): only https links to
 * `www.coursera.org/learn/…` may be opened; anything else returns `""`.
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
