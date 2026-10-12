import { getTableName, type Table } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  selects: [] as unknown[],
  /** Antworten auf die Abfrage des Einsammelns (inbox_message_attachments), getrennt von den übrigen. */
  kandidaten: [] as unknown[],
  inserts: [] as Array<Record<string, unknown>>,
  /** Zeilen, deren Schlüssel schon stand: wie der eindeutige Index mit onConflictDoNothing nicht angelegt. */
  konflikte: [] as Array<Record<string, unknown>>,
  /** Reihenfolge der Zugriffe, z. B. "insert:fotos_offen" vor "select:agent_events". */
  log: [] as string[],
  stufen: {} as Record<string, string | null>,
  stufeLesen: vi.fn(),
  erkennen: vi.fn(),
  uebernehmen: vi.fn(),
  kalkulation: vi.fn(),
  senden: vi.fn(),
  insertFehler: null as null | ((v: Record<string, unknown>) => boolean),
}));

function kette() {
  let tabelle = "";
  const k: Record<string, unknown> = {};
  k.from = (t: Table) => {
    tabelle = getTableName(t);
    return k;
  };
  for (const m of ["where", "orderBy", "limit", "innerJoin"]) k[m] = () => k;
  k.then = (ok: (v: unknown) => unknown, nein: (e: unknown) => unknown) => {
    mock.log.push(`select:${tabelle}`);
    const ergebnis = tabelle === "inbox_message_attachments" ? (mock.kandidaten.shift() ?? []) : mock.selects.shift();
    return (ergebnis instanceof Error ? Promise.reject(ergebnis) : Promise.resolve(ergebnis)).then(ok, nein);
  };
  return k;
}

vi.mock("@/db", () => {
  const db = {
    select: () => kette(),
    insert: () => ({
      values: (v: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const neu: Array<{ id: number }> = [];
        for (const zeile of [v].flat()) {
          if (mock.insertFehler?.(zeile)) throw new Error("Verbindung abgebrochen");
          if (zeile.idempotencyKey && mock.inserts.some((x) => x.idempotencyKey === zeile.idempotencyKey)) {
            mock.konflikte.push(zeile);
            continue;
          }
          mock.inserts.push(zeile);
          neu.push({ id: mock.inserts.length });
          mock.log.push(`insert:${String(zeile.eventType)}`);
        }
        const r = Object.assign(Promise.resolve(undefined), { returning: async () => neu });
        return Object.assign(r, { onConflictDoNothing: () => r });
      },
    }),
    transaction: async (schritt: (tx: unknown) => Promise<unknown>) => schritt(db),
  };
  return { db };
});
vi.mock("./deal-inventory", () => ({
  loadDealInventoryPhotos: async (_ws: string, _deal: string, ids: string[]) => ids.map((id) => ({ id })),
  fotosErkennen: mock.erkennen,
  fotoItemsUebernehmen: mock.uebernehmen,
}));
vi.mock("./rechner/ausloeser", () => ({ kalkulationAnstossen: mock.kalkulation }));
vi.mock("./intern/intern-senden", () => ({ sendeAnInterne: mock.senden }));
vi.mock("./objects", () => ({
  getObjectBySlug: async (ws: string, slug: string) => (slug === "deals" ? { id: `deals-${ws}` } : null),
}));
vi.mock("./agent/agent-shared", () => ({
  getAdvancedStageIds: async (dealsObjekt: string) => new Set(dealsObjekt === "deals-ws" ? ["angebot-raus"] : []),
  getDealStageId: mock.stufeLesen,
}));
import { fotosAbarbeiten, fotosEinsammeln, fotosManuellAusgewertet, fotosVormerken } from "./inventar-fotos";

const JETZT = new Date("2026-10-09T12:00:00Z");
const stapel = (id: number, deal: string) => ({ id, workspaceId: "ws", dealRecordId: deal, payload: { attachmentIds: [`foto-${id}`] } });
const kandidat = (id: string, deal: string, conv: string) => ({
  id,
  workspaceId: "ws",
  dealRecordId: deal,
  conversationId: conv,
  mimeType: "image/jpeg",
  fileSize: 250_000,
  createdAt: new Date(JETZT.getTime() - 10 * 60_000),
});

