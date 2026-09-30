import type { BannerController } from "@/content/banner/store";
import {
  buildCompletionMaterialsUrl,
  buildCourseProgressUrl,
  buildLectureCompletionUrl,
  buildWidgetProgressUrl,
  buildWidgetSessionUrl,
  completedItemIds,
  courseMaterialsError,
  SUPPLEMENT_COMPLETION_URL,
  supplementCompletionBody,
  widgetSessionId,
} from "@/coursera/api";
import { type CompletionItem, extractCompletionItems } from "@/coursera/completion-items";
import type { SessionCredentials } from "@/coursera/session";
import { errorMessage } from "@/shared/messaging";
import type { CourseMaterials } from "@/shared/types";
import { courseSlugFromUrl } from "@/shared/urls";

export const COMPLETION_BUSY_MESSAGE = "Course completion is already running on this page.";
const MISSING_TOKEN_MESSAGE =
  "Missing Auth Token! Please click around the course (e.g., refresh or open a new video) to grab background security tokens.";
const MISSING_COURSE_MESSAGE =
  "Missing Course ID! Please go to the main course page to grab your Course ID.";
const CHUNK_SIZE = 6;
const CHUNK_DELAY_MS = 400;
const REQUESTED_TYPES: readonly string[] = ["lecture", "unknown", "supplement", "ungradedWidget"];

export interface CompletionSummary {
  total: number;
  completed: number;
  failed: number;
  skippedLocked: number;
  alreadyCompleted: number;
}

export interface CompletionDeps {
  location(): string;
  session: { get(): SessionCredentials };
  fetch: typeof fetch;
  banner: BannerController;
  delay(ms: number): Promise<void>;
}

export interface CompletionRunner {
  start(): { done: Promise<CompletionSummary | null> };
}

// Port of content.js:108-128,461-551 in v1.1.0 (c2f8b71) with the route course (F1)
// and robust loop (F5).
export function createCompletionRunner(deps: CompletionDeps): CompletionRunner {
  const { banner } = deps;
  const title = "Completing materials";
  let running = false;

  async function run(
    slug: string,
    token: string,
    userId: string,
  ): Promise<CompletionSummary | null> {
    banner.show({ tone: "info", title, description: "Gathering course data…" });
    const materialsResponse = await deps.fetch(buildCompletionMaterialsUrl(slug), {
      headers: { "X-CSRF3-Token": token },
    });
    if (!materialsResponse.ok) throw new Error(courseMaterialsError(materialsResponse.status));
    const materials = (await materialsResponse.json()) as CourseMaterials;
    const internalCourseId = materials?.elements?.[0]?.id || slug;

    const extracted = extractCompletionItems(materials);
    const requested = extracted.items.filter((item) => REQUESTED_TYPES.includes(item.type));
    if (requested.length === 0) {
      banner.show({
        tone: "error",
        title: "Nothing to complete",
        description: "Could not find any videos/modules to complete.",
      });
      return null;
    }

    // Progress only saves requests: when it cannot be read, every item is requested.
    const progress = await deps
      .fetch(buildCourseProgressUrl(userId, internalCourseId), {
        headers: { "X-CSRF3-Token": token },
      })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
    const completedIds = completedItemIds(progress);
    const items = requested.filter((item) => !completedIds.has(item.id));
    const summary: CompletionSummary = {
      total: items.length,
      completed: 0,
      failed: 0,
      skippedLocked: extracted.skippedLocked,
      alreadyCompleted: requested.length - items.length,
    };
    const { skippedLocked, alreadyCompleted } = summary;
    const locked = skippedLocked > 0 ? ` ${skippedLocked} locked item(s) skipped.` : "";
    if (items.length === 0) {
      banner.show({
        tone: "success",
        title: "Materials already completed",
        description: `All ${alreadyCompleted} items were already completed.${locked}`,
        autoHideMs: 6000,
      });
      return summary;
    }

    const headers = { "Content-Type": "application/json", "X-CSRF3-Token": token };
    // A plugin is completed the way its "Mark as completed" button does it: with the id of a
    // session opened for this learner and item.
    const completePlugin = async (itemId: string): Promise<Response> => {
      const sessionResponse = await deps.fetch(
        buildWidgetSessionUrl(userId, internalCourseId, itemId),
        { headers: { "X-CSRF3-Token": token } },
      );
      if (!sessionResponse.ok) return sessionResponse;
      const sessionId = widgetSessionId(await sessionResponse.json());
      if (!sessionId) throw new Error(`Coursera opened no session for plugin ${itemId}.`);
      return deps.fetch(buildWidgetProgressUrl(userId, internalCourseId, itemId), {
        method: "PUT",
        headers,
        body: JSON.stringify({ sessionId, progressState: "Completed" }),
      });
    };
    const completeItem = ({ id, type }: CompletionItem): Promise<Response> => {
      if (type === "ungradedWidget") return completePlugin(id);
      if (type === "supplement") {
        return deps.fetch(SUPPLEMENT_COMPLETION_URL, {
          method: "POST",
          headers,
          body: supplementCompletionBody(userId, internalCourseId, id),
        });
      }
      return deps.fetch(buildLectureCompletionUrl(userId, slug, id), {
        method: "POST",
        headers,
        body: JSON.stringify({ contentRequestBody: {} }),
      });
    };

    for (let start = 0; start < items.length; start += CHUNK_SIZE) {
      if (start > 0) await deps.delay(CHUNK_DELAY_MS);
      const chunk = items.slice(start, start + CHUNK_SIZE);
      banner.show({
        tone: "info",
        title,
        description: `Items ${start + 1}–${start + chunk.length} of ${items.length}`,
        ...(summary.failed > 0 ? { detail: `${summary.failed} failed` } : {}),
        progress: start / items.length,
      });

      const results = await Promise.allSettled(chunk.map(completeItem));
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.ok) summary.completed += 1;
        else summary.failed += 1;
      }
    }

    const { total, completed, failed } = summary;
    const done = alreadyCompleted > 0 ? ` ${alreadyCompleted} item(s) already completed.` : "";
    banner.show(
      failed === 0
        ? {
            tone: "success",
            title: "Materials completed",
            description: `${completed} of ${total} items completed. Refresh the page to see your progress.${done}${locked}`,
            autoHideMs: 6000,
          }
        : {
            tone: "error",
            title: `Completed ${completed} of ${total}`,
            description: `${failed} failed. Refresh the page to see your progress.${done}${locked}`,
          },
    );
    return summary;
  }

  return {
    start() {
      if (running) throw new Error(COMPLETION_BUSY_MESSAGE);
      const { csrf3Token, userId } = deps.session.get();
      if (!csrf3Token) throw new Error(MISSING_TOKEN_MESSAGE);
      const slug = courseSlugFromUrl(deps.location());
      if (!slug) throw new Error(MISSING_COURSE_MESSAGE);

      running = true;
      const done = run(slug, csrf3Token, userId ?? "~")
        .catch((error: unknown) => {
          console.error(error);
          banner.show({
            tone: "error",
            title: "Course completion failed",
            description: errorMessage(error, "An error occurred. Check browser console."),
          });
          return null;
        })
        .finally(() => {
          running = false;
        });
      return { done };
    },
  };
}
