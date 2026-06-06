import type { ProfileField } from "./types";

const fieldJsonSchema = {
  type: "object",
  properties: {
    not_observed: { type: "boolean" },
    items: { type: "array", items: { type: "string" } },
  },
  required: ["not_observed", "items"],
  additionalProperties: false,
} as const;

export function buildReconstructorResponseFormat(fields: ProfileField[]) {
  const properties: Record<string, unknown> = {};
  for (const f of fields) properties[f] = fieldJsonSchema;

  return {
    type: "json_schema" as const,
    json_schema: {
      name: "persona_reconstruction",
      strict: true,
      schema: {
        type: "object",
        properties: {
          fields: {
            type: "object",
            properties,
            required: fields as string[],
            additionalProperties: false,
          },
        },
        required: ["fields"],
        additionalProperties: false,
      },
    },
  };
}

export const comparatorResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "comparator_scores",
    strict: true,
    schema: {
      type: "object",
      properties: {
        item_scores: {
          type: "array",
          items: {
            type: "object",
            properties: {
              reconstructed_item: { type: "string" },
              score: { type: "string", enum: ["match", "no_match", "contradiction"] },
              justification: { type: "string" },
            },
            required: ["reconstructed_item", "score", "justification"],
            additionalProperties: false,
          },
        },
      },
      required: ["item_scores"],
      additionalProperties: false,
    },
  },
} as const;
