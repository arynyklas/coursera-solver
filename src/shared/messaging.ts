import { type Browser, browser } from "wxt/browser";
import type {
  Answer,
  CourseRequirementsResult,
  DialogueMessage,
  ParserDiagnostics,
  ParserIssue,
  ProviderId,
  Question,
} from "./types";

type NoPayload = Record<string, never>;

export interface ContentRequests {
  solveQuiz: { request: NoPayload; response: { status: "started" } };
  fillDialogue: { request: NoPayload; response: { status: "filled" } };
  completeMaterials: { request: NoPayload; response: { status: "started" } };
  getQuestions: { request: NoPayload; response: { questions: Question[]; issues: ParserIssue[] } };
  getCourseRequirements: { request: NoPayload; response: CourseRequirementsResult };
  getDiagnostics: { request: NoPayload; response: ParserDiagnostics };
}

export interface BackgroundRequests {
  solveQuestions: { request: { questions: Question[] }; response: Answer[] };
  draftDialogueReply: {
    request: { messages: DialogueMessage[]; currentQuestion: string };
    response: string;
  };
  verifyProvider: {
    request: { provider: ProviderId; apiKey: string; model: string; baseUrl?: string };
    response: { message: string };
  };
  listModels: {
    request: { provider: ProviderId; apiKey: string; baseUrl: string };
    response: { models: string[] };
  };
}

// Mapped constraint (not Record<string, …>) so that interfaces such as ContentRequests satisfy it:
// interfaces have no implicit index signature.
export type ProtocolMap<M> = { [K in keyof M]: { request: object; response: unknown } };
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export type MessageSender = Browser.runtime.MessageSender;
export type Handlers<M extends ProtocolMap<M>> = {
  [K in keyof M]: (
    request: M[K]["request"],
    sender: MessageSender,
  ) => Promise<M[K]["response"]> | M[K]["response"];
};
export type MessageListener = (
  message: unknown,
  sender: MessageSender,
  sendResponse: (reply: Reply<unknown>) => void,
) => boolean;

export const REFRESH_PAGE_MESSAGE = "Refresh the Coursera page, then try again.";

export const CONTENT_FALLBACKS: Record<keyof ContentRequests, string> = {
  solveQuiz: "Could not start the solver.",
  fillDialogue: "Could not fill the dialogue answer.",
  completeMaterials: "Could not start course completion.",
  getQuestions: "Could not extract this assessment.",
  getCourseRequirements: "Could not load course requirements.",
  getDiagnostics: "Could not load parser diagnostics.",
};

export const BACKGROUND_FALLBACKS: Record<keyof BackgroundRequests, string> = {
  solveQuestions: "Failed to fetch from AI.",
  draftDialogueReply: "Failed to draft the dialogue answer.",
  verifyProvider: "Connection check failed.",
  listModels: "Could not load the model list.",
};

export function errorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw.trim() || fallback;
}

export function createMessageRouter<M extends ProtocolMap<M>>(
  handlers: Handlers<M>,
  fallbacks: Record<keyof M, string>,
): MessageListener {
  return (message, sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    const { type, ...request } = message as { type?: unknown } & Record<string, unknown>;
    if (typeof type !== "string" || !Object.hasOwn(handlers, type)) return false;
    const key = type as keyof M & string;
    Promise.resolve()
      .then(() => handlers[key](request as M[typeof key]["request"], sender))
      .then(
        (data) => sendResponse({ ok: true, data }),
        (error: unknown) => sendResponse({ ok: false, error: errorMessage(error, fallbacks[key]) }),
      );
    return true;
  };
}

const MISSING_RECEIVER = /Receiving end does not exist|Could not establish connection/i;

function unwrap<T>(reply: Reply<T> | undefined, fallback: string): T {
  if (!reply || typeof reply !== "object") throw new Error(fallback);
  if (reply.ok) return reply.data;
  throw new Error(reply.error || fallback);
}

export async function sendToTab<K extends keyof ContentRequests>(
  tabId: number,
  type: K,
  request: ContentRequests[K]["request"],
): Promise<ContentRequests[K]["response"]> {
  let reply: Reply<ContentRequests[K]["response"]> | undefined;
  try {
    reply = await browser.tabs.sendMessage(tabId, { type, ...request });
  } catch (error) {
    if (MISSING_RECEIVER.test(errorMessage(error, ""))) throw new Error(REFRESH_PAGE_MESSAGE);
    throw error;
  }
  return unwrap(reply, CONTENT_FALLBACKS[type]);
}

export async function sendToBackground<K extends keyof BackgroundRequests>(
  type: K,
  request: BackgroundRequests[K]["request"],
): Promise<BackgroundRequests[K]["response"]> {
  const reply: Reply<BackgroundRequests[K]["response"]> | undefined =
    await browser.runtime.sendMessage({ type, ...request });
  return unwrap(reply, BACKGROUND_FALLBACKS[type]);
}
