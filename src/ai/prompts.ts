import type { DialogueMessage, Question } from "@/shared/types";
import { imageLabel } from "./images";

const IMAGE_INSTRUCTIONS = `

IMAGES:
- Questions with images list them under "images" by label. Each attached image follows this text, introduced by its label; treat it as part of its question.
- An image with an "option" shows the answer option with that number.
- An image with "notAttached" was not sent; answer from the text and its "alt" text.`;

/**
 * `imageNotes` names, by image label, the images this request does not carry and why; the rest
 * are attached after the prompt (see `loadQuestionImages`). Image URLs never reach the prompt.
 */
export function createQuizPrompt(
  questions: Question[],
  imageNotes: ReadonlyMap<string, string> = new Map(),
): string {
  const hasImages = questions.some(({ images }) => images?.length);
  const input = questions.map(({ options, images, ...question }) => ({
    ...question,
    // Answers choose options by these numbers; a key each keeps one line per option.
    ...(options.length > 0
      ? { options: Object.fromEntries(options.map((text, index) => [index + 1, text])) }
      : {}),
    ...(images?.length
      ? {
          images: images.map(({ alt, option }, index) => {
            const label = imageLabel(question.questionNumber, index);
            const note = imageNotes.get(label);
            return {
              label,
              ...(alt ? { alt } : {}),
              ...(option === undefined ? {} : { option }),
              ...(note ? { notAttached: note } : {}),
            };
          }),
        }
      : {}),
  }));
  return `You are an expert subject-matter assistant. Solve every quiz question in the JSON input.

INPUT QUESTIONS:
${JSON.stringify(input, null, 2)}${hasImages ? IMAGE_INSTRUCTIONS : ""}

OUTPUT REQUIREMENTS:
- Return one JSON object with exactly one key named "answers".
- "answers" must contain one object for every input question.
- Each answer object must contain exactly "questionNumber", "optionNumbers" and "text".
- For single_answer and multiple_answer questions, put the number of each correct option (its key in "options") in "optionNumbers" (one number for single_answer) and leave "text" empty.
- For text_input questions, put one concise, direct answer in "text" and leave "optionNumbers" empty.
- For numeric_input questions, put only the number in "text": digits with an optional minus sign and decimal point, without units, words or thousands separators.
- For essay questions, put one complete response that follows the question's requested length and constraints in "text".
- For code_expression questions, use the supplied language and currentCode to put the complete corrected editor content in "text".
- Preserve required function names, surrounding code, comments, and provided test calls in code_expression answers.
- Return code as plain JSON string content without Markdown fences or explanations.
- Do not add explanations, markdown, or code fences.

EXPECTED SHAPE:
{"answers":[{"questionNumber":1,"optionNumbers":[2],"text":""},{"questionNumber":2,"optionNumbers":[],"text":"Written answer"}]}`;
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
