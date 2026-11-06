import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getDealInventory: vi.fn(),
  ladeAktiveAnnahme: vi.fn(),
  listDealEmployees: vi.fn(),
  listPayments: vi.fn(),
  ladeNachfassSchalter: vi.fn(),
  offenerRest: vi.fn(),
  ladeZahlungsmeldungen: vi.fn(),
}));

// Nur `db.execute` ist erlaubt; jeder andere Zugriff lässt den Test scheitern.
vi.mock("@/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "execute") return mocks.execute;
        if (p === "then" || typeof p === "symbol") return undefined;
        throw new Error(`@/db im Test (${String(p)})`);
      },
    }
  ),
}));
vi.mock("@/services/deal-inventory", () => ({ getDealInventory: mocks.getDealInventory }));
vi.mock("@/services/kva-annahme", () => ({ ladeAktiveAnnahme: mocks.ladeAktiveAnnahme }));
vi.mock("@/services/employees", () => ({ listDealEmployees: mocks.listDealEmployees }));
vi.mock("@/services/financial", () => ({ listPayments: mocks.listPayments }));
vi.mock("@/services/nachfass-schalter", () => ({ ladeNachfassSchalter: mocks.ladeNachfassSchalter }));
vi.mock("@/services/offener-rest", () => ({ offenerRest: mocks.offenerRest }));
vi.mock("@/services/zahlungsmeldungen", () => ({ ladeZahlungsmeldungen: mocks.ladeZahlungsmeldungen }));

import { ladeAblaufFakten } from "./ablauf-fakten";
import { berechneAblauf } from "@/lib/ablauf";

const WS = "ws_1";
const DEAL = "deal_1";

const dialekt = new PgDialect();
const gerendert = (q: unknown) => {
  const r = dialekt.sqlToQuery(q as SQL);
  return { text: r.sql.replace(/\s+/g, " ").trim(), params: r.params };
};

type Antworten = { deal: unknown[]; neben: unknown[]; version: unknown[]; angebot: unknown[] };

/** Antwort je Abfrage, erkannt am SQL-Text. */
function dbAntwortet(a: Antworten) {
  mocks.execute.mockImplementation(async (q: unknown) => {
    const { text } = gerendert(q);
    if (text.includes("FROM quotations q")) return a.angebot;
    if (text.includes("FROM deal_calculation_versions v")) return a.version;
    if (text.includes("FROM agent_events e")) return a.neben;
    if (text.includes("FROM records r")) return a.deal;
    throw new Error(`unerwartete Abfrage: ${text}`);
  });
}

const NACHFASS = {
  an: true,
  modus: "sendet" as const,
  text: "automatisch, sendet",
  regeln: [
    { tag: 2 as const, gesendetAm: null, geplantAm: "2026-11-06T08:00:00.000Z", art: "auto" as const },
    { tag: 7 as const, gesendetAm: null, geplantAm: "2026-11-11T08:00:00.000Z", art: "auto" as const },
    { tag: 10 as const, gesendetAm: null, geplantAm: "2026-11-14T08:00:00.000Z", art: "auto" as const },
  ],
};

const LEERER_DEAL = {
  erstellt_am: "2026-11-03 08:14:00",
  quelle: null,
  erste_antwort_am: null,
  umzugsdatum: null,
  durchgefuehrt_am: null,
  rechnung_faellig_am: null,
  bewertung_status: null,
  bewertung_am: null,
  stufe: "open_new",
  besichtigung_am: null,
  unterschrift_aktiv: null,
};

const LEERE_NEBEN = {
  foto_am: null,
  fotos: "0",
  geoeffnet: "0",
  zuletzt_geoeffnet: null,
  ab_am: null,
  rechnung_am: null,
  termin_datum: null,
  termin_von: null,
  termin_bis: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDealInventory.mockResolvedValue([]);
  mocks.ladeAktiveAnnahme.mockResolvedValue(null);
  mocks.listDealEmployees.mockResolvedValue([]);
  mocks.listPayments.mockResolvedValue([]);
  mocks.ladeNachfassSchalter.mockResolvedValue({ ...NACHFASS, modus: "entwurf", regeln: NACHFASS.regeln.map((r) => ({ ...r, geplantAm: null })) });
  mocks.offenerRest.mockResolvedValue({ gesamtCent: null, bezahltCent: 0, restCent: null, quelle: "keins" });
  mocks.ladeZahlungsmeldungen.mockResolvedValue([]);
});

