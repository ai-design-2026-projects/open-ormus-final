import Handlebars from "handlebars";

Handlebars.registerHelper(
  "formatRecord",
  (record: Record<string, string> | undefined) => {
    if (!record || Object.keys(record).length === 0) return "";
    return Object.entries(record)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
  }
);
