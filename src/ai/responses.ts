import type { Answer, ProviderId, Question } from "@/shared/types";

// Shapes the provider payloads are read through. Casts keep the legacy runtime behavior
// (optional chaining and direct method calls) without asserting that the payload is valid.
type TextPart = { type?: unknown; text?: unknown };
type GeminiResponse = { candidates?: { content?: { parts?: TextPart[] } }[] } | null | undefined;
type OpenAIResponse =
  | { output_text?: unknown; output?: { content?: TextPart[] }[] }
  | null
  | undefined;
type AnthropicResponse = { content?: TextPart[] } | null | undefined;
type ChatCompletionResponse =
  | { choices?: { message?: { content?: unknown } }[] }
  | null
  | undefined;
type RawAnswer =
  | { questionNumber?: unknown; optionNumbers?: unknown; text?: unknown }
  | null
  | undefined;
type ModelListResponse = { data?: unknown } | null | undefined;
type ChatStreamEvent =
  | { choices?: { delta?: { content?: unknown } }[]; error?: unknown }
  | null
  | undefined;

/**
 * A streamed chat completion joined into its answer: the content of every event in order,
 * without the reasoning. A server that fails partway sends an `error` event instead.
 */
export function joinChatStream(eventStream: string): { content: string } | { error: unknown } {
  let content = "";
  for (const line of eventStream.split(/\r?\n/)) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    let event: ChatStreamEvent;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event?.error) return { error: event.error };
    const delta = event?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") content += delta;
  }
  return { content };
}

export function extractResponseText(providerId: ProviderId, data: unknown): string {
  if (providerId === "gemini") {
    return (
      (data as GeminiResponse)?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") ?? ""
    );
  }
  if (providerId === "openai") {
    const response = data as OpenAIResponse;
    if (typeof response?.output_text === "string") return response.output_text;
    return (response?.output || [])
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text || "")
      .join("");
  }
  if (providerId === "anthropic") {
    return ((data as AnthropicResponse)?.content || [])
      .filter((part) => part.type === "text")
      .map((part) => part.text || "")
      .join("");
  }
  const content = (data as ChatCompletionResponse)?.choices?.[0]?.message?.content;
  return content ? String(content) : "";
}

/** Model ids from an OpenAI-compatible `/models` body, each once, in the server's order. */
export function parseModelList(data: unknown): string[] {
  const list = (data as ModelListResponse)?.data;
  if (!Array.isArray(list)) return [];
  const ids = list
    .map((item) => (item as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === "string" && id.trim() !== "");
  return [...new Set(ids)];
}

function cleanJSONText(rawText: string): string {
  return String(rawText || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

export function parseAndValidateAnswers(rawText: string, questions: Question[]): Answer[] {
  const cleaned = cleanJSONText(rawText);
  if (!cleaned) throw new Error("The AI provider returned an empty response.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("The AI provider returned invalid JSON.");
  }

  const answers: unknown = Array.isArray(parsed)
    ? parsed
    : (parsed as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers)) {
    throw new Error("The AI response did not contain an answers array.");
  }

  const questionMap = new Map<unknown, Question>(
    (questions || []).map((question) => [question.questionNumber, question]),
  );
  const seen = new Set<number>();
  const validated = (answers as RawAnswer[]).map((answer): Answer => {
    const questionNumber = answer?.questionNumber;
    const question = questionMap.get(questionNumber);
    if (typeof questionNumber !== "number" || !Number.isInteger(questionNumber) || !question) {
      throw new Error("The AI response referenced an unknown question.");
    }
    if (seen.has(questionNumber)) {
      throw new Error("The AI response contained a duplicate question number.");
    }
    seen.add(questionNumber);

    const missing = `Question ${questionNumber} did not contain an answer.`;

    if (question.type === "single_answer" || question.type === "multiple_answer") {
      const chosen = answer?.optionNumbers;
      if (!Array.isArray(chosen) || chosen.length === 0) throw new Error(missing);
      // A model answering without a schema may write a number as text.
      const optionNumbers = chosen.map((value: unknown) =>
        typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value,
      );
      if (
        !optionNumbers.every(
          (value): value is number =>
            typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 1 &&
            value <= question.options.length,
        )
      ) {
        throw new Error(`Question ${questionNumber} chose an option that is not on the page.`);
      }
      return { questionNumber, optionNumbers };
    }

    const text = String(answer?.text ?? "").replace(/\r\n/g, "\n");
    if (!text.trim()) throw new Error(missing);
    return { questionNumber, text: question.type === "code_expression" ? text : text.trim() };
  });

  if (validated.length !== questionMap.size) {
    throw new Error("The AI provider did not answer every question.");
  }

  return validated.sort((a, b) => a.questionNumber - b.questionNumber);
}

export function parseAndValidateDialogueReply(rawText: string): string {
  const cleaned = cleanJSONText(rawText);
  if (!cleaned) throw new Error("The AI provider returned an empty response.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("The AI provider returned invalid JSON for the dialogue answer.");
  }

  const rawReply = (parsed as { reply?: unknown } | null)?.reply;
  const reply = typeof rawReply === "string" ? rawReply.trim() : "";
  if (!reply) throw new Error("The AI provider did not return a dialogue answer.");
  if (reply.length > 7999)
    throw new Error("The generated dialogue answer is too long for Coursera.");
  return reply;
}