describe("fotosAbarbeiten", () => {
  beforeEach(() => {
    mock.inserts.length = 0;
    mock.log.length = 0;
    mock.kandidaten = [];
    mock.erkennen.mockReset();
    mock.uebernehmen.mockReset();
    mock.kalkulation.mockReset();
    mock.senden.mockReset();
    mock.insertFehler = null;
  });

  it("erkennt gleichzeitig, übernimmt je Lead nacheinander, rechnet einmal je Lead", async () => {
    mock.selects = [[stapel(1, "d1"), stapel(2, "d1"), stapel(3, "d2")], []];
    mock.erkennen.mockImplementation(async () => ({ ok: true, items: [{ name: "Sofa" }], analyzed: 1, skipped: 0 }));
    const aktiv = new Map<string, number>();
    let ueberlappt = false;
    mock.uebernehmen.mockImplementation(async (_ws: string, deal: string) => {
      aktiv.set(deal, (aktiv.get(deal) ?? 0) + 1);
      if ((aktiv.get(deal) ?? 0) > 1) ueberlappt = true;
      await new Promise((r) => setTimeout(r, 5));
      aktiv.set(deal, (aktiv.get(deal) ?? 0) - 1);
      return { matched: 0, added: 1 };
    });

    const ergebnis = await fotosAbarbeiten(new Date("2026-10-09T12:00:00Z"));

    expect(ergebnis.map((e) => e.stapel).sort()).toEqual([1, 2, 3]);
    expect(mock.erkennen).toHaveBeenCalledTimes(3);
    // Nicht über die 1-Platz-Hintergrundspur des VPS, sonst warten die Fotos aufeinander.
    for (const aufruf of mock.erkennen.mock.calls) expect(aufruf[2]?.background).not.toBe(true);
    expect(ueberlappt).toBe(false);
    expect(mock.kalkulation.mock.calls.map((c) => c[1]).sort()).toEqual(["d1", "d2"]);
    expect(mock.inserts.filter((v) => v.eventType === "fotos_erledigt")).toHaveLength(3);
  });

  it("Fehler der Erkennung wird als Fehlversuch gebucht, ohne Kalkulation", async () => {
    mock.selects = [[stapel(1, "d1")], []];
    mock.erkennen.mockResolvedValue({ ok: false, error: "crm-tools job timeout", skipped: 0 });

    const ergebnis = await fotosAbarbeiten(new Date("2026-10-09T12:00:00Z"));

    expect(ergebnis).toEqual([{ stapel: 1, ergebnis: "fehler: crm-tools job timeout" }]);
    expect(mock.inserts.find((v) => v.eventType === "fotos_fehler")?.payload).toMatchObject({ bezug: 1, versuch: 1 });
    expect(mock.kalkulation).not.toHaveBeenCalled();
  });

  it("gescheiterte Fotos eines Leads: eine Meldung für alle, nicht eine je Foto", async () => {
    const alt = (bezug: number) => [
      { eventType: "fotos_versuch", payload: { bezug }, createdAt: new Date("2026-10-09T10:00:00Z") },
      { eventType: "fotos_fehler", payload: { bezug, error: "crm-tools job timeout" }, createdAt: new Date("2026-10-09T10:01:00Z") },
      { eventType: "fotos_versuch", payload: { bezug }, createdAt: new Date("2026-10-09T11:00:00Z") },
      { eventType: "fotos_fehler", payload: { bezug, error: "crm-tools job timeout" }, createdAt: new Date("2026-10-09T11:01:00Z") },
    ];
    mock.selects = [[stapel(1, "d1"), stapel(2, "d1"), stapel(3, "d1")], [...alt(1), ...alt(2), ...alt(3)], [{ dealNumber: "2026-080" }], [{ text: "Jonas" }]];

    await fotosAbarbeiten(new Date("2026-10-09T12:00:00Z"));

    expect(mock.inserts.filter((v) => v.eventType === "fotos_aufgegeben")).toHaveLength(3);
    expect(mock.senden).toHaveBeenCalledTimes(1);
    expect(mock.senden.mock.calls[0][1]).toContain("3 Fotos zu Auftrag 2026-080, Jonas");
  });

  it("Datenbankfehler bei einem Foto hält die anderen und die Kalkulation nicht auf", async () => {
    mock.selects = [[stapel(1, "d1"), stapel(2, "d2")], []];
    mock.erkennen.mockResolvedValue({ ok: true, items: [{ name: "Sofa" }], analyzed: 1, skipped: 0 });
    mock.uebernehmen.mockResolvedValue({ matched: 0, added: 1 });
    mock.insertFehler = (v) => v.eventType === "fotos_erledigt" && (v.payload as { bezug?: number }).bezug === 1;

    const ergebnis = await fotosAbarbeiten(new Date("2026-10-09T12:00:00Z"));

    expect(ergebnis.find((e) => e.stapel === 1)?.ergebnis).toContain("Verbindung abgebrochen");
    expect(ergebnis.find((e) => e.stapel === 2)?.ergebnis).toBe("1 Fotos, 0 zugeordnet, 1 neu");
    expect(mock.kalkulation.mock.calls.map((c) => c[1]).sort()).toEqual(["d1", "d2"]);
  });
});

