import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Nur SQL rendern, nie verbinden: postgres.js baut die Verbindung erst bei der ersten Query auf.
vi.stubEnv("DATABASE_URL", "postgres://test:test@127.0.0.1:9/test");

let abfrage: { sql: string; params: unknown[] };

beforeAll(async () => {
  const { threadAggregatAbfrage } = await import("./laden");
  abfrage = threadAggregatAbfrage("ws-test", sql`(select 'deal-1')`).toSQL();
});

describe("threadAggregatAbfrage (Ruling 15: nur gesendete Antworten)", () => {
  it("bindet genau sent, delivered und read als Antwort-Status", () => {
    const status = abfrage.params.filter((p) => typeof p === "string" && /^[a-z]+$/.test(p));
    expect([...new Set(status)].sort()).toEqual(["delivered", "read", "sent"]);
    expect(abfrage.params).not.toContain("failed");
    expect(abfrage.params).not.toContain("pending");
  });

  it("jede ausgehende Bedingung prüft auch den Status (letzte Antwort und Grenze „erste Kundennachricht danach“)", () => {
    const ausgehend = [...abfrage.sql.matchAll(/'outbound'/g)];
    expect(ausgehend.length).toBeGreaterThan(0);
    for (const treffer of ausgehend) {
      const danach = abfrage.sql.slice(treffer.index! + "'outbound'".length, treffer.index! + 80);
      expect(danach).toMatch(/^ and "inbox_messages"\."status" in \(\$\d+, \$\d+, \$\d+\)/);
    }
  });

  it("letzte ausgehende Zeit und die Grenze nutzen dieselbe Antwort-Spalte", () => {
    expect(abfrage.sql).toMatch(/max\("zeit"\) filter \(where "antwort"\)/);
    expect(abfrage.sql).toMatch(/"zeit" > coalesce\("letzte_antwort", '-infinity'::timestamp\)/);
  });

  it("liefert zusätzlich die letzte Nachricht überhaupt (auch fehlgeschlagene) für die Anzeige", () => {
    expect(abfrage.sql).toMatch(/max\("zeit"\)(?! filter)/);
  });

  it("bleibt im Workspace", () => {
    expect(abfrage.params).toContain("ws-test");
    expect(abfrage.sql).toMatch(/"inbox_messages"\."workspace_id" = \$\d+/);
    expect(abfrage.sql).toMatch(/"inbox_conversations"\."workspace_id" = \$\d+/);
  });
});
