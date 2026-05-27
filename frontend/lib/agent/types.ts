export type AnthropicTool = {
  name: string;
  description?: string;
  input_schema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
};
