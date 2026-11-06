import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  batchGetRecordDisplayNames: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/services/display-names", () => ({ batchGetRecordDisplayNames: mocks.batchGetRecordDisplayNames }));

import { INBOX_GRENZE, ladeInboxListe } from "./inbox-neu";

const JETZT = new Date("2026-11-06T11:00:00.000Z");
const dialect = new PgDialect();
const abfrage = (i: number) => dialect.sqlToQuery(mocks.execute.mock.calls[i][0] as SQL);

function dbZeile(teil: Record<string, unknown>) {
  return {
    gespraech_id: "c1",
    deal_id: null,
    kanal: "whatsapp",
    firma_id: "f_kottke",
    person_id: null,
    kontakt_name: null,
    email: null,
    telefon: null,
    subject: null,
    external_thread_id: null,
    zeit: "2026-11-06 10:00:00",
    vorschau: "Hallo",
    ungelesen: 0,
    lane: "lead",
    letzte_richtung: "inbound",
    letzte_am: "2026-11-06 10:00:00",
    waiting_on: null,
    waiting_since: null,
    waiting_reason: null,
    stufe_id: null,
    stufe_titel: null,
    stufe_kategorie: null,
    entwurf_sequenz: null,
    entwurf_am: null,
    hat_entwurf: false,
    ...teil,
  };
}

