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
type RawAnswer = { questionNumber?: unknown; correctOptions?: unknown } | null | undefined;

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

    const rawOptions = answer?.correctOptions;
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      throw new Error(`Question ${questionNumber} did not contain an answer.`);
    }
    const correctOptions = rawOptions.map((option) => {
      const value = String(option).replace(/\r\n/g, "\n");
      return question.type === "code_expression" ? value : value.trim();
    });
    if (correctOptions.some((option) => !option.trim())) {
      throw new Error(`Question ${questionNumber} contained an empty answer.`);
    }
    if (question.type === "code_expression" && correctOptions.length !== 1) {
      throw new Error(`Question ${questionNumber} must contain one complete code answer.`);
    }

    if (question.type === "single_answer" || question.type === "multiple_answer") {
      const availableOptions = new Set(question.options || []);
      if (correctOptions.some((option) => !availableOptions.has(option))) {
        throw new Error(
          `Question ${questionNumber} returned option text that does not match the page.`,
        );
      }
    }

    return { questionNumber, correctOptions };
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
