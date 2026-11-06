import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ladeFirmen: vi.fn(),
}));

vi.mock("@/db", () => ({ db: { execute: mocks.execute } }));
vi.mock("@/services/lagekarte/laden", () => ({ ladeFirmen: mocks.ladeFirmen }));

import { LEERER_FILTER } from "@/lib/leads-board";
import { ladeLeadsBoard, ladeLeadsListe, ladeLeadsSpalte, rohAus, SPALTE_LIMIT_MAX, type DbZeile } from "./leads-board";

const JETZT = new Date("2026-11-06T11:00:00.000Z");
const dialect = new PgDialect();
const abfrage = (i: number) => dialect.sqlToQuery(mocks.execute.mock.calls[i][0] as SQL);

function dbZeile(teil: Partial<DbZeile>): DbZeile {
  return {
    id: "d1",
    erstellt_am: "2026-10-27 11:00:00",
    nummer: null,
    name: "Familie Weber",
    stufe_id: "s_neu",
    umzug_am: null,
    von: null,
    nach: null,
    firma_id: null,
    quelle_id: null,
    wert: null,
    besichtigung_am: null,
    verlust_grund: null,
    waiting_on: null,
    waiting_since: null,
    waiting_reason: null,
    hat_angebot: false,
    festpreis: null,
    ist_stunden: null,
    service_type: null,
    mit_entruempelung: null,
    gueltig_bis: null,
    paket_option_id: null,
    ohne_version: null,
    angebot_version_gesendet_am: null,
    positionen: null,
    optionen: null,
    hat_annahme: false,
    annahme_cent: null,
    angenommen_am: null,
    zuletzt_geoeffnet: null,
    termin_auswahl: null,
    gesperrt_version: null,
    gesperrt_cent: null,
    gesperrt_gesendet_am: null,
    gesperrt_team_soll: null,
    entwurf_version: null,
    entwurf_cent: null,
    entwurf_team_soll: null,
    hat_rechner: false,
    rechner_festpreis: null,
    rechner_team_soll: null,
    kv_erstes_am: null,
    rechnung_am: null,
    zahlungen: null,
    team_namen: null,
    fotos: "0",
    letzte_nachricht_am: null,
    telefone: null,
    meldungen: null,
    ...teil,
  };
}

const STUFEN = [
  { id: "s_neu", title: "Neue Anfrage", stage_category: "open_new", sort_order: 0, is_active: true },
  { id: "s_angebot", title: "Angebot", stage_category: "quoted", sort_order: 2, is_active: true },
  { id: "s_alt", title: "Quoted", stage_category: null, sort_order: 2, is_active: false },
  { id: "s_geplant", title: "Geplant", stage_category: "booked", sort_order: 3, is_active: true },
  { id: "s_durch", title: "Durchgeführt", stage_category: "done_unpaid", sort_order: 4, is_active: true },
  { id: "s_verloren", title: "Verloren", stage_category: "lost", sort_order: 6, is_active: true },
  { id: "s_kein", title: "Kein Lead", stage_category: "kein_lead", sort_order: 7, is_active: true },
];

function antworten(deals: DbZeile[]) {
  mocks.execute
    .mockResolvedValueOnce(deals)
    .mockResolvedValueOnce(STUFEN)
    .mockResolvedValueOnce([
      { id: "q_ka", title: "Kleinanzeigen" },
      { id: "q_wa", title: "WhatsApp" },
    ])
    .mockResolvedValueOnce({ rows: [{ id: "g_preis", title: "Zu teuer" }] });
}

