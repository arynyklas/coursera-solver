import { describe, expect, it, vi } from "vitest";
import { IMAGE_LIMITS, loadQuestionImages } from "@/ai/images";
import type { Question } from "@/shared/types";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 4, 5]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 9, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 6]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
/** Where Coursera serves quiz images from. */
const CDN = "https://d3c33hcgiwev3.cloudfront.net/imageAssetProxy.v1";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function question(questionNumber: number, urls: string[]): Question {
  return {
    questionNumber,
    type: "single_answer",
    question: `Question ${questionNumber}`,
    options: ["A", "B"],
    images: urls.map((url) => ({ url, alt: "" })),
  };
}

/** Serves each URL's bytes; a URL missing from `files` is a 404. */
function serve(files: Record<string, Uint8Array<ArrayBuffer>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const bytes = files[String(input)];
    // The content type is ignored: the format comes from the bytes.
    return bytes
      ? new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })
      : new Response(null, { status: 404 });
  });
}

describe("loadQuestionImages", () => {
  it("attaches each image as base64 under its question's label, in a format every provider reads", async () => {
    const fetch = serve({
      [`${CDN}/a.png`]: PNG,
      [`${CDN}/b.jpg`]: JPEG,
      [`${CDN}/c.webp`]: WEBP,
    });

    const { attachments, notes } = await loadQuestionImages(
      [question(2, [`${CDN}/a.png`, `${CDN}/b.jpg`]), question(5, [`${CDN}/c.webp`])],
      fetch,
    );

    expect(attachments).toEqual([
      { label: "Question 2 image 1", mediaType: "image/png", data: base64(PNG) },
      { label: "Question 2 image 2", mediaType: "image/jpeg", data: base64(JPEG) },
      { label: "Question 5 image 1", mediaType: "image/webp", data: base64(WEBP) },
    ]);
    expect(notes).toEqual(new Map());
  });

  it("notes every image it cannot attach and why", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("offline.png")) throw new TypeError("Failed to fetch");
      if (url.endsWith("drawing.svg")) return new Response(SVG);
      if (url.endsWith("huge.png")) return new Response(new Uint8Array([...PNG, ...PNG]));
      return new Response(null, { status: 404 });
    });

    const { attachments, notes } = await loadQuestionImages(
      [
        question(1, [
          `${CDN}/offline.png`,
          `${CDN}/missing.png`,
          `${CDN}/drawing.svg`,
          `${CDN}/huge.png`,
        ]),
      ],
      fetch,
      { ...IMAGE_LIMITS, bytes: PNG.length },
    );

    expect(attachments).toEqual([]);
    expect(notes).toEqual(
      new Map([
        ["Question 1 image 1", "could not be loaded"],
        ["Question 1 image 2", "could not be loaded"],
        ["Question 1 image 3", "is not a PNG, JPEG or WebP image"],
        ["Question 1 image 4", "is too large to send"],
      ]),
    );
  });

  it("requests only images on Coursera's hosts or inline in the page, and without cookies", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(PNG),
    );
    const allowed = [
      `${CDN}/a.png`,
      "https://www.coursera.org/static/b.png",
      `data:image/png;base64,${base64(PNG)}`,
    ];

    const { attachments, notes } = await loadQuestionImages(
      [
        question(1, [
          ...allowed,
          "http://d3c33hcgiwev3.cloudfront.net/plain.png",
          "https://localhost/c.png",
          "https://192.168.1.10/d.png",
          "https://gpu.lan:8000/e.png",
          "https://d3c33hcgiwev3.cloudfront.net.attacker.example/f.png",
        ]),
      ],
      fetch,
    );

    expect(attachments.map(({ label }) => label)).toEqual([
      "Question 1 image 1",
      "Question 1 image 2",
      "Question 1 image 3",
    ]);
    expect(notes).toEqual(
      new Map([
        ["Question 1 image 4", "could not be loaded"],
        ["Question 1 image 5", "could not be loaded"],
        ["Question 1 image 6", "could not be loaded"],
        ["Question 1 image 7", "could not be loaded"],
        ["Question 1 image 8", "could not be loaded"],
      ]),
    );
    expect(fetch.mock.calls).toEqual(allowed.map((url) => [url, { credentials: "omit" }]));
  });

  it("stops at the image count and total size limits of one request", async () => {
    const fetch = serve({
      [`${CDN}/1.png`]: PNG,
      [`${CDN}/2.png`]: PNG,
      [`${CDN}/3.png`]: PNG,
    });

    const byCount = await loadQuestionImages(
      [question(1, [`${CDN}/1.png`, `${CDN}/2.png`])],
      fetch,
      { ...IMAGE_LIMITS, count: 1 },
    );
    expect(byCount.attachments.map(({ label }) => label)).toEqual(["Question 1 image 1"]);
    expect(byCount.notes).toEqual(
      new Map([["Question 1 image 2", "is over the limit of images per request"]]),
    );

    const bySize = await loadQuestionImages(
      [question(1, [`${CDN}/1.png`, `${CDN}/2.png`])],
      fetch,
      { ...IMAGE_LIMITS, totalBytes: PNG.length + 1 },
    );
    expect(bySize.attachments.map(({ label }) => label)).toEqual(["Question 1 image 1"]);
    expect(bySize.notes).toEqual(
      new Map([["Question 1 image 2", "would make the request too large"]]),
    );
  });

  it("sends a picture several questions show once, under the label it first had", async () => {
    // Homework diagrams: one run diagram serves several questions in a row.
    const fetch = serve({ [`${CDN}/run.png`]: PNG, [`${CDN}/other.png`]: JPEG });

    const { attachments, notes } = await loadQuestionImages(
      [
        question(9, [`${CDN}/run.png`]),
        question(10, [`${CDN}/other.png`]),
        question(11, [`${CDN}/run.png`]),
      ],
      fetch,
    );

    expect(attachments.map(({ label }) => label)).toEqual([
      "Question 9 image 1",
      "Question 10 image 1",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(notes).toEqual(new Map());
  });
});
