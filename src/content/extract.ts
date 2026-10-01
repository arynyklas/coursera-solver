import type { MonacoClient } from "@/content/monaco-client";
import { describeCodeEditor } from "@/coursera/monaco-dom";
import { parseAssessment } from "@/coursera/parser";
import type {
  ExtractedAssessment,
  ParserIssue,
  ParserIssueCode,
  Question,
  QuestionHandle,
} from "@/shared/types";

// Port of content-adapters.js:106-148 in v1.1.0 (c2f8b71) over parser handles (F2).
export async function extractAssessment(
  doc: Document,
  monaco: Pick<MonacoClient, "read">,
): Promise<ExtractedAssessment> {
  const { blocks, missingPrompt } = parseAssessment(doc);
  const questions: Question[] = [];
  const handles = new Map<number, QuestionHandle>();
  const issues: ParserIssue[] = missingPrompt.map((questionNumber) => ({
    questionNumber,
    code: "missing-prompt",
    message: `Question ${questionNumber} has no readable prompt.`,
  }));

  for (const { questionNumber, prompt, type, options, handle, images } of blocks) {
    if (handle.kind === "unsupported" || type === "unknown") {
      issues.push({
        questionNumber,
        code: "unsupported-question",
        message: `Question ${questionNumber} uses an unsupported question type.`,
      });
      continue;
    }

    const question: Question = {
      questionNumber,
      type,
      question: prompt,
      options,
      ...(images.length > 0 ? { images } : {}),
    };
    if (handle.kind !== "code") {
      questions.push(question);
      handles.set(questionNumber, { kind: handle.kind, block: handle.block, prompt });
      continue;
    }

    let failureCode: ParserIssueCode = "code-editor-unavailable";
    try {
      const { modelUri, language } = describeCodeEditor(handle.block);
      failureCode = "code-read-failed";
      const currentCode = await monaco.read(modelUri);
      questions.push({ ...question, language, currentCode });
      handles.set(questionNumber, {
        kind: "code",
        block: handle.block,
        prompt,
        modelUri,
        expectedValue: currentCode,
      });
    } catch (error) {
      issues.push({
        questionNumber,
        code: failureCode,
        message: (error instanceof Error && error.message) || "Could not read the code editor.",
      });
    }
  }

  issues.sort((first, second) => (first.questionNumber ?? 0) - (second.questionNumber ?? 0));
  return { questions, handles, issues };
}
