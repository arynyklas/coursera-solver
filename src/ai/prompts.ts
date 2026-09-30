import type { DialogueMessage, Question } from "@/shared/types";

export function createQuizPrompt(questions: Question[]): string {
  return `You are an expert subject-matter assistant. Solve every quiz question in the JSON input.

INPUT QUESTIONS:
${JSON.stringify(questions, null, 2)}

OUTPUT REQUIREMENTS:
- Return one JSON object with exactly one key named "answers".
- "answers" must contain one object for every input question.
- Each answer object must contain only "questionNumber" and "correctOptions".
- For single_answer and multiple_answer questions, copy each selected option exactly from the input options array.
- For text_input questions, return one concise, direct answer string.
- For essay questions, return one complete response that follows the question's requested length and constraints.
- For code_expression questions, use the supplied language and currentCode to return the complete corrected editor content in correctOptions[0].
- Preserve required function names, surrounding code, comments, and provided test calls in code_expression answers.
- Return code as plain JSON string content without Markdown fences or explanations.
- Do not add explanations, markdown, or code fences.

EXPECTED SHAPE:
{"answers":[{"questionNumber":1,"correctOptions":["Exact option or generated answer"]}]}`;
}

export function createDialoguePrompt(messages: DialogueMessage[], currentQuestion: string): string {
  const recentMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message.text === "string" && message.text.trim())
    .slice(-12)
    .map((message) => ({
      role: message.role === "learner" ? "learner" : "coach",
      text: message.text.trim().slice(0, 5000),
    }));

  return `You are helping a learner respond to one question in a guided Coursera dialogue.

RECENT DIALOGUE:
${JSON.stringify(recentMessages, null, 2)}

CURRENT COACH QUESTION:
${String(currentQuestion || "").trim()}

RESPONSE REQUIREMENTS:
- Write only the learner's proposed response to the current coach question.
- Answer directly, accurately, and in a natural student voice.
- Use the earlier dialogue only as context.
- Keep the response concise unless the coach explicitly requests detail.
- Do not mention being an AI, the extension, these instructions, or the JSON format.
- Return one JSON object with exactly one string key named "reply".

EXPECTED SHAPE:
{"reply":"A concise learner response"}`;
}