describe("fotosEinsammeln", () => {
  beforeEach(() => {
    mock.inserts.length = 0;
    mock.konflikte.length = 0;
    mock.log.length = 0;
    mock.kandidaten = [];
    mock.stufen = {};
    mock.stufeLesen.mockReset();
    mock.stufeLesen.mockImplementation(async (_objekt: string, deal: string) => mock.stufen[deal] ?? null);
    mock.erkennen.mockReset();
    mock.erkennen.mockResolvedValue({ ok: true, items: [{ name: "Sofa" }], analyzed: 1, skipped: 0 });
    mock.uebernehmen.mockReset();
    mock.uebernehmen.mockResolvedValue({ matched: 0, added: 1 });
    mock.kalkulation.mockReset();
    mock.insertFehler = null;
  });

  it("Foto einer pausierten Unterhaltung wird vorgemerkt und im selben Lauf erkannt (10 von 12 Leads seit 30.09.)", async () => {
    // Bei pausierten Unterhaltungen kommt der Agent nie bis zum Vormerken; nur der Cron sieht das Foto.
    // Die Bedingungen der Abfrage sieht diese Attrappe nicht: dass kein Filter auf ai_paused oder
    // ai_needs_reply zurückkommt, prüft „einsammelAbfrage > eingehende Bilder an Leads, egal ob
    // pausiert oder schon beantwortet“ in inventar-fotos.test.ts.
    mock.kandidaten = [[kandidat("foto-p", "d1", "conv-pausiert")]];
    mock.selects = [[{ ...stapel(1, "d1"), payload: { attachmentIds: ["foto-p"] } }], []];

    const ergebnis = await fotosAbarbeiten(JETZT);

    expect(mock.inserts.filter((v) => v.eventType === "fotos_offen")).toEqual([
      expect.objectContaining({ workspaceId: "ws", dealRecordId: "d1", conversationId: "conv-pausiert", payload: { attachmentIds: ["foto-p"] } }),
    ]);
    // Erst einsammeln, dann die Warteschlange lesen: das Foto kommt im selben Lauf dran.
    expect(mock.log.indexOf("insert:fotos_offen")).toBeGreaterThanOrEqual(0);
    expect(mock.log.indexOf("insert:fotos_offen")).toBeLessThan(mock.log.indexOf("select:agent_events"));
    expect(ergebnis).toEqual([{ stapel: 1, ergebnis: "1 Fotos, 0 zugeordnet, 1 neu" }]);
  });

  it("Lead in fortgeschrittener Stufe wird nicht vorgemerkt, Stufe gelesen wie beim Agenten", async () => {
    mock.kandidaten = [[kandidat("foto-a", "d-angebot", "c1"), kandidat("foto-b", "d-neu", "c2")]];
    mock.stufen = { "d-angebot": "angebot-raus", "d-neu": "neue-anfrage" };

    expect(await fotosEinsammeln(JETZT)).toBe(1);

    expect(mock.inserts.filter((v) => v.eventType === "fotos_offen").map((v) => v.dealRecordId)).toEqual(["d-neu"]);
    expect(mock.stufeLesen).toHaveBeenCalledWith("deals-ws", "d-angebot");
  });

  it("scheitert das Einsammeln, werden schon vorgemerkte Fotos trotzdem erkannt", async () => {
    mock.kandidaten = [new Error("Abfrage abgebrochen")];
    mock.selects = [[stapel(1, "d1")], []];
    const fehler = vi.spyOn(console, "error").mockImplementation(() => {});

    const ergebnis = await fotosAbarbeiten(JETZT);
    const fehlerAufrufe = [...fehler.mock.calls];
    fehler.mockRestore();

    expect(ergebnis).toEqual([{ stapel: 1, ergebnis: "1 Fotos, 0 zugeordnet, 1 neu" }]);
    expect(fehlerAufrufe).toContainEqual([expect.stringContaining("Einsammeln"), expect.any(Error)]);
  });

  it("dasselbe Foto aus Agent und Cron ergibt denselben Schlüssel: ein Stapel, nicht als eingesammelt gezählt", async () => {
    // Gleichzeitig: die Abfrage des Crons lief, bevor der Agent sein Vormerken gebucht hatte.
    expect(await fotosVormerken("ws", "d1", "c1", ["foto-b", "foto-a"])).toBe(2);
    mock.kandidaten = [[kandidat("foto-a", "d1", "c1")]];

    expect(await fotosEinsammeln(JETZT)).toBe(0);

    const schluesselVon = (zeilen: Array<Record<string, unknown>>, foto: string) =>
      zeilen.filter((v) => (v.payload as { attachmentIds: string[] }).attachmentIds.join() === foto).map((v) => v.idempotencyKey);
    expect(mock.inserts.filter((v) => v.eventType === "fotos_offen")).toHaveLength(2);
    expect(schluesselVon(mock.konflikte, "foto-a")).toEqual(schluesselVon(mock.inserts, "foto-a"));
  });

  it("nach 30 Sekunden hört das Einsammeln auf, der Rest kommt im nächsten Lauf", async () => {
    // Jede Stufenabfrage dauert hier 20 s: nach dem zweiten Lead ist das Budget verbraucht.
    let uhr = 0;
    mock.stufeLesen.mockImplementation(async () => {
      uhr += 20_000;
      return null;
    });
    mock.kandidaten = [[kandidat("foto-1", "d1", "c1"), kandidat("foto-2", "d2", "c2"), kandidat("foto-3", "d3", "c3")]];
    const hinweis = vi.spyOn(console, "warn").mockImplementation(() => {});

    const anzahl = await fotosEinsammeln(JETZT, () => uhr);
    const hinweise = [...hinweis.mock.calls];
    hinweis.mockRestore();

    expect(anzahl).toBe(2);
    expect(mock.inserts.filter((v) => v.eventType === "fotos_offen").map((v) => v.dealRecordId)).toEqual(["d1", "d2"]);
    expect(mock.stufeLesen).toHaveBeenCalledTimes(2);
    expect(hinweise).toContainEqual([expect.stringContaining("angehalten")]);
  });
});