const DEALS: DbZeile[] = [
  dbZeile({
    id: "d_neu",
    nummer: "2026-042",
    von: { city: "Stuttgart" },
    nach: JSON.stringify("Bahnhofstr. 2, 70734 Fellbach"),
    firma_id: "f_kottke",
    quelle_id: "q_wa",
    wert: JSON.stringify({ amount: 1900, currencyCode: "EUR" }),
    waiting_on: "uns",
    waiting_since: "2026-11-06 10:25:00",
    waiting_reason: "Kunde wartet auf Antwort",
    letzte_nachricht_am: "2026-11-06 10:00:00",
    telefone: ["+49 170 1234567"],
  }),
  dbZeile({
    id: "d_angebot",
    stufe_id: "s_alt",
    hat_angebot: true,
    festpreis: "2480.00",
    ist_stunden: false,
    service_type: "move",
    mit_entruempelung: "true",
    gueltig_bis: "2026-11-12",
    ohne_version: true,
    kv_erstes_am: "2026-11-01 09:00:00",
    waiting_on: "uns",
    waiting_since: "2026-11-01 09:00:00",
    waiting_reason: "KV seit 5 Tagen ungesehen",
  }),
  dbZeile({
    id: "d_geplant",
    stufe_id: "s_geplant",
    umzug_am: "2026-11-07",
    hat_annahme: true,
    annahme_cent: 190000,
    angenommen_am: "2026-11-03 12:00:00",
    gesperrt_version: 1,
    gesperrt_cent: 180000,
    gesperrt_team_soll: "3",
    entwurf_version: 2,
    entwurf_cent: 175000,
    entwurf_team_soll: "2",
    team_namen: ["Max Kottke"],
  }),
  dbZeile({
    id: "d_durch",
    stufe_id: "s_durch",
    hat_angebot: true,
    festpreis: "1600.00",
    ist_stunden: false,
    service_type: "move",
    ohne_version: true,
    rechnung_am: "2026-11-04 10:00:00",
    zahlungen: [
      { amount: "500.00", taxTreatment: "betriebseinnahme", date: "2026-11-05" },
      { amount: "300.00", taxTreatment: "nicht_steuerbar", date: "2026-11-05" },
    ],
    meldungen: [
      {
        id: "ev1",
        eventType: "customer.marked_paid",
        payload: { amountCents: 50000, variant: "final" },
        createdAt: "2026-11-06T09:00:00.123456",
      },
    ],
  }),
  dbZeile({ id: "d_ohne", stufe_id: null, name: null, entwurf_version: 1, entwurf_cent: 99000 }),
  dbZeile({ id: "d_lost", stufe_id: "s_verloren", verlust_grund: "g_preis", waiting_on: "uns", waiting_since: "2026-11-05 10:00:00" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ladeFirmen.mockResolvedValue([
    { id: "f_kottke", name: "Kottke Umzüge", primaryColor: "#ff6600" },
    { id: "f_ceylan", name: null, primaryColor: null },
    { id: "f_ceylan", name: "Ceylan", primaryColor: null },
  ]);
});

describe("ladeLeadsBoard", () => {
  it("baut Spalten, Chips und Stammdaten aus vier Abfragen plus Firmen", async () => {
    antworten(DEALS);
    const board = await ladeLeadsBoard("ws_1", { ...LEERER_FILTER }, JETZT);

    expect(mocks.execute).toHaveBeenCalledTimes(4);
    expect(mocks.ladeFirmen).toHaveBeenCalledWith("ws_1");
    expect(board.stand).toBe(JETZT.toISOString());
    expect(board.firmen).toEqual([
      { id: "f_ceylan", name: "Ceylan", farbe: "#c9361a" },
      { id: "f_kottke", name: "Kottke Umzüge", farbe: "#222224" },
    ]);
    expect(board.quellen).toEqual([
      { id: "q_ka", label: "Kleinanzeigen" },
      { id: "q_wa", label: "WhatsApp" },
    ]);
    expect(board.verlustGruende).toEqual([{ id: "g_preis", label: "Zu teuer" }]);
    expect(board.stufen.map((s) => s.id)).toEqual(["s_neu", "s_angebot", "s_geplant", "s_durch", "s_verloren", "s_kein"]);
    expect(board.chips).toEqual({ warten: 2, kv_ungesehen: 1, ohne_team: 1, rechnung_offen: 1, diese_woche: 1 });

    expect(board.spalten.map((s) => [s.stufeId, s.anzahl, s.eingeklappt, s.karten.map((k) => k.id)])).toEqual([
      ["_ohne", 1, false, ["d_ohne"]],
      ["s_neu", 1, false, ["d_neu"]],
      ["s_angebot", 1, false, ["d_angebot"]],
      ["s_geplant", 1, false, ["d_geplant"]],
      ["s_durch", 1, false, ["d_durch"]],
      ["s_verloren", 1, true, []],
      ["s_kein", 0, true, []],
    ]);

    const karte = (id: string) => board.spalten.flatMap((s) => s.karten).find((k) => k.id === id)!;
    expect(karte("d_neu")).toMatchObject({
      nummer: "2026-042",
      name: "Familie Weber",
      betragText: "~1.900 €",
      was: "Umzug · Stuttgart → Fellbach",
      wartet: { auf: "uns", text: "Wartet auf uns · 35 Min", ton: "gold" },
      quelle: { id: "q_wa", label: "WhatsApp" },
      firma: { id: "f_kottke", name: "Kottke Umzüge", farbe: "#222224" },
      aktivitaet: "2026-11-06T10:00:00.000Z",
      aktivitaetText: "vor 1 Std",
    });
    expect(karte("d_angebot")).toMatchObject({
      stufe: { id: "s_alt", label: "Quoted", kategorie: "quoted" },
      spalteId: "s_angebot",
      art: "Entrümpelung und Umzug",
      betragText: "2.480 €",
      kontext: "gültig bis 12.11.",
      wartet: { text: "KV ungesehen · 5 Tage" },
      fakten: { kvVorhanden: true },
    });
    expect(karte("d_geplant")).toMatchObject({
      betrag: { cent: 190000, art: "fest" },
      was: "Umzug · Sa 07.11.",
      wartet: { text: "läuft · Termin Sa 07.11.", ton: "jade" },
      team: [{ kuerzel: "MK", name: "Max Kottke" }],
      teamFehlt: true,
      fakten: { annahmeAm: "2026-11-03T12:00:00.000Z" },
    });
    expect(karte("d_durch")).toMatchObject({
      kontext: "Rest 1.100 €",
      zahlungGemeldet: "Kunde meldet bezahlt · 500 €",
      wartet: { text: "läuft" },
    });
    expect(karte("d_ohne")).toMatchObject({ name: "Ohne Namen", betragText: "~990 €", stufe: { id: null, label: "Ohne Stufe" } });

    const angebot = board.spalten.find((s) => s.stufeId === "s_angebot")!;
    expect(angebot).toMatchObject({ summeCent: 248000, summeGeschaetzt: false, satz: "KV raus, wartet auf Annahme", ton: "blau_tief" });
  });

  it("Filter laufen auf den Spalten, Chips zählen ungefiltert; alle=1 klappt Verloren auf", async () => {
    antworten(DEALS);
    const nurNeu = await ladeLeadsBoard("ws_1", { ...LEERER_FILTER, suche: "fellbach" }, JETZT);
    expect(nurNeu.spalten.map((s) => [s.stufeId, s.anzahl])).toEqual([
      ["s_neu", 1],
      ["s_angebot", 0],
      ["s_geplant", 0],
      ["s_durch", 0],
      ["s_verloren", 0],
      ["s_kein", 0],
    ]);
    expect(nurNeu.chips.warten).toBe(2);

    antworten(DEALS);
    const alle = await ladeLeadsBoard("ws_1", { ...LEERER_FILTER, endstufen: true }, JETZT);
    expect(alle.spalten.find((s) => s.stufeId === "s_verloren")).toMatchObject({ eingeklappt: false, anzahl: 1 });
    expect(alle.spalten.find((s) => s.stufeId === "s_verloren")?.karten[0]).toMatchObject({
      id: "d_lost",
      wartet: { text: null },
      fakten: { verlustGrund: "g_preis" },
    });
  });

  it("Abfrage: jede Tabelle mit workspace_id ist auf den Workspace begrenzt, die übrigen nur über den Deal-Scope", async () => {
    antworten([]);
    await ladeLeadsBoard("ws_1", { ...LEERER_FILTER }, JETZT);
    const haupt = abfrage(0);

    // Alias je Tabelle aus FROM/JOIN, dann `alias.workspace_id = $n` mit Parameter ws_1.
    const mitWorkspace = [
      "objects",
      "deal_numbers",
      "deal_calculation_versions",
      "kva_confirmations",
      "customer_date_selections",
      "quotation_package_options",
      "customer_status_links",
      "deal_calculations",
      "deal_documents",
      "payments",
      "employees",
      "agent_events",
      "inbox_conversations",
      "inbox_contacts",
      "activity_events",
    ];
    for (const tabelle of mitWorkspace) {
      const aliase = [...haupt.sql.matchAll(new RegExp(`(?:FROM|JOIN)\\s+${tabelle}\\s+(\\w+)`, "g"))].map((m) => m[1]);
      expect(aliase.length, tabelle).toBeGreaterThan(0);
      for (const alias of aliase) {
        const treffer = [...haupt.sql.matchAll(new RegExp(`\\b${alias}\\.workspace_id = \\$(\\d+)`, "g"))];
        expect(treffer.length, `${tabelle} ${alias}`).toBeGreaterThan(0);
        for (const t of treffer) expect(haupt.params[Number(t[1]) - 1], `${tabelle} ${alias}`).toBe("ws_1");
      }
    }
    // Keine Workspace-Spalte: nur über die Deals des Workspace-Objekts.
    expect(haupt.sql).toMatch(/r\.object_id IN \(SELECT obj\.id FROM obj\) AND r\.deleted_at IS NULL/);
    expect(haupt.sql).toMatch(/a\.object_id IN \(SELECT obj\.id FROM obj\)/);
    expect(haupt.sql).toMatch(/INNER JOIN d ON d\.id = rv\.record_id/);
    expect(haupt.sql).toMatch(/LEFT JOIN deal_workflow_state w ON w\.record_id = d\.id/);
    expect(haupt.sql).toMatch(/LEFT JOIN quotations q ON q\.deal_record_id = d\.id/);
    expect(haupt.sql).toMatch(/WHERE li\.quotation_id = q\.id/);
    expect(haupt.sql).toMatch(/WHERE de\.deal_record_id = d\.id/);
    expect(haupt.sql).toMatch(/FROM d\s+LEFT JOIN v/);
    expect(new Set(haupt.params)).toEqual(
      new Set([
        "ws_1",
        "name",
        "stage",
        "move_date",
        "move_from_address",
        "move_to_address",
        "operating_company",
        "source_channel",
        "value",
        "besichtigung_am",
        "loss_reason",
        "customer.marked_paid",
        "payment.meldung_bestaetigt",
        "payment.meldung_verworfen",
      ]),
    );

    // Stufen, Quellen, Verlustgründe nur vom Deals-Objekt dieses Workspace.
    for (const i of [1, 2, 3]) {
      const q = abfrage(i);
      const m = /INNER JOIN objects o ON o\.id = a\.object_id AND o\.workspace_id = \$(\d+) AND o\.slug = 'deals'/.exec(q.sql);
      expect(m, q.sql).not.toBeNull();
      expect(q.params[Number(m![1]) - 1]).toBe("ws_1");
    }
    expect(abfrage(1).sql).toMatch(/a\.slug = 'stage'/);
    expect(abfrage(2).params).toEqual(["source_channel", "ws_1"]);
    expect(abfrage(3).params).toEqual(["loss_reason", "ws_1"]);
  });

  it("Abfrage: nie file_content, nie ganzes rechner_result oder result", async () => {
    antworten([]);
    await ladeLeadsBoard("ws_1", { ...LEERER_FILTER }, JETZT);
    const { sql } = abfrage(0);
    expect(sql).not.toMatch(/file_content/);
    expect(sql).toMatch(/rechner_result -> 'team' ->> 'groesse'/);
    expect(sql).not.toMatch(/rechner_result(?!\s*->)/);
    expect(sql).not.toMatch(/\bc\.result(?!\s*->)/);
    expect(sql).not.toMatch(/\bSELECT \*|\.\*/);
  });
});

describe("ladeLeadsSpalte", () => {
  it("nächste Seite einer Spalte mit Anzahl über die ganze Spalte; limit gekappt", async () => {
    const viele = Array.from({ length: 45 }, (_, i) =>
      dbZeile({ id: `d${String(i).padStart(2, "0")}`, stufe_id: "s_angebot", letzte_nachricht_am: `2026-11-0${(i % 5) + 1} 10:00:00` }),
    );
    antworten(viele);
    const s = await ladeLeadsSpalte("ws_1", { ...LEERER_FILTER }, "s_angebot", 40, undefined, JETZT);
    expect(s).toMatchObject({ stufeId: "s_angebot", anzahl: 45, weiter: null });
    expect(s.karten).toHaveLength(5);

    antworten(viele);
    const neu = await ladeLeadsSpalte("ws_1", { ...LEERER_FILTER }, "s_angebot", 0, 10_000, JETZT);
    expect(neu.karten).toHaveLength(45);
    expect(SPALTE_LIMIT_MAX).toBe(400);

    antworten(viele);
    const unbekannt = await ladeLeadsSpalte("ws_1", { ...LEERER_FILTER }, "s_weg", 0, 40, JETZT);
    expect(unbekannt).toEqual({ stufeId: "s_weg", karten: [], weiter: null, anzahl: 0 });
  });

  it("Verloren lässt sich auch ohne alle=1 nachladen", async () => {
    antworten(DEALS);
    const s = await ladeLeadsSpalte("ws_1", { ...LEERER_FILTER }, "s_verloren", 0, 40, JETZT);
    expect(s.karten.map((k) => k.id)).toEqual(["d_lost"]);
  });
});

describe("ladeLeadsListe", () => {
  it("Zeilen sortiert und geschnitten, gesamt über alle Seiten, Verloren nur mit alle=1", async () => {
    antworten(DEALS);
    const liste = await ladeLeadsListe("ws_1", { ...LEERER_FILTER }, { schluessel: "betrag", richtung: "ab" }, 0, JETZT);
    expect(liste.zeilen.map((z) => [z.id, z.betragText])).toEqual([
      ["d_angebot", "2.480 €"],
      ["d_neu", "~1.900 €"],
      ["d_geplant", "1.900 €"],
      ["d_durch", "1.600 €"],
      ["d_ohne", "~990 €"],
    ]);
    expect(liste).toMatchObject({ gesamt: 5, weiter: null, stand: JETZT.toISOString() });
    expect(liste.chips.warten).toBe(2);
    expect(liste.verlustGruende).toHaveLength(1);

    antworten(DEALS);
    const alle = await ladeLeadsListe("ws_1", { ...LEERER_FILTER, endstufen: true }, { schluessel: "betrag", richtung: "ab" }, 0, JETZT);
    expect(alle.gesamt).toBe(6);

    antworten(DEALS);
    const seite2 = await ladeLeadsListe("ws_1", { ...LEERER_FILTER }, { schluessel: "wartezeit", richtung: "ab" }, 4, JETZT);
    expect(seite2).toMatchObject({ gesamt: 5, weiter: null });
    expect(seite2.zeilen).toHaveLength(1);
  });

  it("50 Zeilen je Seite", async () => {
    antworten(Array.from({ length: 51 }, (_, i) => dbZeile({ id: `d${String(i).padStart(2, "0")}` })));
    const liste = await ladeLeadsListe("ws_1", { ...LEERER_FILTER }, { schluessel: "wartezeit", richtung: "ab" }, 0, JETZT);
    expect(liste.zeilen).toHaveLength(50);
    expect(liste).toMatchObject({ gesamt: 51, weiter: 50 });
  });
});

describe("rohAus", () => {
  it("liest Treiberformen: JSON-Text, Wahrheitswerte als Text, Zeiten ohne Zone als UTC, ungültige Teile fallen weg", () => {
    const r = rohAus(
      dbZeile({
        hat_angebot: "t",
        ist_stunden: "t",
        positionen: JSON.stringify([{ quantity: 3, unitRateEuro: "45.50" }]),
        optionen: JSON.stringify([{ id: "o1", priceCents: 1000, isRecommended: true, sortOrder: 0 }, { priceCents: 5 }]),
        team_namen: JSON.stringify(["Max Kottke", ""]),
        meldungen: JSON.stringify([{ id: "e1", eventType: "customer.marked_paid", payload: {}, createdAt: "2026-11-06T09:00:00" }, { id: 5 }]),
        besichtigung_am: "2026-11-07 15:00:00",
        hat_rechner: true,
        rechner_festpreis: "1234",
        rechner_team_soll: "0",
      }),
    );
    expect(r.angebot).toMatchObject({ istStunden: true, positionen: [{ quantity: 3, unitRateEuro: "45.50" }] });
    expect(r.optionen).toEqual([{ id: "o1", priceCents: 1000, isRecommended: true, sortOrder: 0 }]);
    expect(r.team).toEqual(["Max Kottke"]);
    expect(r.meldungsEreignisse).toEqual([{ id: "e1", eventType: "customer.marked_paid", payload: {}, createdAt: "2026-11-06T09:00:00.000Z" }]);
    expect(r.besichtigungAm).toBe("2026-11-07T15:00:00.000Z");
    expect(r.rechner).toEqual({ festpreis: "1234", teamSoll: null });
    expect(r.wartet).toBeNull();
    expect(rohAus(dbZeile({ besichtigung_am: "2026-11-07" })).besichtigungAm).toBe("2026-11-07");
    expect(rohAus(dbZeile({ waiting_on: "jemand" })).wartet).toBeNull();
  });
});
