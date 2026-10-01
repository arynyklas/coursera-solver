import { callProvider, requestJSON } from "@/ai/client";
import { providerErrorMessage } from "@/ai/errors";
import { loadQuestionImages, unattachedImages } from "@/ai/images";
import { createDialoguePrompt, createQuizPrompt } from "@/ai/prompts";
import { isProviderId, PROVIDERS } from "@/ai/providers";
import { buildModelListRequest, buildVerificationRequest } from "@/ai/requests";
import {
  parseAndValidateAnswers,
  parseAndValidateDialogueReply,
  parseModelList,
} from "@/ai/responses";
import { ANSWER_SCHEMA, DIALOGUE_SCHEMA } from "@/ai/schemas";
import { withKeepAlive } from "@/background/keepalive";
import type { BackgroundRequests, Handlers } from "@/shared/messaging";
import {
  getActiveProvider,
  getProviderSettings,
  isProviderReady,
  migrateLegacyGeminiKey,
} from "@/shared/storage";
import type { ProviderId } from "@/shared/types";

export interface BackgroundDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function loadAIConfiguration(): Promise<{
  provider: ProviderId;
  label: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  ready: boolean;
}> {
  await migrateLegacyGeminiKey();
  const provider = await getActiveProvider();
  const settings = (await getProviderSettings())[provider];
  const config = PROVIDERS[provider];
  return {
    provider,
    label: config.label,
    apiKey: settings?.apiKey || "",
    model: settings?.model || config.defaultModel,
    baseUrl: settings?.baseUrl || "",
    ready: isProviderReady(provider, settings),
  };
}

async function loadConfiguredProvider() {
  const configuration = await loadAIConfiguration();
  if (!configuration.ready) {
    const missing = PROVIDERS[configuration.provider].selfHosted ? "server" : "API key";
    throw new Error(`Add and verify a ${configuration.label} ${missing} in the extension popup.`);
  }
  return configuration;
}

export function createBackgroundHandlers(deps: BackgroundDeps = {}): Handlers<BackgroundRequests> {
  return {
    async solveQuestions({ questions }) {
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error("No quiz questions were provided to the AI service.");
      }
      const { provider, label, apiKey, model, baseUrl } = await loadConfiguredProvider();
      const rawText = await withKeepAlive(async () => {
        const { attachments, notes } = PROVIDERS[provider].readsImages
          ? await loadQuestionImages(questions, deps.fetch ?? fetch)
          : {
              attachments: [],
              notes: unattachedImages(questions, `${label} does not read images`),
            };
        // If the model refuses images, each one is noted as rejected unless it already had a reason.
        const rejected = new Map([
          ...unattachedImages(questions, "the model did not accept images"),
          ...notes,
        ]);
        return callProvider(
          {
            provider,
            apiKey,
            model,
            baseUrl,
            prompt: createQuizPrompt(questions, notes),
            ...(attachments.length > 0
              ? {
                  images: {
                    attachments,
                    promptWithoutImages: createQuizPrompt(questions, rejected),
                  },
                }
              : {}),
            schema: ANSWER_SCHEMA,
            schemaName: "quiz_answers",
          },
          deps,
        );
      });
      return parseAndValidateAnswers(rawText, questions);
    },

    async draftDialogueReply({ messages, currentQuestion }) {
      if (!currentQuestion || !String(currentQuestion).trim()) {
        throw new Error("No active Coursera dialogue question was found.");
      }
      const { provider, apiKey, model, baseUrl } = await loadConfiguredProvider();
      const rawText = await withKeepAlive(() =>
        callProvider(
          {
            provider,
            apiKey,
            model,
            baseUrl,
            prompt: createDialoguePrompt(messages, currentQuestion),
            schema: DIALOGUE_SCHEMA,
            schemaName: "dialogue_reply",
          },
          deps,
        ),
      );
      return parseAndValidateDialogueReply(rawText);
    },

    async verifyProvider({ provider, apiKey, model, baseUrl }) {
      if (!isProviderId(provider)) throw new Error("Choose a supported AI provider.");
      const { label, selfHosted } = PROVIDERS[provider];
      const key = String(apiKey ?? "").trim();
      if (!key && !selfHosted) throw new Error("Enter an API key first.");
      if (!model || !String(model).trim()) throw new Error("Choose or enter a model first.");

      const chosenModel = String(model).trim();
      const spec = buildVerificationRequest(provider, key, chosenModel, baseUrl);
      const result = await withKeepAlive(() => requestJSON(spec, provider, deps));
      if (!result.ok) {
        throw new Error(providerErrorMessage(provider, result.status, result.data));
      }

      if (spec.expectedModel && !parseModelList(result.data).includes(spec.expectedModel)) {
        throw new Error(
          selfHosted
            ? `The ${label} server does not serve ${spec.expectedModel}.`
            : `The selected ${label} model is unavailable for this account.`,
        );
      }

      return { message: `${label} is connected.` };
    },

    async listModels({ provider, apiKey, baseUrl }) {
      if (!isProviderId(provider)) throw new Error("Choose a supported AI provider.");
      const { label, selfHosted } = PROVIDERS[provider];
      if (!selfHosted) throw new Error(`${label} has a fixed model list.`);

      const spec = buildModelListRequest(provider, String(apiKey ?? "").trim(), baseUrl);
      const result = await withKeepAlive(() => requestJSON(spec, provider, deps));
      if (!result.ok) {
        throw new Error(providerErrorMessage(provider, result.status, result.data));
      }
      const models = parseModelList(result.data);
      if (models.length === 0) throw new Error(`The ${label} server lists no models.`);
      return { models };
    },
  };
}
