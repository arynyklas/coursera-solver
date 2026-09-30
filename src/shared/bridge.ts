import type { CourseMaterials } from "./types";

export const BRIDGE = {
  capture: "coursera-solver:capture",
  hello: "coursera-solver:hello",
  snapshot: "coursera-solver:snapshot",
  monacoRequest: "coursera-solver:monaco-request",
  monacoResponse: "coursera-solver:monaco-response",
} as const;

export const MONACO_MODEL_PREFIX = "inmemory://model/";
const REQUEST_ID = /^[a-z0-9-]{1,80}$/i;

export interface Capture {
  url: string;
  method: string;
  headerNames: string[];
  csrf3Token?: string;
  userId?: string;
  urlUserId?: string;
  materials?: CourseMaterials;
}

export interface CaptureSnapshot {
  csrf3Token?: string;
  userId?: string;
  urlUserId?: string;
  headerNames: string[];
  materials?: { url: string; data: CourseMaterials };
}

export type MonacoAction = "read-model" | "replace-model";

export interface MonacoRequest {
  source: typeof BRIDGE.monacoRequest;
  requestId: string;
  action: MonacoAction;
  modelUri: string;
  value?: string;
  expectedValue?: string;
}

export interface MonacoResponse {
  source: typeof BRIDGE.monacoResponse;
  requestId: string;
  ok: boolean;
  value?: string;
  error?: string;
}

export type BridgeMessage =
  | { source: typeof BRIDGE.capture; capture: Capture }
  | { source: typeof BRIDGE.hello }
  | { source: typeof BRIDGE.snapshot; snapshot: CaptureSnapshot }
  | MonacoRequest
  | MonacoResponse;

export function isValidModelUri(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(MONACO_MODEL_PREFIX);
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value);
}

export function readBridgeMessage<S extends BridgeMessage["source"]>(
  event: MessageEvent,
  win: Window,
  source: S,
): Extract<BridgeMessage, { source: S }> | null {
  if (event.source !== win || event.origin !== win.location.origin) return null;
  const data: unknown = event.data;
  if (!data || typeof data !== "object") return null;
  if (!("source" in data) || data.source !== source) return null;
  return data as Extract<BridgeMessage, { source: S }>;
}

export function postBridgeMessage(win: Window, message: BridgeMessage): void {
  const origin = String(win.location?.origin ?? "").trim();
  if (!origin || origin === "null") {
    throw new Error("A concrete page origin is required for the Monaco bridge.");
  }
  win.postMessage(message, origin);
}
