import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { berechneAblauf, type AblaufFakten } from "@/lib/ablauf";
import { zahlenreiheAus, type AkteDaten } from "@/lib/akte";
import { KEIN_LEAD_STAGE_CATEGORY } from "@/lib/kontaktart";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  ladeAkteMitFakten: vi.fn(),
  gespraeche: vi.fn(),
  anrufe: vi.fn(),
  getAttachmentsForDeal: vi.fn(),
}));

// Nur `db.execute` ist erlaubt; jeder andere Zugriff (update, insert, …) lässt den Test scheitern.
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
vi.mock("@/services/akte", () => ({ ladeAkteMitFakten: mocks.ladeAkteMitFakten }));
vi.mock("@/services/gespraech", () => ({ dbGespraechSpeicher: { gespraeche: mocks.gespraeche, anrufe: mocks.anrufe } }));
vi.mock("@/services/inbox", () => ({ getAttachmentsForDeal: mocks.getAttachmentsForDeal }));

import { ladeKurzfassung } from "./kurzfassung";

const WS = "ws_1";
const DEAL = "deal_1";
/** Do 05.11.2026, 10:00 Berlin. */
const JETZT = new Date("2026-11-05T09:00:00.000Z");

/** Anonyme Weiterleitungsadresse von Kleinanzeigen (keine echte E-Mail des Kunden). */
const RELAY = `abc-${"0123456789abcdef".repeat(3)}-ek-ek@mail.kleinanzeigen.de`;

const dialekt = new PgDialect();
const gerendert = (q: unknown) => {
  const r = dialekt.sqlToQuery(q as SQL);
  return { text: r.sql.replace(/\s+/g, " ").trim(), params: r.params };
};

function fakten(over: Partial<AblaufFakten> = {}): AblaufFakten {
  return {
    erstelltAm: "2026-11-03T08:14:00.000Z",
    quelle: "Kleinanzeigen",
    ersteAntwortAm: null,
    fotos: 3,
    fotoanalyseAm: null,
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
      geoeffnet: 0,
      zuletztGeoeffnet: null,
    },
    unterschriftAktiv: false,
    nachfass: { modus: "aus", text: "aus", regeln: [] },
    annahme: null,
    abAm: null,
    team: { personen: 0, namen: [] },
    einsatz: null,
    termin: { datum: "2026-11-21", von: null, bis: null },
    durchgefuehrtAm: null,
    rechnung: null,
    rest: { restCent: null, quelle: "" },
    letzteZahlungAm: null,
    offeneMeldungen: 0,
    bewertung: { status: null, am: null },
    stageCategory: "quoted",
    ...over,
  };
}

function akteAus(f: AblaufFakten): AkteDaten {
  return {
    kopf: {
      name: "Familie Weber",
      art: "Umzug",
      strecke: "",
      meta: "",
      team: [],
      stufe: { id: "st_angebot", label: "Angebot", kategorie: f.stageCategory, ton: "gold" },
      stufen: [
        { id: "st_angebot", label: "Angebot", kategorie: "quoted" },
        { id: "st_kein", label: "Kein Lead", kategorie: KEIN_LEAD_STAGE_CATEGORY },
      ],
      verlustGruende: [],
      verlustGrund: null,
    },
    kacheln: zahlenreiheAus(f, { waitingOn: "uns", waitingSince: "2026-11-05T08:25:00.000Z", waitingReason: null }, null, JETZT),
    ablauf: berechneAblauf(f, JETZT),
    nachfass: { an: false, modus: "aus", text: "aus" },
    dock: { primaer: { aktion: "nachricht_schreiben", label: "Nachricht schreiben" }, abErlaubt: false, rechnungErlaubt: false, bewertungErlaubt: false },
    zahlung: { restCent: null, meldungen: [] },
    firma: { id: "oc_1", name: "Kottke" },
    altLink: `/objects/deals/${DEAL}`,
    kalkulationLink: `/app/leads/${DEAL}/kalkulation`,
    kvLink: `/app/leads/${DEAL}/kalkulation`,
  };
}

type Antworten = { kunde?: unknown[]; dokumente?: unknown[] };

