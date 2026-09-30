// Port of legacy/intercept-policy.js. Pure: no globals are assigned and no DOM is touched.

export const CAPTURED_HEADER_NAMES: ReadonlySet<string> = new Set([
  "x-csrf2-cookie",
  "x-csrf2-token",
  "x-csrf3-token",
  "x-csrftoken",
  "x-requested-with",
]);
export const VALUE_HEADER_NAMES: ReadonlySet<string> = new Set(["x-csrf3-token"]);
export const FORWARDED_QUERY_NAMES: ReadonlySet<string> = new Set(["slug", "userId"]);
export const MATERIAL_COLLECTION_FIELDS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "onDemandCourseMaterialModules.v1": Object.freeze(["id", "name", "lessonIds"]),
    "onDemandCourseMaterialLessons.v1": Object.freeze(["id", "name", "itemIds", "elementIds"]),
    "onDemandCourseMaterialItems.v2": Object.freeze([
      "id",
      "moduleId",
      "lessonId",
      "name",
      "slug",
      "timeCommitment",
      "itemClass",
      "contentSummary",
      "isLocked",
      "lockedStatus",
      "itemLockedReasonCode",
      "itemLockSummary",
    ]),
    "onDemandCourseMaterialPassableLessonElements.v1": Object.freeze([
      "id",
      "gradingWeight",
      "isRequiredForPassing",
    ]),
    "onDemandCourseMaterialPassableItemGroups.v1": Object.freeze([
      "id",
      "requiredPassedCount",
      "passableItemGroupChoiceIds",
    ]),
    "onDemandCourseMaterialPassableItemGroupChoices.v1": Object.freeze(["id", "name", "itemIds"]),
  });

export type HeaderEntry = [unknown, unknown];

export interface MinimizedMaterials {
  elements: Array<{ moduleIds: string[] }>;
  linked: Record<string, Array<Record<string, unknown>>>;
}

export interface MinimizedDispatcher {
  context: { dispatcher: { stores: { ApplicationStore: { userData: { id: unknown } } } } };
}

type Indexable = Record<string, unknown>;

function asIndexable(value: unknown): Indexable | undefined {
  return value && typeof value === "object" ? (value as Indexable) : undefined;
}

export function courseraApiUrl(value: unknown, baseUrl = "https://www.coursera.org/"): URL | null {
  try {
    const url = new URL(String(value || ""), baseUrl);
    const hostname = url.hostname.toLowerCase();
    const isCourseraHost = hostname === "coursera.org" || hostname.endsWith(".coursera.org");
    if (!isCourseraHost || !url.pathname.startsWith("/api/")) return null;

    const safeUrl = new URL(`${url.origin}${url.pathname}`);
    for (const name of FORWARDED_QUERY_NAMES) {
      for (const paramValue of url.searchParams.getAll(name)) {
        safeUrl.searchParams.append(name, paramValue);
      }
    }
    return safeUrl;
  } catch {
    return null;
  }
}

export function normalizeCourseraApiUrl(value: unknown, baseUrl?: string): string {
  return courseraApiUrl(value, baseUrl)?.href || "";
}

export function normalizeHeaders(headers: unknown): HeaderEntry[] {
  if (!headers) return [];
  if (Array.isArray(headers)) {
    return headers
      .filter((entry): entry is unknown[] => Array.isArray(entry) && entry.length >= 2)
      .map((entry) => [entry[0], entry[1]]);
  }
  const entries = (headers as { entries?: unknown }).entries;
  if (typeof entries === "function") {
    try {
      return Array.from(entries.call(headers) as Iterable<unknown[]>, (entry) => [
        entry[0],
        entry[1],
      ]);
    } catch {
      return [];
    }
  }
  if (typeof headers === "object") return Object.entries(headers);
  return [];
}

export function observedRequestHeaderNames(headers: unknown): string[] {
  const rawNames: unknown[] =
    Array.isArray(headers) && headers.every((entry) => typeof entry === "string")
      ? headers
      : normalizeHeaders(headers).map(([name]) => name);

  return [
    ...new Set(
      rawNames
        .map((name) => String(name || "").toLowerCase())
        .filter((name) => CAPTURED_HEADER_NAMES.has(name)),
    ),
  ].sort();
}

export function filterRequestHeaders(headers: unknown): [string, string][] {
  const safeHeaders: [string, string][] = [];
  for (const [name, value] of normalizeHeaders(headers)) {
    const normalizedName = String(name).toLowerCase();
    if (!VALUE_HEADER_NAMES.has(normalizedName) || value == null) continue;
    safeHeaders.push([normalizedName, String(value)]);
  }
  return safeHeaders;
}

function pickMaterialFields(entry: unknown, fields: readonly string[]): Record<string, unknown> {
  const source = asIndexable(entry);
  if (!source) return {};
  const safe: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(source, field)) continue;
    if (field === "contentSummary") {
      const typeName = asIndexable(source.contentSummary)?.typeName;
      if (typeName != null) safe.contentSummary = { typeName };
      continue;
    }
    safe[field] = source[field];
  }
  return safe;
}

export function minimizeCourseMaterials(responseBody: unknown): MinimizedMaterials {
  const body = asIndexable(responseBody);
  const linked: MinimizedMaterials["linked"] = {};
  for (const [key, fields] of Object.entries(MATERIAL_COLLECTION_FIELDS)) {
    const collection = asIndexable(body?.linked)?.[key];
    if (!Array.isArray(collection)) continue;
    linked[key] = collection.map((entry) => pickMaterialFields(entry, fields));
  }

  const elements = Array.isArray(body?.elements)
    ? body.elements.map((entry) => {
        const moduleIds = asIndexable(entry)?.moduleIds;
        return { moduleIds: Array.isArray(moduleIds) ? [...moduleIds] : [] };
      })
    : [];

  return { elements, linked };
}

export function minimizeResponse(
  urlValue: unknown,
  responseBody: unknown,
): MinimizedMaterials | MinimizedDispatcher | undefined {
  const url = courseraApiUrl(urlValue);
  const body = asIndexable(responseBody);
  if (!url || !body) return undefined;

  if (url.pathname.includes("onDemandCourseMaterials.v2")) {
    return minimizeCourseMaterials(body);
  }

  const context = asIndexable(body.context);
  const dispatcher = asIndexable(context?.dispatcher);
  const stores = asIndexable(dispatcher?.stores);
  const applicationStore = asIndexable(stores?.ApplicationStore);
  const userId = asIndexable(applicationStore?.userData)?.id;
  if (userId == null) return undefined;

  return {
    context: {
      dispatcher: {
        stores: {
          ApplicationStore: {
            userData: { id: userId },
          },
        },
      },
    },
  };
}

export function shouldEmit(
  urlValue: unknown,
  headerNames: unknown,
  responseBody: unknown,
): boolean {
  const url = courseraApiUrl(urlValue);
  if (!url) return false;

  if (observedRequestHeaderNames(headerNames).length > 0) return true;
  if (responseBody) return true;
  if (
    url.pathname.includes("onDemandCourses.v1") ||
    url.pathname.includes("onDemandCourseMaterials.v2")
  ) {
    return true;
  }
  if (url.searchParams.has("slug") || url.searchParams.has("userId")) return true;
  return /\/user\/\d+/.test(url.pathname);
}
