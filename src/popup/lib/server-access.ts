import { browser } from "wxt/browser";
import { serverOriginPattern } from "@/ai/endpoint";
import { type ServerDraft, serverDraftItem } from "@/shared/storage";

/**
 * Asks Chrome for access to the draft's server origin, so it must be the first await of the
 * click that needs it. Chrome's prompt can close the popup; until the answer arrives the draft
 * stays in session storage, and the next popup resumes from it. Throws when access is refused.
 */
export async function requestServerAccess(draft: ServerDraft): Promise<void> {
  const saved = serverDraftItem.setValue(draft);
  let granted: boolean;
  try {
    granted = await browser.permissions.request({ origins: [serverOriginPattern(draft.baseUrl)] });
  } finally {
    await saved;
    await serverDraftItem.removeValue();
  }
  if (!granted) {
    throw new Error(`Allow access to ${new URL(draft.baseUrl).host} to use this server.`);
  }
}

/** Whether Chrome already lets the extension reach the server. Never prompts. */
export async function hasServerAccess(baseUrl: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [serverOriginPattern(baseUrl)] });
  } catch {
    return false;
  }
}
