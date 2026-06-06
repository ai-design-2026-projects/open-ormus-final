export const judgeResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "drift_judge",
    strict: true,
    schema: {
      type: "object",
      properties: {
        scenario_engagement: {
          type: "string",
          enum: ["active", "touched", "absent"],
        },
        reasoning: { type: "string" },
        character_alignment: {
          type: "array",
          items: {
            type: "object",
            properties: {
              character_id: { type: "string" },
              label: { type: "string", enum: ["consistent", "neutral", "contradicts"] },
              reasoning: { type: "string" },
            },
            required: ["character_id", "label", "reasoning"],
            additionalProperties: false,
          },
        },
      },
      required: ["scenario_engagement", "reasoning", "character_alignment"],
      additionalProperties: false,
    },
  },
} as const;
