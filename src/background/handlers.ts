import { callProvider, requestJSON } from "@/ai/client";
import { providerErrorMessage } from "@/ai/errors";
import { createDialoguePrompt, createQuizPrompt } from "@/ai/prompts";
import { isProviderId, PROVIDERS } from "@/ai/providers";
import { buildVerificationRequest } from "@/ai/requests";
import { parseAndValidateAnswers, parseAndValidateDialogueReply } from "@/ai/responses";
import { ANSWER_SCHEMA, DIALOGUE_SCHEMA } from "@/ai/schemas";
import type { BackgroundRequests, Handlers } from "@/shared/messaging";
import { getActiveProvider, getProviderSettings, migrateLegacyGeminiKey } from "@/shared/storage";
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
  };
}

async function loadConfiguredProvider() {
  const configuration = await loadAIConfiguration();
  if (!configuration.apiKey) {
    throw new Error(`Add and verify a ${configuration.label} API key in the extension popup.`);
  }
  return configuration;
}

export function createBackgroundHandlers(deps: BackgroundDeps = {}): Handlers<BackgroundRequests> {
  return {
    async solveQuestions({ questions }) {
      if (!Array.isArray(questions) || questions.length === 0) {
        throw new Error("No quiz questions were provided to the AI service.");
      }
      const { provider, apiKey, model } = await loadConfiguredProvider();
      const rawText = await callProvider(
        {
          provider,
          apiKey,
          model,
          prompt: createQuizPrompt(questions),
          schema: ANSWER_SCHEMA,
          schemaName: "quiz_answers",
        },
        deps,
      );
      return parseAndValidateAnswers(rawText, questions);
    },

    async draftDialogueReply({ messages, currentQuestion }) {
      if (!currentQuestion || !String(currentQuestion).trim()) {
        throw new Error("No active Coursera dialogue question was found.");
      }
      const { provider, apiKey, model } = await loadConfiguredProvider();
      const rawText = await callProvider(
        {
          provider,
          apiKey,
          model,
          prompt: createDialoguePrompt(messages, currentQuestion),
          schema: DIALOGUE_SCHEMA,
          schemaName: "dialogue_reply",
        },
        deps,
      );
      return parseAndValidateDialogueReply(rawText);
    },

    async verifyProvider({ provider, apiKey, model }) {
      if (!isProviderId(provider)) throw new Error("Choose a supported AI provider.");
      if (!apiKey || !String(apiKey).trim()) throw new Error("Enter an API key first.");
      if (!model || !String(model).trim()) throw new Error("Choose or enter a model first.");

      const label = PROVIDERS[provider].label;
      const spec = buildVerificationRequest(provider, String(apiKey).trim(), String(model).trim());
      const result = await requestJSON(spec, provider, deps);
      if (!result.ok) {
        throw new Error(providerErrorMessage(provider, result.status, result.data));
      }

      if (spec.expectedModel) {
        const list = (result.data as { data?: unknown } | null)?.data;
        const availableModels = Array.isArray(list) ? (list as Array<{ id?: unknown } | null>) : [];
        if (!availableModels.some((item) => item?.id === spec.expectedModel)) {
          throw new Error(`The selected ${label} model is unavailable for this account.`);
        }
      }

      return { message: `${label} is connected.` };
    },
  };
}
