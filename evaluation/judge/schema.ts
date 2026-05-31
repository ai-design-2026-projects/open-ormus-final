export const judgeResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "character_identity_assignments",
    strict: true,
    schema: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              alias: { type: "string" },
              real_name: { type: "string" },
              reasons: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
              },
            },
            required: ["alias", "real_name", "reasons"],
            additionalProperties: false,
          },
        },
      },
      required: ["assignments"],
      additionalProperties: false,
    },
  },
} as const;