describe("ladeAblaufFakten", () => {
  it("Deal ohne Version, Angebot, Gespräch, Annahme und Team liefert gültige Fakten", async () => {
    dbAntwortet({ deal: [LEERER_DEAL], neben: [LEERE_NEBEN], version: [], angebot: [] });

    const f = await ladeAblaufFakten(WS, DEAL);

    expect(f).toEqual({
      erstelltAm: "2026-11-03T08:14:00.000Z",
      quelle: null,
      ersteAntwortAm: null,
      fotos: 0,
      fotoanalyseAm: null,
      volumenCbm: null,
      zugang: null,
      halteverbot: null,
      besichtigungAm: null,
      leistung: "move",
      kalkulation: null,
      kv: null,
      unterschriftAktiv: false,
      nachfass: { modus: "entwurf", text: "automatisch, sendet", regeln: expect.any(Array) },
      annahme: null,
      abAm: null,
      team: { personen: 0, namen: [] },
      einsatz: null,
      termin: null,
      durchgefuehrtAm: null,
      rechnung: null,
      rest: { restCent: null, quelle: "keins" },
      letzteZahlungAm: null,
      offeneMeldungen: 0,
      bewertung: { status: null, am: null },
      stageCategory: "open_new",
    });

    // Die Fakten tragen die reine Ableitung: Anfrage erledigt, Fotos jetzt.
    const { schritte, position } = berechneAblauf(f, new Date("2026-11-05T09:00:00.000Z"));
    expect(position).toBe(2);
    expect(schritte[1].zeile).toBe("Fotos und Angaben fehlen noch");
    expect(schritte[3].zeile).toBe("Noch kein KV");
  });

  it("jede Abfrage filtert auf Workspace und Deal, die Dienste bekommen Workspace und Deal", async () => {
    dbAntwortet({ deal: [LEERER_DEAL], neben: [LEERE_NEBEN], version: [], angebot: [] });
    await ladeAblaufFakten(WS, DEAL);

    expect(mocks.execute).toHaveBeenCalledTimes(4);
    for (const [q] of mocks.execute.mock.calls) {
      const { params } = gerendert(q);
      expect(params).toContain(WS);
      expect(params).toContain(DEAL);
    }
    expect(mocks.getDealInventory).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.ladeNachfassSchalter).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.offenerRest).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.ladeZahlungsmeldungen).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.ladeAktiveAnnahme).toHaveBeenCalledWith(DEAL);
    expect(mocks.listDealEmployees).toHaveBeenCalledWith(DEAL);
    expect(mocks.listPayments).toHaveBeenCalledWith(DEAL);
  });

  it("fremder oder fehlender Deal: Fehler, keine weiteren Abfragen", async () => {
    dbAntwortet({ deal: [], neben: [LEERE_NEBEN], version: [], angebot: [] });
    await expect(ladeAblaufFakten(WS, DEAL)).rejects.toThrow("Deal nicht gefunden");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(mocks.getDealInventory).not.toHaveBeenCalled();
  });

  it("voller Stand: Fakten aus Attributen, Version, Angebot, Link, Dokumenten, Team und Zahlungen", async () => {
    dbAntwortet({
      deal: [
        {
          ...LEERER_DEAL,
          quelle: "Kleinanzeigen",
          erste_antwort_am: "2026-11-03 08:21:00",
          umzugsdatum: "2026-11-21",
          durchgefuehrt_am: "2026-11-21 13:00:00",
          rechnung_faellig_am: "2026-12-06",
          bewertung_status: "sent_whatsapp",
          bewertung_am: "2026-11-25 09:00:00",
          stufe: "paid",
          besichtigung_am: "2026-11-04",
          unterschrift_aktiv: true,
        },
      ],
      neben: [
        {
          foto_am: "2026-11-03 10:00:00",
          fotos: "14",
          geoeffnet: "3",
          zuletzt_geoeffnet: "2026-11-05 07:00:00",
          ab_am: "2026-11-06 09:00:00",
          rechnung_am: "2026-11-22 09:00:00",
          termin_datum: "2026-11-21",
          termin_von: "07:30",
          termin_bis: "13:00",
        },
      ],
      version: [
        {
          version: 2,
          status: "gesperrt",
          sent_at: "2026-11-04 09:00:00",
          gesperrt_von: "Dario",
          overrides: JSON.stringify([
            { id: "u1", art: "eingabe", key: "volumen", rechnerwert: 30, wert: 38, grund: "Keller dazu", autor: { userId: "u", quelle: "mensch" }, zeit: "", fotoRef: null },
          ]),
          rechner_request: { von_etage: "2", von_aufzug: "keiner", von_halteverbot: "on", nach_halteverbot: "on" },
          rechner_result: {
            preis: { festpreis: 2480, selbstkosten: 1540, margeProzent: 40, margeWirksamProzent: 38 },
            volumen: { nettoCbm: 36 },
            fahrzeugoptionen: [{ id: "b", name: "Sprinter L", fahrten: 2, km: 20, fahrtMin: 70, teamgroesse: 3 }],
            empfehlungOptionId: "b",
            zeiten: { fahrtMin: 72 },
            team: { groesse: 3 },
            kosten: {
              selbstkosten: 1540,
              personenH: 16.5,
              posten: [
                { key: "personal.fahrt", bezeichnung: "Fahrt", menge: 3.6, einheit: "h", satz: 15, betrag: 54 },
                { key: "personal.arbeit", bezeichnung: "Arbeit", menge: 16.5, einheit: "h", satz: 20, betrag: 330 },
                { key: "fahrzeug", bezeichnung: "Fahrzeug", menge: 1, einheit: null, satz: null, betrag: 150 },
              ],
            },
          },
        },
      ],
      angebot: [
        {
          festpreis: "2480.00",
          is_variable: false,
          gueltig_bis: "2026-11-18",
          deposit_required_cents: 50000,
          service_type: "move",
          mit_entruempelung: true,
          kv_version: 2,
          kv_gesendet_am: "2026-11-04 09:00:00",
          ohne_version: false,
          kv_dokument_am: "2026-11-01 09:00:00",
        },
      ],
    });
    mocks.getDealInventory.mockResolvedValue([
      { moveFlag: true, volumeCbmEstimate: "30.5" },
      { moveFlag: true, volumeCbmEstimate: "7.5" },
      { moveFlag: false, volumeCbmEstimate: "9" },
      { moveFlag: true, volumeCbmEstimate: null },
    ]);
    mocks.ladeAktiveAnnahme.mockResolvedValue({
      workspaceId: WS,
      signedAt: new Date("2026-11-05T08:00:00.000Z"),
      unterschriftAt: new Date("2026-11-05T08:05:00.000Z"),
      vertragDocumentId: "doc_1",
    });
    mocks.listDealEmployees.mockResolvedValue([
      { employeeName: "Ali" },
      { employeeName: "Ben" },
      { employeeName: "Cem" },
    ]);
    mocks.listPayments.mockResolvedValue([
      { workspaceId: WS, date: "2026-11-10", taxTreatment: "betriebseinnahme" },
      { workspaceId: WS, date: "2026-11-24", taxTreatment: "betriebseinnahme" },
      { workspaceId: WS, date: "2026-11-30", taxTreatment: "nicht_steuerbar" },
      { workspaceId: "ws_fremd", date: "2026-12-01", taxTreatment: "betriebseinnahme" },
    ]);
    mocks.ladeNachfassSchalter.mockResolvedValue(NACHFASS);
    mocks.offenerRest.mockResolvedValue({ gesamtCent: 248000, bezahltCent: 248000, restCent: 0, quelle: "annahme" });
    mocks.ladeZahlungsmeldungen.mockResolvedValue([{ eventId: "e1" }]);

    const f = await ladeAblaufFakten(WS, DEAL);

    expect(f).toEqual({
      erstelltAm: "2026-11-03T08:14:00.000Z",
      quelle: "Kleinanzeigen",
      ersteAntwortAm: "2026-11-03T08:21:00.000Z",
      fotos: 14,
      fotoanalyseAm: "2026-11-03T10:00:00.000Z",
      volumenCbm: 38,
      zugang: "2. OG ohne Aufzug",
      halteverbot: "Halteverbot beidseitig",
      besichtigungAm: "2026-11-04",
      leistung: "clearance_move",
      kalkulation: {
        version: 2,
        status: "gesperrt",
        selbstkostenCent: 154000,
        margeProzent: 38,
        geprueftVon: "Dario",
        anpassungen: 1,
        ersteAnpassung: { key: "volumen", grund: "Keller dazu" },
        neuerEntwurf: null,
      },
      kv: {
        version: 2,
        betragCent: 248000,
        istStunden: false,
        gesendetAm: "2026-11-04T09:00:00.000Z",
        gueltigBis: "2026-11-18",
        anzahlungCent: 50000,
        geoeffnet: 3,
        zuletztGeoeffnet: "2026-11-05T07:00:00.000Z",
      },
      unterschriftAktiv: true,
      nachfass: { modus: "sendet", text: "automatisch, sendet", regeln: NACHFASS.regeln },
      annahme: { am: "2026-11-05T08:00:00.000Z", unterschriftAm: "2026-11-05T08:05:00.000Z" },
      abAm: "2026-11-06T09:00:00.000Z",
      team: { personen: 3, namen: ["Ali", "Ben", "Cem"] },
      einsatz: { fahrzeug: "Sprinter L", fahrtH: 1.2, arbeitH: 5.5, satzFahrtEur: 15, satzArbeitEur: 20, fahrzeugEur: 150 },
      termin: { datum: "2026-11-21", von: "07:30", bis: "13:00" },
      durchgefuehrtAm: "2026-11-21T13:00:00.000Z",
      rechnung: { am: "2026-11-22T09:00:00.000Z", faelligAm: "2026-12-06" },
      rest: { restCent: 0, quelle: "annahme" },
      letzteZahlungAm: "2026-11-24",
      offeneMeldungen: 1,
      bewertung: { status: "sent_whatsapp", am: "2026-11-25T09:00:00.000Z" },
      stageCategory: "paid",
    });
  });

  it("Stunden-KV: kein Betrag; Unterschrift ohne Vertrag ist nur reserviert; Termin aus move_date ohne Auswahl", async () => {
    dbAntwortet({
      deal: [{ ...LEERER_DEAL, umzugsdatum: "2026-11-28" }],
      neben: [{ ...LEERE_NEBEN, termin_datum: "2026-11-21", termin_von: "07:30", termin_bis: null }],
      version: [],
      angebot: [
        {
          festpreis: null,
          is_variable: true,
          gueltig_bis: null,
          deposit_required_cents: null,
          service_type: "clearance",
          mit_entruempelung: null,
          kv_version: null,
          kv_gesendet_am: null,
          ohne_version: true,
          kv_dokument_am: null,
        },
      ],
    });
    mocks.ladeAktiveAnnahme.mockResolvedValue({
      workspaceId: WS,
      signedAt: new Date("2026-11-05T08:00:00.000Z"),
      unterschriftAt: new Date("2026-11-05T08:05:00.000Z"),
      vertragDocumentId: null,
    });

    const f = await ladeAblaufFakten(WS, DEAL);

    expect(f.leistung).toBe("clearance");
    expect(f.kv).toEqual({
      version: null,
      betragCent: null,
      istStunden: true,
      gesendetAm: null,
      gueltigBis: null,
      anzahlungCent: null,
      geoeffnet: 0,
      zuletztGeoeffnet: null,
    });
    expect(f.annahme).toEqual({ am: "2026-11-05T08:00:00.000Z", unterschriftAm: null });
    // Das Umzugsdatum gilt; das Zeitfenster gehört zu einem anderen Tag und entfällt.
    expect(f.termin).toEqual({ datum: "2026-11-28", von: null, bis: null });
  });

  it("gesperrte v2 und neuer Entwurf v3: Kalkulation und KV aus v2, neuerEntwurf 3", async () => {
    dbAntwortet({
      deal: [LEERER_DEAL],
      neben: [LEERE_NEBEN],
      version: [
        { version: 3, status: "entwurf", sent_at: null, gesperrt_von: null, overrides: [], rechner_request: null, rechner_result: { preis: { selbstkosten: 1700 } } },
        { version: 2, status: "gesperrt", sent_at: "2026-11-04 09:00:00", gesperrt_von: "Dario", overrides: [], rechner_request: { von_etage: "2", von_aufzug: "keiner" }, rechner_result: { preis: { selbstkosten: 1540, margeWirksamProzent: 38 } } },
      ],
      angebot: [
        { festpreis: "2480.00", is_variable: false, gueltig_bis: "2026-11-18", deposit_required_cents: null, service_type: "move", mit_entruempelung: null, kv_version: 2, kv_gesendet_am: "2026-11-04 09:00:00", ohne_version: false, kv_dokument_am: null },
      ],
    });

    const f = await ladeAblaufFakten(WS, DEAL);

    expect(f.kalkulation).toEqual({
      version: 2,
      status: "gesperrt",
      selbstkostenCent: 154000,
      margeProzent: 38,
      geprueftVon: "Dario",
      anpassungen: 0,
      ersteAnpassung: null,
      neuerEntwurf: 3,
    });
    expect(f.zugang).toBe("2. OG ohne Aufzug");
    expect(f.kv).toMatchObject({ version: 2, gesendetAm: "2026-11-04T09:00:00.000Z" });
    const { sql: text } = dialekt.sqlToQuery(
      mocks.execute.mock.calls.map(([q]) => q).find((q) => gerendert(q).text.includes("FROM deal_calculation_versions v")) as SQL
    );
    expect(text).toContain("DISTINCT ON (v.status = 'gesperrt')");
  });

  it("nur Entwurf: Entwurf trägt die Kalkulation", async () => {
    dbAntwortet({
      deal: [LEERER_DEAL],
      neben: [LEERE_NEBEN],
      version: [{ version: 1, status: "entwurf", sent_at: null, gesperrt_von: "Dario", overrides: [], rechner_request: null, rechner_result: null }],
      angebot: [],
    });
    expect((await ladeAblaufFakten(WS, DEAL)).kalkulation).toMatchObject({ version: 1, status: "entwurf", geprueftVon: null, neuerEntwurf: null });
  });

  it("KV ohne Versionsbezug: gesendet ab dem ersten KV-Dokument", async () => {
    dbAntwortet({
      deal: [LEERER_DEAL],
      neben: [LEERE_NEBEN],
      version: [],
      angebot: [
        { festpreis: "1200.00", is_variable: false, gueltig_bis: null, deposit_required_cents: null, service_type: "move", mit_entruempelung: null, kv_version: null, kv_gesendet_am: null, ohne_version: true, kv_dokument_am: "2026-11-02 10:00:00" },
      ],
    });
    const f = await ladeAblaufFakten(WS, DEAL);
    expect(f.kv).toMatchObject({ version: null, betragCent: 120000, gesendetAm: "2026-11-02T10:00:00.000Z" });
    const angebotSql = mocks.execute.mock.calls.map(([q]) => gerendert(q)).find((q) => q.text.includes("FROM quotations q"))!;
    expect(angebotSql.text).toContain("d.document_type = 'quotation'");
    expect(angebotSql.params).toContain(WS);
  });

  it("KV mit Versionsbezug, aber nicht gesendet: kein Rückfall auf das Dokument", async () => {
    dbAntwortet({
      deal: [LEERER_DEAL],
      neben: [LEERE_NEBEN],
      version: [],
      angebot: [
        { festpreis: "1200.00", is_variable: false, gueltig_bis: null, deposit_required_cents: null, service_type: "move", mit_entruempelung: null, kv_version: 1, kv_gesendet_am: null, ohne_version: false, kv_dokument_am: "2026-11-02 10:00:00" },
      ],
    });
    expect((await ladeAblaufFakten(WS, DEAL)).kv?.gesendetAm).toBeNull();
  });

  it("Annahme eines fremden Workspace zählt nicht", async () => {
    dbAntwortet({ deal: [LEERER_DEAL], neben: [LEERE_NEBEN], version: [], angebot: [] });
    mocks.ladeAktiveAnnahme.mockResolvedValue({
      workspaceId: "ws_fremd",
      signedAt: new Date("2026-11-05T08:00:00.000Z"),
      unterschriftAt: null,
      vertragDocumentId: null,
    });
    expect((await ladeAblaufFakten(WS, DEAL)).annahme).toBeNull();
  });
});
