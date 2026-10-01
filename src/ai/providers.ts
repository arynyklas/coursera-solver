import type { ProviderId } from "@/shared/types";

export interface ProviderModel {
  id: string;
  label: string;
  hint: string;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  /** Where to create an API key; self-hosted servers have none. */
  keyUrl?: string;
  defaultModel: string;
  supportsStrictSchema: boolean;
  /**
   * Whether quiz images are sent along. Some models of these providers still refuse them; the
   * request is then repeated without images.
   */
  readsImages: boolean;
  models: ProviderModel[];
  /**
   * An OpenAI-compatible server the user runs: they enter its URL, the API key is optional, and
   * the models come from the server's `/models` list instead of `models`.
   */
  selfHosted?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  gemini: {
    id: "gemini",
    label: "Gemini",
    keyPlaceholder: "AIza...",
    keyUrl: "https://aistudio.google.com/app/apikey",
    defaultModel: "gemini-3.7-flash",
    supportsStrictSchema: true,
    readsImages: true,
    models: [
      { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", hint: "Balanced" },
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", hint: "Previous" },
      { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", hint: "Preview" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fast" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Quality" },
    ],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    defaultModel: "gpt-5.6-terra",
    supportsStrictSchema: true,
    readsImages: true,
    models: [
      { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", hint: "Balanced" },
      { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", hint: "Economy" },
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", hint: "Quality" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 mini", hint: "Previous" },
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Claude",
    keyPlaceholder: "sk-ant-...",
    keyUrl: "https://console.anthropic.com/settings/keys",
    defaultModel: "claude-sonnet-5",
    supportsStrictSchema: true,
    readsImages: true,
    models: [
      { id: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "Balanced" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Fast" },
      { id: "claude-opus-5", label: "Claude Opus 5", hint: "Quality" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "Previous" },
    ],
  },
  xai: {
    id: "xai",
    label: "xAI",
    keyPlaceholder: "xai-...",
    keyUrl: "https://console.x.ai/",
    defaultModel: "grok-4.6",
    supportsStrictSchema: true,
    readsImages: true,
    models: [
      { id: "grok-4.6", label: "Grok 4.6", hint: "Balanced" },
      { id: "grok-4.3", label: "Grok 4.3", hint: "Previous" },
    ],
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.deepseek.com/api_keys",
    defaultModel: "deepseek-v4-flash",
    supportsStrictSchema: false,
    // DeepSeek's chat API takes text only.
    readsImages: false,
    models: [
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", hint: "Balanced" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "Quality" },
    ],
  },
  groq: {
    id: "groq",
    label: "Groq",
    keyPlaceholder: "gsk_...",
    keyUrl: "https://console.groq.com/keys",
    defaultModel: "openai/gpt-oss-120b",
    supportsStrictSchema: false,
    // None of the listed Groq models reads images.
    readsImages: false,
    models: [
      { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B", hint: "Balanced" },
      { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", hint: "Fast" },
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", hint: "Enterprise" },
    ],
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    keyPlaceholder: "sk-or-...",
    keyUrl: "https://openrouter.ai/settings/keys",
    defaultModel: "~openai/gpt-latest",
    supportsStrictSchema: true,
    readsImages: true,
    models: [
      { id: "~openai/gpt-latest", label: "OpenAI GPT Latest", hint: "Balanced" },
      { id: "~anthropic/claude-sonnet-latest", label: "Claude Sonnet Latest", hint: "Quality" },
      { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", hint: "Fast" },
      { id: "openrouter/free", label: "OpenRouter Free", hint: "Free router" },
    ],
  },
  vllm: {
    id: "vllm",
    label: "vLLM",
    keyPlaceholder: "Optional",
    defaultModel: "",
    supportsStrictSchema: true,
    readsImages: true,
    models: [],
    selfHosted: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as string[]).includes(value);
}

export function getProvider(id: string): ProviderConfig {
  if (!isProviderId(id)) throw new Error(`Unsupported AI provider: ${id}`);
  return PROVIDERS[id];
}

export function modelLabel(providerId: ProviderId, modelId: string): string {
  const provider = PROVIDERS[providerId];
  return (
    provider.models.find((model) => model.id === modelId)?.label || modelId || provider.defaultModel
  );
}
