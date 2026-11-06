import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { AblaufFakten } from "@/lib/ablauf";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ladeAblaufGrundlage: vi.fn(),
  dealGespraeche: vi.fn(),
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
vi.mock("@/services/ablauf-fakten", () => ({ ladeAblaufGrundlage: mocks.ladeAblaufGrundlage }));
vi.mock("@/services/gespraech", () => ({ dealGespraeche: mocks.dealGespraeche }));

import { ladeAkte } from "./akte";

const WS = "ws_1";
const DEAL = "deal_1";
/** Do 05.11.2026, 10:00 Berlin. */
const JETZT = new Date("2026-11-05T09:00:00.000Z");

const dialekt = new PgDialect();
const gerendert = (q: unknown) => {
  const r = dialekt.sqlToQuery(q as SQL);
  return { text: r.sql.replace(/\s+/g, " ").trim(), params: r.params };
};

function fakten(): AblaufFakten {
  return {
    erstelltAm: "2026-11-03T08:14:00.000Z",
    quelle: "Kleinanzeigen",
    ersteAntwortAm: null,
    fotos: 14,
    fotoanalyseAm: "2026-11-03T10:00:00.000Z",
    volumenCbm: 38,
    zugang: null,
    halteverbot: null,
    besichtigungAm: null,
    leistung: "move",
    kalkulation: {
      version: 2,
      status: "gesperrt",
      selbstkostenCent: 154000,
      margeProzent: 38,
      geprueftVon: "Dario",
      anpassungen: 0,
      ersteAnpassung: null,
      neuerEntwurf: null,
    },
    kv: {
      version: 2,
      betragCent: 248000,
      istStunden: false,
      gesendetAm: "2026-11-04T09:00:00.000Z",
      gueltigBis: null,
      anzahlungCent: null,
      geoeffnet: 3,
      zuletztGeoeffnet: null,
    },
    unterschriftAktiv: false,
    nachfass: { modus: "entwurf", text: "automatisch, als Entwurf", regeln: [] },
    annahme: null,
    abAm: null,
    team: { personen: 2, namen: ["Max Kottke", "Tim Schulz"] },
    einsatz: { fahrzeug: "Sprinter L", fahrtH: 1.2, arbeitH: 5.5, satzFahrtEur: null, satzArbeitEur: null, fahrzeugEur: null },
    termin: { datum: "2026-11-21", von: null, bis: null },
    durchgefuehrtAm: null,
    rechnung: null,
    rest: { restCent: 248000, quelle: "angebot" },
    letzteZahlungAm: null,
    offeneMeldungen: 0,
    bewertung: { status: null, am: null },
    stageCategory: "quoted",
  };
}

const MELDUNG = { eventId: "evt_1", gemeldetAm: "2026-11-05T08:00:00.000Z", betragCent: 50000, zahlungsart: "paypal" as const, variante: "deposit" as const };

function grundlage(over: { fakten?: Partial<AblaufFakten>; meldungen?: unknown[] } = {}) {
  return {
    fakten: { ...fakten(), ...over.fakten },
    nachfass: { an: true, modus: "entwurf", text: "automatisch, als Entwurf", regeln: [] },
    meldungen: over.meldungen ?? [],
    volumen: { quelle: "inventar", inventarQuellen: ["foto", "chat"] },
  };
}

const KOPF = {
  name: "Familie Weber",
  zimmer: "3",
  von: { line1: "Rotebühlstr. 112", postcode: "70178", city: "Stuttgart-West" },
  nach: "Hauptstr. 1, 73728 Esslingen",
  firma_id: "oc_kottke",
  firma_name: "Kottke",
  stufe_id: "st_angebot",
  stufe_titel: "Angebot",
  waiting_on: "kunde",
  waiting_since: "2026-11-03 09:00:00",
  waiting_reason: "KV 3× geöffnet",
};

