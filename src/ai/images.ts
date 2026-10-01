import type { Question } from "@/shared/types";

/** An image sent inline with a quiz request, introduced in the prompt by its label. */
export interface ImageAttachment {
  label: string;
  /** `image/png`, `image/jpeg` or `image/webp`: the formats every supported provider reads. */
  mediaType: string;
  /** The image bytes, base64-encoded. */
  data: string;
}

/**
 * What one request may carry, in raw bytes. Base64 grows data by a third: Claude refuses an image
 * over 5 MB and Gemini a request over 20 MB, so 3.5 MB and 12 MB stay clear of both.
 */
export const IMAGE_LIMITS = { count: 16, bytes: 3.5 * 1024 * 1024, totalBytes: 12 * 1024 * 1024 };

/** The name an image goes by in the prompt and in the request that carries it. */
export function imageLabel(questionNumber: number, index: number): string {
  return `Question ${questionNumber} image ${index + 1}`;
}

/** Every image of `questions` noted with one reason, for a request that carries none of them. */
export function unattachedImages(questions: Question[], reason: string): Map<string, string> {
  return new Map(
    questions.flatMap(({ questionNumber, images = [] }) =>
      images.map((_, index): [string, string] => [imageLabel(questionNumber, index), reason]),
    ),
  );
}

/**
 * Coursera serves quiz images from its own hosts and its CloudFront CDN. The page picks the URLs
 * and the extension can read what it fetches, so nothing else is requested: not the user's own
 * machine or network, nor a server the extension was given access to. No cookies go along either.
 */
function isCourseraImage(url: string): boolean {
  if (url.startsWith("data:image/")) return true;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && /(^|\.)coursera\.org$|\.cloudfront\.net$/.test(hostname);
  } catch {
    return false;
  }
}

async function readImage(fetch: typeof globalThis.fetch, url: string): Promise<Uint8Array | null> {
  if (!isCourseraImage(url)) return null;
  try {
    const response = await fetch(url, { credentials: "omit" });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/** The format from the file's own signature, whatever the server called it. */
function imageMediaType(bytes: Uint8Array): string | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  // Spreading a whole large image into one call would overflow the argument limit.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

/**
 * Loads the questions' images for one request, in question order. An image that cannot go along
 * is left out with a note under its label, which the prompt passes on to the model.
 */
export async function loadQuestionImages(
  questions: Question[],
  fetch: typeof globalThis.fetch,
  limits = IMAGE_LIMITS,
): Promise<{ attachments: ImageAttachment[]; notes: Map<string, string> }> {
  const entries = questions.flatMap(({ questionNumber, images = [] }) =>
    images.map(({ url }, index) => ({ label: imageLabel(questionNumber, index), url })),
  );
  const loaded = await Promise.all(entries.map(({ url }) => readImage(fetch, url)));

  const attachments: ImageAttachment[] = [];
  const notes = new Map<string, string>();
  let totalBytes = 0;
  for (const [index, { label }] of entries.entries()) {
    const bytes = loaded[index];
    const mediaType = bytes ? imageMediaType(bytes) : null;
    if (!bytes || !mediaType) {
      notes.set(label, bytes ? "is not a PNG, JPEG or WebP image" : "could not be loaded");
    } else if (bytes.length > limits.bytes) {
      notes.set(label, "is too large to send");
    } else if (attachments.length >= limits.count) {
      notes.set(label, "is over the limit of images per request");
    } else if (totalBytes + bytes.length > limits.totalBytes) {
      notes.set(label, "would make the request too large");
    } else {
      totalBytes += bytes.length;
      attachments.push({ label, mediaType, data: toBase64(bytes) });
    }
  }
  return { attachments, notes };
}
