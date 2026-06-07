export function buildReconstructorResponseFormat(_fields: string[]) {
  return { type: "json_object" as const };
}

export const comparatorResponseFormat = {
  type: "json_object" as const,
} as const;