const STUFEN = [
  { id: "st_neu", title: "Neue Anfrage", stage_category: "open_new" },
  { id: "st_angebot", title: "Angebot", stage_category: "quoted" },
  { id: "st_verloren", title: "Verloren", stage_category: null },
];
const GRUENDE = [
  { id: "lr_preis", title: "Zu teuer" },
  { id: "lr_sonst", title: "Sonstiges" },
];

/** Entwurf mit Klasse und Deal seines Gesprächs; die Abfrage-Attrappe filtert wie das SQL, das sie bekommt. */
type EntwurfFixture = { id: string; conversation_id: string; message_class: string; gespraech_deal: string | null };
type Antworten = { paket?: boolean; kopf?: unknown[]; stufen?: unknown[]; gruende?: unknown[]; entwurf?: EntwurfFixture[] };

const followup = (id: string, conversation_id: string): EntwurfFixture => ({ id, conversation_id, message_class: "followup", gespraech_deal: DEAL });

/** Nur Zeilen, die die Bedingungen im SQL-Text erfüllen: ohne Filter im SQL kämen sie durch. */
function entwuerfeWieSql(text: string, alle: EntwurfFixture[]) {
  return alle
    .filter((e) => !text.includes("d.message_class = 'followup'") || e.message_class === "followup")
    .filter((e) => !text.includes("c.deal_record_id = $") || e.gespraech_deal === DEAL)
    .map(({ id, conversation_id }) => ({ id, conversation_id }));
}

function dbAntwortet(a: Antworten = {}) {
  mocks.execute.mockImplementation(async (q: unknown) => {
    const { text } = gerendert(q);
    if (text.includes("FROM agent_drafts d")) return entwuerfeWieSql(text, a.entwurf ?? []);
    if (text.includes("FROM statuses s")) return a.stufen ?? STUFEN;
    if (text.includes("FROM select_options so")) return a.gruende ?? GRUENDE;
    if (text.includes("FROM quotation_package_options")) return [{ hat: a.paket ?? false }];
    if (text.includes("FROM records r")) return a.kopf ?? [KOPF];
    throw new Error(`unerwartete Abfrage: ${text}`);
  });
}

function abfrage(teil: string) {
  const call = mocks.execute.mock.calls.find((c) => gerendert(c[0]).text.includes(teil));
  if (!call) throw new Error(`keine Abfrage mit ${teil}`);
  return gerendert(call[0]);
}

const GESPRAECHE = [
  { id: "c_wa", dealRecordId: DEAL, direkt: true, kannSenden: true },
  { id: "c_baileys", dealRecordId: DEAL, direkt: true, kannSenden: false },
  { id: "c_fremd", dealRecordId: "deal_2", direkt: false, kannSenden: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ladeAblaufGrundlage.mockResolvedValue(grundlage());
  mocks.dealGespraeche.mockResolvedValue(GESPRAECHE);
  dbAntwortet();
});

