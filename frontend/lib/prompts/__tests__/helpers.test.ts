import { describe, expect, test } from "bun:test";
import Handlebars from "handlebars";
import "../helpers"; // side-effect: registers helpers

describe("formatRecord helper", () => {
  test("formats a non-empty record into bullet lines", () => {
    const tmpl = Handlebars.compile("{{formatRecord data}}");
    const result = tmpl({ data: { fighting: "expert", hacking: "intermediate" } });
    expect(result).toBe("- fighting: expert\n- hacking: intermediate");
  });

  test("returns empty string for empty record", () => {
    const tmpl = Handlebars.compile("{{formatRecord data}}");
    const result = tmpl({ data: {} });
    expect(result).toBe("");
  });

  test("returns empty string for undefined", () => {
    const tmpl = Handlebars.compile("{{formatRecord data}}");
    const result = tmpl({});
    expect(result).toBe("");
  });
});
