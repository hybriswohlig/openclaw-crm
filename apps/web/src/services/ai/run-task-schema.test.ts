import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/db", () => ({ db: {} }));
import { schemaText } from "./run-task";

describe("schemaText", () => {
  const schema = z.object({ items: z.array(z.object({ name: z.string() })).catch([]) });

  it("eigener Hinweis der Aufgabe ersetzt die automatische Beschreibung", () => {
    expect(schemaText(schema, '{"items":[{"name": string}]}')).toBe('{"items":[{"name": string}]}');
  });
  it("ohne Hinweis bleibt die automatische Beschreibung", () => {
    expect(schemaText(schema)).toContain('"items"');
    expect(schemaText(schema, "  ")).toBe(schemaText(schema));
  });
});
