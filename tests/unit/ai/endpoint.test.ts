import { describe, expect, it } from "vitest";
import { normalizeServerUrl, serverOriginPattern } from "@/ai/endpoint";

const INVALID =
  "Enter the server URL with http:// or https://, for example http://localhost:8000/v1.";

describe("normalizeServerUrl", () => {
  it("points a bare server address at its /v1 API root", () => {
    expect(normalizeServerUrl(" http://localhost:8000/ ")).toBe("http://localhost:8000/v1");
  });

  it("keeps an explicit API path without trailing slashes, query or fragment", () => {
    expect(normalizeServerUrl("https://gpu.example.com/vllm/v1/?x=1#top")).toBe(
      "https://gpu.example.com/vllm/v1",
    );
  });

  it("accepts a pasted endpoint URL", () => {
    expect(normalizeServerUrl("http://10.0.0.5:8000/v1/chat/completions")).toBe(
      "http://10.0.0.5:8000/v1",
    );
    expect(normalizeServerUrl("http://10.0.0.5:8000/v1/models/")).toBe("http://10.0.0.5:8000/v1");
  });

  it("rejects anything but an http or https URL", () => {
    for (const input of ["", "   ", "localhost:8000", "ftp://host/v1", "not a url"]) {
      expect(() => normalizeServerUrl(input)).toThrow(INVALID);
    }
  });
});

describe("serverOriginPattern", () => {
  it("covers the server's whole origin, including its port", () => {
    expect(serverOriginPattern("http://localhost:8000/v1")).toBe("http://localhost:8000/*");
    expect(serverOriginPattern("https://gpu.example.com/vllm/v1")).toBe(
      "https://gpu.example.com/*",
    );
  });
});