function antworten(gespraeche: unknown[], firmen: unknown[] = [{ id: "f_kottke" }, { id: "f_ceylan" }]) {
  mocks.execute
    .mockResolvedValueOnce(gespraeche)
    .mockResolvedValueOnce(firmen)
    .mockResolvedValueOnce([
      { id: "s_neu", title: "Neue Anfrage" },
      { id: "s_angebot", title: "Angebot" },
    ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.batchGetRecordDisplayNames.mockResolvedValue(
    new Map([
      ["f_kottke", { displayName: "Kottke Umzüge", objectSlug: "operating_companies", objectName: "Firma" }],
      ["f_ceylan", { displayName: "Ceylan", objectSlug: "operating_companies", objectName: "Firma" }],
      ["p_weber", { displayName: "Familie Weber", objectSlug: "people", objectName: "Person" }],
      ["p_weg", { displayName: "Unknown", objectSlug: "", objectName: "" }],
    ]),
  );
});

describe("ladeInboxListe", () => {
  it("baut Einträge, Chips, Firmen und Stufen aus drei Abfragen plus einem Namensaufruf", async () => {
    antworten([
      dbZeile({
        gespraech_id: "c_wa",
        deal_id: "d1",
        person_id: "p_weber",
        zeit: "2026-11-06 10:30:00",
        letzte_am: "2026-11-06 10:30:00",
        ungelesen: 2,
        waiting_on: "uns",
        waiting_since: "2026-11-06 10:30:00",
        waiting_reason: "Kunde wartet auf Antwort",
        stufe_id: "s_neu",
        stufe_titel: "Neue Anfrage",
        stufe_kategorie: null,
        hat_entwurf: true,
        entwurf_sequenz: "nachfass",
        entwurf_am: "2026-11-06 09:00:00",
      }),
      dbZeile({
        gespraech_id: "c_ka",
        deal_id: "d1",
        kanal: "email",
        kontakt_name: "Weber über Kleinanzeigen",
        email: "abc-0123456789abcdef0123456789abcdef01234567-ek-ek@mail.kleinanzeigen.de",
        zeit: "2026-11-05 08:00:00",
        vorschau: "Nachricht von Weber Hallo, ist das noch frei? Beantworte diese Nachricht bitte",
        ungelesen: 1,
        stufe_id: "s_neu",
        stufe_titel: "Neue Anfrage",
      }),
      dbZeile({
        gespraech_id: "c_info",
        lane: "info",
        kontakt_name: "+49 170 1234567",
        telefon: "+491701234567",
        firma_id: null,
        zeit: "2026-11-06 10:50:00",
        vorschau: "Du: Ihr Code lautet 1234",
        letzte_richtung: "outbound",
      }),
      dbZeile({ gespraech_id: "c_alt", person_id: "p_weg", kontakt_name: "Herr Alt", zeit: null, letzte_richtung: null }),
    ]);

    const liste = await ladeInboxListe("ws_1", { jetzt: JETZT });

    expect(mocks.execute).toHaveBeenCalledTimes(3);
    expect(mocks.batchGetRecordDisplayNames).toHaveBeenCalledTimes(1);
    expect(new Set(mocks.batchGetRecordDisplayNames.mock.calls[0][0])).toEqual(
      new Set(["f_kottke", "f_ceylan", "p_weber", "p_weg"]),
    );

    expect(liste.eintraege.map((e) => e.key)).toEqual(["deal:d1", "gespraech:c_alt", "gespraech:c_info"]);
    const [deal, alt, info] = liste.eintraege;
    expect(deal).toMatchObject({
      gespraechIds: ["c_wa", "c_ka"],
      name: "Familie Weber",
      kuerzel: "FW",
      kanal: "whatsapp",
      kanaele: ["whatsapp", "kleinanzeigen"],
      kleinanzeigen: true,
      ungelesen: 3,
      zeit: "2026-11-06T10:30:00.000Z",
      wartet: { auf: "uns", seit: "2026-11-06T10:30:00.000Z", text: "wartet auf uns · 30 Min" },
      kiEntwurf: { text: "KI-Entwurf · Nachfass" },
      stufe: { id: "s_neu", label: "Neue Anfrage", ton: "blau" },
      firma: { id: "f_kottke", name: "Kottke Umzüge" },
      gruppe: "haupt",
    });
    // Gelöschte Person: Name aus dem Kontakt.
    expect(alt).toMatchObject({ name: "Herr Alt", zeit: null, zeitText: "", wartet: { auf: "niemand", text: null } });
    expect(info).toMatchObject({
      name: "+49 170 …",
      kuerzel: "?",
      vorschau: "Ihr Code lautet 1234",
      vorschauPraefix: "Du:",
      gruppe: "info",
      laneText: "Info",
      firma: null,
    });

    expect(liste.chips).toEqual({ ungelesen: 1, wartenAufUns: 1, kiEntwuerfe: 1, infoKeinLead: 1 });
    expect(liste.firmen).toEqual([
      { id: "f_ceylan", name: "Ceylan" },
      { id: "f_kottke", name: "Kottke Umzüge" },
    ]);
    expect(liste.stufen).toEqual([
      { id: "s_neu", label: "Neue Anfrage" },
      { id: "s_angebot", label: "Angebot" },
    ]);
    expect(liste.abgeschnitten).toBe(false);
  });

  it("Kleinanzeigen-Vorschau bereinigt wie die alte Liste", async () => {
    antworten([
      dbZeile({
        gespraech_id: "c_ka",
        kanal: "email",
        kontakt_name: "Anna über Kleinanzeigen",
        external_thread_id: "abc-0123456789abcdef0123456789abcdef01234567-ek-ek@mail.kleinanzeigen.de",
        vorschau: "Hallo, ist das noch frei? Beantworte diese Nachricht bitte über Kleinanzeigen.",
      }),
    ]);
    const [e] = (await ladeInboxListe("ws_1", { jetzt: JETZT })).eintraege;
    expect(e).toMatchObject({ name: "Anna", kleinanzeigen: true, kanaele: ["kleinanzeigen"], vorschau: "Hallo, ist das noch frei?" });
  });

  it("Abfrage: Workspace, ohne Spam, lebende Deals, Obergrenze 501, ohne Nuri-Entwürfe, ohne interne Fotos", async () => {
    antworten([]);
    await ladeInboxListe("ws_1", { jetzt: JETZT });
    const { sql, params } = abfrage(0);
    expect(params).toContain("ws_1");
    expect(params).toContain(INBOX_GRENZE + 1);
    expect(params).toContain("03a7e3d4-7162-4021-ba75-c20d3e3ae112");
    expect(params).toContain("internal-photo:%");
    expect(sql).toMatch(/c\.status <> 'spam' AND c\.lane <> 'spam'/);
    expect(sql).toMatch(/d\.deleted_at IS NULL/);
    expect(sql).toMatch(/LEFT JOIN deal_workflow_state w/);
    expect(sql).not.toMatch(/treffer/);
    expect(abfrage(1).params).toEqual(["ws_1"]);
    expect(abfrage(2).params).toEqual(["ws_1"]);
  });

  it("abgeschnitten, wenn mehr als 500 Gespräche kommen", async () => {
    antworten(Array.from({ length: INBOX_GRENZE + 1 }, (_, i) => dbZeile({ gespraech_id: `c${i}` })));
    const liste = await ladeInboxListe("ws_1", { jetzt: JETZT });
    expect(liste.abgeschnitten).toBe(true);
    expect(liste.eintraege).toHaveLength(INBOX_GRENZE);
  });

  it("Suche: maskiertes ILIKE-Muster, Treffer samt ihrer Deals, Ziffernsuche für Nummern", async () => {
    antworten([]);
    await ladeInboxListe("ws_1", { suche: "  50%_Weber ", jetzt: JETZT });
    const { sql, params } = abfrage(0);
    expect(params).toContain("%50\\%\\_Weber%");
    expect(sql).toMatch(/WITH treffer AS/);
    expect(sql).toMatch(/c\.deal_record_id IN \(SELECT t\.deal_record_id FROM treffer t/);
    expect(sql).toMatch(/m2\.body ILIKE/);
    expect(sql).toMatch(/pv\.json_value->>'fullName'/);
    expect(sql).toMatch(/pr\.deleted_at IS NULL/);
    expect(sql).not.toMatch(/regexp_replace/);

    antworten([]);
    await ladeInboxListe("ws_1", { suche: "0170 123", jetzt: JETZT });
    const nummer = abfrage(3);
    expect(nummer.sql).toMatch(/regexp_replace/);
    expect(nummer.params).toContain("%170123%");
  });
});