describe("ladeAkte", () => {
  it("setzt Kopf, Kacheln, Ablauf, Nachfass, Dock, Zahlung, Firma und Altlink zusammen", async () => {
    const akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.kopf).toEqual({
      name: "Familie Weber",
      art: "Umzug, 3 Zimmer",
      strecke: "Stuttgart-West nach Esslingen",
      meta: "Über Kleinanzeigen · Kottke · Lead seit Di 03.11.",
      team: [
        { kuerzel: "MK", name: "Max Kottke" },
        { kuerzel: "TS", name: "Tim Schulz" },
      ],
      stufe: { id: "st_angebot", label: "Angebot", kategorie: "quoted", ton: "gold" },
      stufen: [
        { id: "st_neu", label: "Neue Anfrage", kategorie: "open_new" },
        { id: "st_angebot", label: "Angebot", kategorie: "quoted" },
        // Ohne Kategorie entscheidet der Titel, wie in Wartet und Lagekarte.
        { id: "st_verloren", label: "Verloren", kategorie: "lost" },
      ],
      verlustGruende: [
        { id: "lr_preis", label: "Zu teuer" },
        { id: "lr_sonst", label: "Sonstiges" },
      ],
      verlustGrund: null,
    });
    expect(akte.kacheln.map((k) => [k.key, k.wert, k.zeile])).toEqual([
      ["kv", "2.480 €", "v2 · gesendet Mi 04.11."],
      ["marge", "38 %", "Selbstkosten 1.540 €"],
      ["termin", "Sa 21.11.", "in 16 Tagen"],
      ["volumen", "38 m³", "aus 14 Fotos und Chat"],
      ["team", "2 · Sprinter L", "Fahrt 1,2 h · Arbeit 5,5 h"],
      ["wartet", "2 Tage", "KV 3× geöffnet"],
    ]);
    expect(akte.kacheln[5]).toMatchObject({ label: "Wartet auf Kunden", ton: "grau" });
    expect(akte.ablauf.schritte).toHaveLength(11);
    expect(akte.ablauf.position).toBe(4);
    expect(akte.nachfass).toEqual({ an: true, modus: "entwurf", text: "automatisch, als Entwurf" });
    expect(akte.dock).toEqual({
      primaer: { aktion: "nachricht_schreiben", label: "Nachricht schreiben" },
      abErlaubt: false,
      rechnungErlaubt: false,
      bewertungErlaubt: false,
    });
    expect(akte.zahlung).toEqual({ restCent: 248000, meldungen: [] });
    expect(akte.firma).toEqual({ id: "oc_kottke", name: "Kottke" });
    expect(akte.altLink).toBe("/objects/deals/deal_1");
    expect(akte.kalkulationLink).toBe("/app/leads/deal_1/kalkulation");
    expect(akte.kvLink).toBe("/app/leads/deal_1/kalkulation");
  });

  it("Paketoptionen: KV-Link bleibt auf dem alten Angebots-Tab, Kalkulation öffnet die neue Seite", async () => {
    dbAntwortet({ paket: true });
    const akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.kalkulationLink).toBe("/app/leads/deal_1/kalkulation");
    expect(akte.kvLink).toBe("/objects/deals/deal_1?tab=quotation");
    const { text, params } = abfrage("FROM quotation_package_options");
    expect(text).toContain("p.workspace_id = $");
    expect(params).toEqual(expect.arrayContaining([WS, DEAL]));
  });

  it("Stunden-KV: KV-Link bleibt auf dem alten Angebots-Tab", async () => {
    mocks.ladeAblaufGrundlage.mockResolvedValue(grundlage({ fakten: { kv: { ...fakten().kv!, istStunden: true, betragCent: null } } }));
    const akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.kalkulationLink).toBe("/app/leads/deal_1/kalkulation");
    expect(akte.kvLink).toBe("/objects/deals/deal_1?tab=quotation");
  });

  it("jede Abfrage filtert auf Workspace (und Deal, wo es einen gibt); nur lesen; Dienste mit Workspace und Deal", async () => {
    await ladeAkte(WS, DEAL, JETZT);
    expect(mocks.ladeAblaufGrundlage).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.dealGespraeche).toHaveBeenCalledWith(WS, DEAL);
    for (const call of mocks.execute.mock.calls) {
      const { text, params } = gerendert(call[0]);
      expect(text.toLowerCase()).not.toMatch(/\b(update|insert|delete)\b/);
      expect(params).toContain(WS);
    }
    const kopf = abfrage("FROM records r");
    expect(kopf.text).toContain("o.workspace_id = $");
    expect(kopf.text).toContain("o.slug = 'deals'");
    expect(kopf.text).toContain("r.deleted_at IS NULL");
    expect(kopf.text).toContain("LEFT JOIN deal_workflow_state w ON w.record_id = r.id");
    expect(kopf.params).toContain(DEAL);
    const stufen = abfrage("FROM statuses s");
    expect(stufen.text).toContain("a.slug = 'stage'");
    expect(stufen.text).toContain("s.is_active");
    expect(stufen.text).toContain("ORDER BY s.sort_order");
    const gruende = abfrage("FROM select_options so");
    expect(gruende.text).toContain("a.slug = 'loss_reason'");
    expect(gruende.text).toContain("ORDER BY so.sort_order");
  });

  it("Nachfass-Entwurf: neuester offener, nicht abgelaufener am direkt verknüpften Gespräch", async () => {
    dbAntwortet({ entwurf: [followup("draft_1", "c_wa")] });
    const akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.dock.primaer).toEqual({ aktion: "nachfass_senden", label: "Nachfass senden", ziel: "draft_1" });
    const { text, params } = abfrage("FROM agent_drafts d");
    expect(text).toContain("d.workspace_id = $");
    expect(text).toContain("d.deal_record_id = $");
    expect(text).toContain("d.sequence_id = 'nachfass'");
    expect(text).toContain("d.message_class = 'followup'");
    expect(text).toContain("d.status = 'pending'");
    expect(text).toContain("(d.expires_at IS NULL OR d.expires_at > $");
    // Direkt verknüpft: Gespräch im Workspace mit deal_record_id = deal (schließt Gespräche anderer oder keiner Deals aus).
    expect(text).toContain("INNER JOIN inbox_conversations c ON c.id = d.conversation_id AND c.workspace_id = $");
    expect(text).toContain("c.deal_record_id = $");
    expect(text).toContain("ORDER BY d.created_at DESC");
    expect(text).toContain("LIMIT 1");
    expect(params).toContain(JETZT.toISOString());
    expect(params.filter((p) => p === DEAL).length).toBeGreaterThanOrEqual(2);
  });

  it("Team-Entwurf (ack am Nuri-Gespräch, nicht am Deal) und Entwurf an fremdem Gespräch: kein Nachfass senden", async () => {
    dbAntwortet({
      entwurf: [
        { id: "draft_team", conversation_id: "c_nuri", message_class: "ack", gespraech_deal: null },
        { id: "draft_fremd", conversation_id: "c_fremd", message_class: "followup", gespraech_deal: "deal_2" },
      ],
    });
    // Selbst wenn das Nuri-Gespräch senden könnte.
    mocks.dealGespraeche.mockResolvedValue([...GESPRAECHE, { id: "c_nuri", dealRecordId: null, direkt: false, kannSenden: true }]);
    expect((await ladeAkte(WS, DEAL, JETZT)).dock.primaer.aktion).toBe("nachricht_schreiben");
  });

  it("Entwurf an einem Gespräch, das nicht senden kann: kein Nachfass senden", async () => {
    dbAntwortet({ entwurf: [followup("draft_1", "c_baileys")] });
    const akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.dock.primaer.aktion).toBe("nachricht_schreiben");
  });

  it("Entwurf an einem Gespräch, das dealGespraeche nicht kennt: kein Nachfass senden", async () => {
    dbAntwortet({ entwurf: [followup("draft_1", "c_unbekannt")] });
    expect((await ladeAkte(WS, DEAL, JETZT)).dock.primaer.aktion).toBe("nachricht_schreiben");
  });

  it("eine offene Meldung: Zahlung bestätigen mit eventId; zwei: Zahlung erfassen; Meldungen in zahlung", async () => {
    mocks.ladeAblaufGrundlage.mockResolvedValue(grundlage({ fakten: { offeneMeldungen: 1 }, meldungen: [MELDUNG] }));
    let akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.dock.primaer).toEqual({ aktion: "zahlung_bestaetigen", label: "Zahlung bestätigen", ziel: "evt_1" });
    expect(akte.zahlung).toEqual({ restCent: 248000, meldungen: [MELDUNG] });

    const zweite = { ...MELDUNG, eventId: "evt_2", variante: "final" as const };
    mocks.ladeAblaufGrundlage.mockResolvedValue(grundlage({ fakten: { offeneMeldungen: 2 }, meldungen: [MELDUNG, zweite] }));
    akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.dock.primaer).toEqual({ aktion: "zahlung_erfassen", label: "Zahlung erfassen" });
  });

  it("eine Stufenkategorie: Kopf, Dock und Ablauf nehmen die Kategorie der Grundlage", async () => {
    // ladeAblaufGrundlage leitet „Verloren“ ohne stage_category schon aus dem Titel ab.
    mocks.ladeAblaufGrundlage.mockResolvedValue(grundlage({ fakten: { stageCategory: "lost", offeneMeldungen: 1 }, meldungen: [MELDUNG] }));
    dbAntwortet({ kopf: [{ ...KOPF, stufe_id: "st_verloren", stufe_titel: "Verloren" }] });
    const akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.kopf.stufe).toEqual({ id: "st_verloren", label: "Verloren", kategorie: "lost", ton: "grau" });
    expect(akte.dock.primaer.aktion).toBe("nachricht_schreiben");
    expect(akte.ablauf.schritte.some((s) => s.zustand === "jetzt")).toBe(false);
    // Der Kopf leitet nicht selbst ab.
    expect(abfrage("FROM records r").text).not.toContain("stage_category");
  });

  it("leerer Deal: Rückfälle im Kopf, ohne Wartet-Zeile, ohne Firma", async () => {
    dbAntwortet({
      kopf: [
        {
          name: null,
          zimmer: null,
          von: null,
          nach: null,
          firma_id: null,
          firma_name: null,
          stufe_id: null,
          stufe_titel: null,
          waiting_on: null,
          waiting_since: null,
          waiting_reason: null,
        },
      ],
      stufen: [],
      gruende: [],
    });
    mocks.ladeAblaufGrundlage.mockResolvedValue(
      grundlage({ fakten: { quelle: null, team: { personen: 0, namen: [] }, stageCategory: null } })
    );
    mocks.dealGespraeche.mockResolvedValue([]);
    const akte = await ladeAkte(WS, DEAL, JETZT);
    expect(akte.kopf).toEqual({
      name: "Ohne Namen",
      art: "Umzug",
      strecke: "",
      meta: "Lead seit Di 03.11.",
      team: [],
      stufe: { id: null, label: "Ohne Stufe", kategorie: null, ton: "grau" },
      stufen: [],
      verlustGruende: [],
      verlustGrund: null,
    });
    expect(akte.kacheln[5]).toEqual({ key: "wartet", label: "Läuft", wert: "–", zeile: "", ton: "jade" });
    expect(akte.firma).toEqual({ id: null, name: null });
  });

  it("gespeicherter Verlustgrund steht im Kopf, leer wird null", async () => {
    dbAntwortet({ kopf: [{ ...KOPF, verlust_grund: "lr_preis" }] });
    expect((await ladeAkte(WS, DEAL, JETZT)).kopf.verlustGrund).toBe("lr_preis");
    dbAntwortet({ kopf: [{ ...KOPF, verlust_grund: " " }] });
    expect((await ladeAkte(WS, DEAL, JETZT)).kopf.verlustGrund).toBeNull();
    const kopf = abfrage("FROM records r");
    expect(kopf.text).toContain("AS verlust_grund");
    expect(kopf.params).toContain("loss_reason");
  });

  it("Adresse als JSON-Text aus der Datenbank wird gelesen", async () => {
    dbAntwortet({ kopf: [{ ...KOPF, von: JSON.stringify({ line1: "A", city: "Calw" }), nach: JSON.stringify("Hauptstr. 1, 75365 Calw") }] });
    expect((await ladeAkte(WS, DEAL, JETZT)).kopf.strecke).toBe("Calw nach Calw");
  });

  it("fremder oder fehlender Deal: Fehler", async () => {
    dbAntwortet({ kopf: [] });
    await expect(ladeAkte(WS, DEAL, JETZT)).rejects.toThrow("Deal nicht gefunden");
  });
});
