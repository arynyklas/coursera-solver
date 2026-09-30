import { describe, expect, it } from "vitest";
import { providerErrorMessage } from "@/ai/errors";

describe("providerErrorMessage", () => {
  it("blames the key, not an account, when a vLLM server refuses the request", () => {
    expect(providerErrorMessage("vllm", 401, { error: "Unauthorized" })).toBe(
      "The vLLM server rejected the API key.",
    );
  });

  it("points at the server URL when a vLLM server has no API at that path", () => {
    expect(providerErrorMessage("vllm", 404, { detail: "Not Found" })).toBe(
      "No vLLM API was found at this server URL.",
    );
  });

  it("passes on vLLM's own explanation of a 404", () => {
    const body = { error: { message: "The model `qwen` does not exist.", code: 404 } };
    expect(providerErrorMessage("vllm", 404, body)).toBe("vLLM: The model `qwen` does not exist.");
  });

  it("keeps the hosted providers' account wording", () => {
    expect(providerErrorMessage("groq", 401, {})).toBe(
      "Groq rejected the API key or account permissions.",
    );
    expect(providerErrorMessage("groq", 404, {})).toBe(
      "The selected Groq model is unavailable for this account.",
    );
  });
});