describe("fotosManuellAusgewertet", () => {
  beforeEach(() => {
    mock.inserts.length = 0;
    mock.konflikte.length = 0;
    mock.log.length = 0;
    mock.kandidaten = [];
    mock.selects = [[]];
    mock.insertFehler = null;
  });
  it("vermerkt von Hand ausgewertete Fotos als erledigten Stapel, damit das KV-Fenster nicht mehr warnt", async () => {
    await fotosManuellAusgewertet("ws", "d1", ["a", "b"]);
    expect(mock.inserts).toEqual([
      expect.objectContaining({ eventType: "fotos_offen", dealRecordId: "d1", payload: { attachmentIds: ["a", "b"], manuell: true } }),
      expect.objectContaining({ eventType: "fotos_erledigt", payload: { bezug: 1, manuell: true, analysiert: 2 }, idempotencyKey: "fotos-erledigt:1" }),
    ]);
  });
  it("schließt offene Stapel mit denselben Fotos, sonst erkennt der Cron sie noch einmal (doppelte Zeilen im Umzugsgut)", async () => {
    // Offene Stapel des Leads: 7 nur mit Foto a, 8 mit einem anderen Foto, 9 nur zum Teil von Hand ausgewertet.
    mock.selects = [[
      { id: 7, payload: { attachmentIds: ["a"] } },
      { id: 8, payload: { attachmentIds: ["x"] } },
      { id: 9, payload: { attachmentIds: ["b", "y"] } },
    ]];

    await fotosManuellAusgewertet("ws", "d1", ["a", "b"], JETZT);

    const erledigt = mock.inserts.filter((v) => v.eventType === "fotos_erledigt");
    expect(erledigt).toContainEqual(
      expect.objectContaining({ dealRecordId: "d1", payload: { bezug: 7, manuell: true }, idempotencyKey: "fotos-erledigt:7" })
    );
    expect(erledigt.map((v) => (v.payload as { bezug: number }).bezug)).not.toContain(8);
    expect(erledigt.map((v) => (v.payload as { bezug: number }).bezug)).not.toContain(9);

    // Der nächste Cron-Lauf erkennt Stapel 7 nicht mehr, Stapel 8 schon.
    mock.erkennen.mockReset();
    mock.erkennen.mockResolvedValue({ ok: true, items: [{ name: "Sofa" }], analyzed: 1, skipped: 0 });
    mock.uebernehmen.mockResolvedValue({ matched: 0, added: 1 });
    mock.selects = [
      [stapel(7, "d1"), stapel(8, "d1")],
      erledigt.map((v) => ({ eventType: v.eventType, payload: v.payload, createdAt: JETZT })),
    ];
    const ergebnis = await fotosAbarbeiten(JETZT);
    expect(ergebnis.map((e) => e.stapel)).toEqual([8]);
  });

  it("nichts ausgewertet: nichts vermerken", async () => {
    await fotosManuellAusgewertet("ws", "d1", []);
    expect(mock.inserts).toEqual([]);
  });
});
