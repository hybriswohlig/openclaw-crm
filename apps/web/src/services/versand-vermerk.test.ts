import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const m = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db", () => ({ db: { execute: m.execute } }));

import { vermerkeVersand } from "./versand-vermerk";

type Version = { id: string; sentAt: Date | null; sentVia: string | null };
type Dokument = { id: string; documentType: string; calculationVersionId: string | null };

/**
 * Kleine Nachbildung der einen UPDATE-Anweisung: prüft die SQL-Form
 * (coalesce für beide Spalten, Verknüpfung über deal_documents.calculation_version_id,
 * nur Typ quotation) und wendet sie auf einen Speicher im Test an.
 */
function fakeDb(versionen: Version[], dokumente: Dokument[]) {
  m.execute.mockImplementation(async (query: SQL) => {
    const q = new PgDialect().sqlToQuery(query);
    q.sql = q.sql.replace(/\s+/g, " ");
    expect(q.sql).toMatch(/^update "deal_calculation_versions" set/);
    expect(q.sql).toContain('"sent_at" = coalesce("deal_calculation_versions"."sent_at", now())');
    expect(q.sql).toMatch(/"sent_via" = coalesce\("deal_calculation_versions"\."sent_via", \$\d+\)/);
    expect(q.sql).toContain('from "deal_documents"');
    expect(q.sql).toContain('"deal_documents"."calculation_version_id" = "deal_calculation_versions"."id"');
    expect(q.sql).toMatch(/"deal_documents"\."document_type" = \$\d+/);
    expect(q.sql).toContain('"deal_documents"."workspace_id" = "deal_calculation_versions"."workspace_id"');
    const [kanal, dokumentId, typ] = q.params as string[];
    const doc = dokumente.find((d) => d.id === dokumentId && d.documentType === typ);
    const version = doc && versionen.find((v) => v.id === doc.calculationVersionId);
    if (version) {
      version.sentAt = version.sentAt ?? new Date();
      version.sentVia = version.sentVia ?? kanal;
    }
    return [];
  });
}

// Fehlgeschlagene Prüfungen in der Nachbildung würden sonst vom try/catch verschluckt.
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  if (!erwarteLog) expect(log).not.toHaveBeenCalled();
  erwarteLog = false;
  log.mockRestore();
});
let erwarteLog = false;

describe("vermerkeVersand", () => {
  it("vermerkt den ersten Kanal; ein späterer Versand überschreibt ihn nicht", async () => {
    const v = { id: "v2", sentAt: null, sentVia: null } as Version;
    fakeDb([v], [{ id: "doc1", documentType: "quotation", calculationVersionId: "v2" }]);
    await vermerkeVersand("doc1", "whatsapp");
    const ersterZeitpunkt = v.sentAt;
    expect(v.sentVia).toBe("whatsapp");
    expect(ersterZeitpunkt).toBeInstanceOf(Date);
    await vermerkeVersand("doc1", "email");
    expect(v.sentVia).toBe("whatsapp");
    expect(v.sentAt).toBe(ersterZeitpunkt);
    expect(m.execute).toHaveBeenCalledTimes(2);
    const q = new PgDialect().sqlToQuery(m.execute.mock.calls[1][0] as SQL);
    expect(q.params).toEqual(["email", "doc1", "quotation"]);
  });

  it("Dokument ohne Version ändert nichts", async () => {
    const v = { id: "v2", sentAt: null, sentVia: null } as Version;
    fakeDb([v], [{ id: "doc1", documentType: "quotation", calculationVersionId: null }]);
    await vermerkeVersand("doc1", "whatsapp");
    expect(v).toEqual({ id: "v2", sentAt: null, sentVia: null });
  });

  it("andere Dokumenttypen (Rechnung) ändern nichts", async () => {
    const v = { id: "v2", sentAt: null, sentVia: null } as Version;
    fakeDb([v], [{ id: "doc1", documentType: "invoice", calculationVersionId: "v2" }]);
    await vermerkeVersand("doc1", "email");
    expect(v.sentVia).toBeNull();
  });

  it("leere Dokument-ID fragt die DB nicht", async () => {
    await vermerkeVersand("", "whatsapp");
    expect(m.execute).not.toHaveBeenCalled();
  });

  it("DB-Fehler wird geloggt, nie geworfen", async () => {
    erwarteLog = true;
    m.execute.mockRejectedValue(new Error("connection refused"));
    await expect(vermerkeVersand("doc1", "whatsapp")).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("[versand-vermerk]", "connection refused");
  });
});
