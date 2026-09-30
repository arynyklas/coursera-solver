import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface ContentScript {
  matches: string[];
  world?: string;
  run_at?: string;
  js?: string[];
}
interface Manifest {
  manifest_version: number;
  name: string;
  version: string;
  action?: { default_title?: string };
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  content_scripts?: ContentScript[];
  web_accessible_resources?: { resources: string[] }[];
}

const manifest = JSON.parse(readFileSync(".output/chrome-mv3/manifest.json", "utf8")) as Manifest;
const COURSE_MATCHES = ["*://*.coursera.org/learn/*"];
const HOSTS = [
  "*://*.coursera.org/*",
  "https://generativelanguage.googleapis.com/*",
  "https://api.openai.com/*",
  "https://api.anthropic.com/*",
  "https://api.x.ai/*",
  "https://api.deepseek.com/*",
  "https://api.groq.com/*",
  "https://openrouter.ai/*",
];

describe("built manifest", () => {
  it("keeps the extension identity and version", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("Coursera Auto Solver");
    expect(manifest.version).toBe("2.0.0");
    expect(manifest.action?.default_title).toBe("Coursera Auto Solver");
  });

  it("requests only the storage permission", () => {
    expect(manifest.permissions).toEqual(["storage"]);
    expect(manifest.optional_permissions ?? []).toEqual([]);
  });

  it("grants exactly Coursera and the seven AI provider origins", () => {
    expect([...(manifest.host_permissions ?? [])].sort()).toEqual([...HOSTS].sort());
  });

  it("injects one isolated and one document_start main-world script on course routes only", () => {
    const scripts = manifest.content_scripts ?? [];
    expect(scripts).toHaveLength(2);
    const main = scripts.find((script) => script.world === "MAIN");
    const isolated = scripts.find((script) => script.world !== "MAIN");
    expect(main?.matches).toEqual(COURSE_MATCHES);
    expect(main?.run_at).toBe("document_start");
    expect(isolated?.matches).toEqual(COURSE_MATCHES);
  });

  it("exposes nothing to pages except the banner stylesheet", () => {
    const resources = (manifest.web_accessible_resources ?? []).flatMap((entry) => entry.resources);
    expect(resources.every((resource) => resource === "content-scripts/coursera.css")).toBe(true);
  });
});
