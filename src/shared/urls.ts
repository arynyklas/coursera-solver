const COURSE_URL = /^https?:\/\/([a-z0-9-]+\.)*coursera\.org\/learn\/[^/?#]+/i;

const ITEM_KINDS: Record<string, string> = {
  home: "course home",
  quiz: "quiz",
  exam: "exam",
  "assignment-submission": "assignment",
  programming: "programming",
  peer: "peer review",
  lecture: "video",
  supplement: "reading",
};

export function isCourseUrl(value: string | undefined): boolean {
  return typeof value === "string" && COURSE_URL.test(value);
}

export function courseSlugFromUrl(value: string | undefined): string {
  try {
    const url = new URL(String(value || ""), "https://www.coursera.org/");
    const slug = url.pathname.match(/\/learn\/([^/]+)/)?.[1];
    if (slug) return decodeURIComponent(slug);
    return url.searchParams.get("slug") || "";
  } catch {
    return "";
  }
}

export function itemKindFromUrl(value: string | undefined): string {
  let segments: string[];
  try {
    segments = new URL(value ?? "").pathname.split("/").filter(Boolean);
  } catch {
    return "";
  }
  if (segments[0] !== "learn" || !segments[1]) return "";
  const kind = segments[2];
  if (!kind) return "course home";
  // hasOwn keeps prototype keys such as "constructor" out of the lookup.
  const known = Object.hasOwn(ITEM_KINDS, kind) ? ITEM_KINDS[kind] : undefined;
  if (known) return known;
  try {
    return decodeURIComponent(kind).replaceAll("-", " ");
  } catch {
    return kind.replaceAll("-", " ");
  }
}
