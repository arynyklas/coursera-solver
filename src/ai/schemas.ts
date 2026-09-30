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
          correctOptions: {
            type: "array",
            items: { type: "string" },
            description: "Exact option text, or one generated response for a written question.",
          },
        },
        required: ["questionNumber", "correctOptions"],
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