function dbAntwortet(a: Antworten) {
  mocks.execute.mockImplementation(async (q: SQL) => {
    const { text } = gerendert(q);
    if (text.includes("FROM deal_documents d")) return a.dokumente ?? [];
    if (text.includes("FROM records r")) return a.kunde ?? [];
    throw new Error(`unerwartete Abfrage: ${text.slice(0, 80)}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  const f = fakten();
  mocks.ladeAkteMitFakten.mockResolvedValue({ akte: akteAus(f), fakten: f });
  mocks.gespraeche.mockResolvedValue([{ id: "c_wa", kanal: "whatsapp" }, { id: "c_mail", kanal: "email" }]);
  mocks.anrufe.mockResolvedValue([{ id: "call1" }, { id: "call2" }]);
  mocks.getAttachmentsForDeal.mockResolvedValue([
    { id: "a1", mimeType: "image/jpeg" },
    { id: "a2", mimeType: "IMAGE/PNG" },
    { id: "a3", mimeType: "application/pdf" },
  ]);
  dbAntwortet({
    kunde: [
      {
        von: JSON.stringify({ line1: "Rotebühlstr. 112", postcode: "70178", city: "Stuttgart" }),
        nach: { line1: "Am Markt 1", postcode: "73728", city: "Esslingen" },
        person_telefon: "+49 171 2345678",
        person_emails: JSON.stringify([RELAY, "weber@example.de"]),
        kontakt_telefon: "+49 999",
        kontakt_emails: ["kontakt@example.de"],
      },
    ],
    dokumente: [
      { typ: "quotation", version: 1 },
      { typ: "quotation", version: "2" },
      { typ: "order_confirmation", version: null },
    ],
  });
});

describe("ladeKurzfassung", () => {
  it("setzt Akte, Kunde, Kanäle, Fotos und Dokumente zusammen", async () => {
    const out = await ladeKurzfassung(WS, DEAL, JETZT);
    expect(mocks.ladeAkteMitFakten).toHaveBeenCalledWith(WS, DEAL, JETZT);
    expect(mocks.gespraeche).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.anrufe).toHaveBeenCalledWith(WS, DEAL);
    expect(mocks.getAttachmentsForDeal).toHaveBeenCalledWith(DEAL, WS);

    expect(out.dealId).toBe(DEAL);
    expect(out.name).toBe("Familie Weber");
    expect(out.zeilen[0]).toEqual({ label: "Kostenvoranschlag", wert: "2.480 € · v2", ton: null });
    expect(out.zeilen[1]).toEqual({ label: "Umzugsdatum", wert: "Sa 21.11.", ton: null });
    expect(out.zeilen[4]).toEqual({ label: "Wartet", wert: "auf uns · 35 Min", ton: "gold" });
    expect(out.naechsterSchritt).toEqual({ titel: "Annahme", zusatz: "im Status-Link" });
    expect(out.kunde).toEqual({
      telefon: "+49 171 2345678",
      // Relay-Adresse von Kleinanzeigen übersprungen.
      email: "weber@example.de",
      von: "Rotebühlstr. 112, 70178 Stuttgart",
      nach: "Am Markt 1, 73728 Esslingen",
      quelle: "Kleinanzeigen",
      firma: "Kottke",
    });
    expect(out.gespraech).toEqual({ kanaele: "WhatsApp, E-Mail, 2 Anrufe", fotos: 2, dokumente: "KV v1, v2 · AB" });
    expect(out.keinLeadStufeId).toBe("st_kein");
    expect(out.kategorie).toBe("quoted");
    expect(out.akteLink).toBe(`/app/leads/${DEAL}`);
  });

  it("ohne Person: Telefon und E-Mail vom Kontakt des direkten Gesprächs; Freitext-Adresse bleibt", async () => {
    dbAntwortet({
      kunde: [
        {
          von: "Hauptstr. 5, 70173 Stuttgart",
          nach: null,
          person_telefon: null,
          person_emails: [],
          kontakt_telefon: "+4915100000001",
          kontakt_emails: JSON.stringify([RELAY, "kontakt@example.de"]),
        },
      ],
    });
    const out = await ladeKurzfassung(WS, DEAL, JETZT);
    expect(out.kunde).toMatchObject({ telefon: "+4915100000001", email: "kontakt@example.de", von: "Hauptstr. 5, 70173 Stuttgart", nach: null });
    expect(out.gespraech.dokumente).toBe("–");
  });

  it("keine Zeile: alles null, nichts bricht", async () => {
    dbAntwortet({ kunde: [] });
    const out = await ladeKurzfassung(WS, DEAL, JETZT);
    expect(out.kunde).toMatchObject({ telefon: null, email: null, von: null, nach: null });
  });

  it("nur Relay-Adressen, keine Kanäle, Anrufe, Fotos, Dokumente: Platzhalter", async () => {
    dbAntwortet({ kunde: [{ von: null, nach: null, person_telefon: null, person_emails: [RELAY], kontakt_telefon: null, kontakt_emails: [RELAY] }] });
    mocks.gespraeche.mockResolvedValue([]);
    mocks.anrufe.mockResolvedValue([]);
    mocks.getAttachmentsForDeal.mockResolvedValue([]);
    const out = await ladeKurzfassung(WS, DEAL, JETZT);
    expect(out.kunde).toMatchObject({ telefon: null, email: null, von: null, nach: null });
    expect(out.gespraech).toEqual({ kanaele: "–", fotos: 0, dokumente: "–" });
  });

  it("Abfragen lesen nur und filtern auf Workspace und Deal", async () => {
    await ladeKurzfassung(WS, DEAL, JETZT);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    for (const [q] of mocks.execute.mock.calls) {
      const { text, params } = gerendert(q);
      expect(text.toLowerCase()).not.toMatch(/\b(update|insert|delete)\b/);
      expect(params).toContain(WS);
      expect(params).toContain(DEAL);
    }
    const kunde = mocks.execute.mock.calls.map(([q]) => gerendert(q)).find((r) => r.text.includes("FROM records r"))!;
    expect(kunde.text).toContain("o.workspace_id = $");
    expect(kunde.text).toContain("o.slug = 'deals'");
    expect(kunde.text).toContain("r.deleted_at IS NULL");
    expect(kunde.text).toContain("c.workspace_id = $");
    expect(kunde.text).toContain("pr.deleted_at IS NULL");
    const dok = mocks.execute.mock.calls.map(([q]) => gerendert(q)).find((r) => r.text.includes("FROM deal_documents d"))!;
    expect(dok.text).toContain("d.workspace_id = $");
    expect(dok.text).toContain("d.deal_record_id = $");
  });

  it("Deal nicht gefunden: Fehler aus ladeAkte geht durch", async () => {
    mocks.ladeAkteMitFakten.mockRejectedValue(new Error("Deal nicht gefunden"));
    await expect(ladeKurzfassung(WS, DEAL, JETZT)).rejects.toThrow("Deal nicht gefunden");
  });
});
