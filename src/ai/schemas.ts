export type JsonSchema = Record<string, unknown>;

export const ANSWER_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          questionNumber: {
            type: "integer",
            description: "The questionNumber copied from the input question.",
          },
          optionNumbers: {
            type: "array",
            items: { type: "integer" },
            description:
              "The number of each correct option of a single_answer or multiple_answer question; empty for other questions.",
          },
          text: {
            type: "string",
            description:
              "The answer written for a text_input, essay or code_expression question; empty for choice questions.",
          },
        },
        required: ["questionNumber", "optionNumbers", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["answers"],
  additionalProperties: false,
};

export const DIALOGUE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "A concise response to place in the learner's Coursera dialogue composer.",
    },
  },
  required: ["reply"],
  additionalProperties: false,
};
