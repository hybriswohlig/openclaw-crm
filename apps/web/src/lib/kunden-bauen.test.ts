import { describe, expect, it } from "vitest";
import { canonicalizePhone } from "@/lib/identity/canonical";
import type { OffenEingabe } from "@/lib/geld";
import type { KundenSuche } from "@/lib/bewertungen-kunden";
import {
  dealOhneAusZeile,
  dealsOhneKundeZeilen,
  kundenAkteBauen,
  kundenZeilen,
  personAusZeile,
  type DealOhneRoh,
  type KundenDealRoh,
  type KundenPersonRoh,
} from "./kunden-bauen";

const LEER: KundenSuche = { art: "leer" };

function deal(over: Partial<KundenDealRoh> = {}): KundenDealRoh {
  return {
    dealId: "d1",
    dealNummer: null,
    titel: "Umzug",
    erstelltAm: "2026-11-01T00:00:00.000Z",
    kategorie: "booked",
    label: "Gebucht",
    umzugsdatum: null,
    firma: null,
    aktiveAnnahme: false,
    nichtKontaktieren: false,
    ...over,
  };
}

function person(over: Partial<KundenPersonRoh> & Pick<KundenPersonRoh, "personId">): KundenPersonRoh {
  const name = over.name ?? over.personId;
  return {
    kontaktart: null,
    telefone: [],
    emails: [],
    telefoneKanonisch: [],
    emailsKanonisch: [],
    deals: [deal({ dealId: `d-${over.personId}` })],
    ...over,
    personId: over.personId,
    name,
    suchnamen: over.suchnamen ?? [name],
  };
}

const geld = new Map<string, OffenEingabe>();

describe("personAusZeile", () => {
  it("kanonisiert Telefon in jeder Schreibweise und liest full_name", () => {
    const e164 = canonicalizePhone("+49 171 1234567", "DE");
    const p = personAusZeile({
      person_id: "p1",
      name_text: null,
      name_json: { full_name: "Erika Sommer" },
      kontaktart: "Bewerber",
      telefone: ["0171 1234567"],
      emails: ["Max@Example.de"],
      kennungen: [{ kind: "phone", wert: "+491609998877" }, { kind: "email", wert: "Anna@Firma.de" }],
      deals: [{ id: "d1", erstelltAm: "2026-11-02T10:00:00.000Z", kategorie: "quoted", label: "Angebot", annahme: true, nichtKontaktieren: false }],
    });
    expect(e164).toBeTruthy();
    expect(p?.telefoneKanonisch).toContain(e164);
    expect(p?.telefoneKanonisch).toEqual(expect.arrayContaining([
      canonicalizePhone("0049 171 1234567", "DE"),
      canonicalizePhone("01711234567", "DE"),
      "+491609998877",
    ]));
    expect(p?.emailsKanonisch).toEqual(expect.arrayContaining(["max@example.de", "anna@firma.de"]));
    expect(p?.name).toBe("Erika Sommer");
    expect(p?.suchnamen).toContain("Erika Sommer");
    expect(p?.kontaktart).toBe("bewerber");
    expect(p?.deals[0]).toMatchObject({ dealId: "d1", kategorie: "quoted", aktiveAnnahme: true, label: "Angebot" });
  });
});

describe("kundenZeilen", () => {
  const kottke = { id: "oc-k", name: "Kottke Umzüge", marke: "kottke" as const };
  const ceylan = { id: "oc-c", name: "Ceylan Transporte", marke: "ceylan" as const };

  const personen: KundenPersonRoh[] = [
    person({
      personId: "p-alt",
      name: "Alt Kunde",
      telefone: ["0171 1"],
      telefoneKanonisch: ["+491711"],
      deals: [deal({ dealId: "d-alt", erstelltAm: "2026-10-01T00:00:00.000Z", kategorie: "paid", umzugsdatum: "2026-01-01", firma: kottke })],
    }),
    person({
      personId: "p-neu",
      name: "Neu Kunde",
      emails: ["a@b.de"],
      emailsKanonisch: ["a@b.de"],
      deals: [
        deal({ dealId: "d-neu", dealNummer: "2026-14", erstelltAm: "2026-11-08T00:00:00.000Z", kategorie: "booked", umzugsdatum: "2026-12-01", firma: kottke, titel: "Neu" }),
        deal({ dealId: "d-neu2", erstelltAm: "2026-11-07T00:00:00.000Z", kategorie: "done_unpaid", umzugsdatum: "2026-06-01", firma: ceylan }),
      ],
    }),
    person({
      personId: "p-anfrage",
      name: "Nur Anfrage",
      deals: [deal({ dealId: "d-an", kategorie: "quoted", label: "Angebot", erstelltAm: "2026-11-09T00:00:00.000Z" })],
    }),
    person({
      personId: "p-annahme",
      name: "Mit Annahme",
      deals: [deal({ dealId: "d-ann", kategorie: "quoted", aktiveAnnahme: true, erstelltAm: "2026-11-05T00:00:00.000Z" })],
    }),
    person({
      personId: "p-bewerber",
      name: "Bewerberin",
      kontaktart: "bewerber",
      deals: [deal({ dealId: "d-bew", kategorie: "booked", erstelltAm: "2026-11-10T00:00:00.000Z" })],
    }),
    person({
      personId: "p-anna1",
      name: "Anna Berger",
      deals: [deal({ dealId: "d-a1", erstelltAm: "2026-09-01T00:00:00.000Z" })],
    }),
    person({
      personId: "p-anna2",
      name: "Berger, Anna",
      deals: [deal({ dealId: "d-a2", erstelltAm: "2026-09-02T00:00:00.000Z" })],
    }),
    person({
      personId: "a-kurz",
      name: "A",
      deals: [deal({ dealId: "d-kurz1" })],
    }),
    person({
      personId: "b-kurz",
      name: "A",
      deals: [deal({ dealId: "d-kurz2" })],
    }),
  ];

  const offen = new Map<string, OffenEingabe>([
    ["d-neu", { rechnung: { status: "gestellt", bruttoCent: 150000 }, annahmeCent: null, festpreis: null, istStunden: false, zahlungen: [{ amount: "400.00", taxTreatment: "betriebseinnahme" }] }],
    ["d-neu2", { rechnung: null, annahmeCent: null, festpreis: null, istStunden: true, zahlungen: [] }],
  ]);

  it("trennt Kunden, Anfragen und Bewerber und sortiert nach der letzten Deal-Anlage", () => {
    const kunden = kundenZeilen(personen, geld, new Set(), { ansicht: "kunden", suche: LEER, weiter: null, seite: 50 });
    const ids = kunden.zeilen.map((z) => z.personId);
    expect(ids).not.toContain("p-bewerber");
    expect(ids).not.toContain("p-anfrage");
    expect(ids.indexOf("p-neu")).toBeLessThan(ids.indexOf("p-alt"));
    expect(ids).toContain("p-annahme");
    const anfragen = kundenZeilen(personen, geld, new Set(), { ansicht: "anfragen", suche: LEER, weiter: null, seite: 50 });
    expect(anfragen.zeilen.map((z) => z.personId)).toEqual(["p-anfrage"]);
  });

  it("zählt Aufträge, Firmen, Umzug und offenen Rest", () => {
    const zeile = kundenZeilen(personen, offen, new Set(), { ansicht: "kunden", suche: { art: "dealnummer", nummer: "2026-14" }, weiter: null, seite: 50 }).zeilen[0];
    expect(zeile).toMatchObject({
      personId: "p-neu",
      telefon: null,
      auftraege: 2,
      wiederkehrer: true,
      letzterUmzug: "2026-12-01",
      offenCent: 110000,
      dublette: false,
    });
    expect(zeile?.firmen.map((f) => f.id)).toEqual(["oc-c", "oc-k"]);
  });

  it("findet Telefon, E-Mail und Name, Seiten mit Cursor", () => {
    const mitTelefon = person({ personId: "p-tel", telefoneKanonisch: ["+491711234567"], deals: [deal({ erstelltAm: "2026-08-01T00:00:00.000Z" })] });
    const liste = [...personen, mitTelefon];
    expect(kundenZeilen(liste, geld, new Set(), { ansicht: "kunden", suche: { art: "telefon", e164: "+491711234567" }, weiter: null, seite: 50 }).zeilen.map((z) => z.personId)).toEqual(["p-tel"]);
    expect(kundenZeilen(personen, geld, new Set(), { ansicht: "kunden", suche: { art: "email", text: "a@b.de" }, weiter: null, seite: 50 }).zeilen.map((z) => z.personId)).toEqual(["p-neu"]);
    const erik = person({
      personId: "p-erik",
      name: "Erika Sommer",
      suchnamen: ["Erika Sommer"],
      deals: [deal({ erstelltAm: "2026-08-02T00:00:00.000Z" })],
    });
    expect(kundenZeilen([...personen, erik], geld, new Set(), { ansicht: "kunden", suche: { art: "name", text: "sommer" }, weiter: null, seite: 50 }).zeilen.map((z) => z.personId)).toEqual(["p-erik"]);

    const seite1 = kundenZeilen(personen, geld, new Set(), { ansicht: "kunden", suche: LEER, weiter: null, seite: 2 });
    expect(seite1.zeilen).toHaveLength(2);
    expect(seite1.weiter).toBe(seite1.zeilen[1]?.personId);
    const seite2 = kundenZeilen(personen, geld, new Set(), { ansicht: "kunden", suche: LEER, weiter: seite1.weiter, seite: 2 });
    expect(seite2.zeilen.map((z) => z.personId)).not.toEqual(expect.arrayContaining(seite1.zeilen.map((z) => z.personId)));
    const alle = [...seite1.zeilen, ...seite2.zeilen];
    const rest = kundenZeilen(personen, geld, new Set(), { ansicht: "kunden", suche: LEER, weiter: seite2.weiter, seite: 2 });
    const zusammen = [...alle, ...rest.zeilen].map((z) => z.personId);
    expect(new Set(zusammen).size).toBe(zusammen.length);
    expect(rest.weiter === null || zusammen.length < kundenZeilen(personen, geld, new Set(), { ansicht: "kunden", suche: LEER, weiter: null, seite: 50 }).zeilen.length).toBe(true);
  });

  it("markiert Dubletten über Vorschlag und gleichen Namen, nicht über leeren Schlüssel", () => {
    const zeilen = kundenZeilen(personen, geld, new Set(["p-alt"]), { ansicht: "kunden", suche: LEER, weiter: null, seite: 50 }).zeilen;
    const von = (id: string) => zeilen.find((z) => z.personId === id);
    expect(von("p-alt")?.dublette).toBe(true);
    expect(von("p-anna1")?.dublette).toBe(true);
    expect(von("p-anna2")?.dublette).toBe(true);
    expect(von("a-kurz")?.dublette).toBe(false);
    expect(von("b-kurz")?.dublette).toBe(false);
    expect(von("p-neu")?.dublette).toBe(false);
  });
});

describe("dealsOhneKundeZeilen", () => {
  const deals: DealOhneRoh[] = [
    { dealId: "d-alt", dealNummer: "2026-1", titel: "Alter Auftrag", stufe: { label: "Angebot", kategorie: "quoted" }, firma: null, angelegtAm: "2026-01-01T00:00:00.000Z" },
    { dealId: "d-neu", dealNummer: "2026-88", titel: "Umzug ohne Person", stufe: { label: "Neu", kategorie: "open_new" }, firma: { id: "oc-k", name: "Kottke", marke: "kottke" }, angelegtAm: "2026-11-08T00:00:00.000Z" },
    { dealId: "d-lost", dealNummer: null, titel: "Verloren", stufe: { label: "Verloren", kategorie: "lost" }, firma: null, angelegtAm: "2026-11-09T00:00:00.000Z" },
  ];

  it("sortiert, filtert Stufe und sucht Nummer oder Name", () => {
    const alle = dealsOhneKundeZeilen(deals, { suche: LEER, weiter: null, seite: 50 });
    expect(alle.ohneKunde.map((d) => d.dealId)).toEqual(["d-neu", "d-alt"]);
    expect(dealsOhneKundeZeilen(deals, { suche: { art: "dealnummer", nummer: "2026-88" }, weiter: null, seite: 50 }).ohneKunde.map((d) => d.dealId)).toEqual(["d-neu"]);
    expect(dealsOhneKundeZeilen(deals, { suche: { art: "name", text: "ohne" }, weiter: null, seite: 50 }).ohneKunde.map((d) => d.titel)).toEqual(["Umzug ohne Person"]);
    expect(dealsOhneKundeZeilen(deals, { suche: { art: "telefon", e164: "+49171" }, weiter: null, seite: 50 }).ohneKunde).toEqual([]);
    expect(dealsOhneKundeZeilen(deals, { suche: { art: "email", text: "a@b.de" }, weiter: null, seite: 50 }).ohneKunde).toEqual([]);
  });

  it("liest die Zeile aus der Abfrage", () => {
    const d = dealOhneAusZeile({
      deal_id: "d1",
      angelegt_am: "2026-11-08 12:00:00",
      nummer: "2026-3",
      titel: "  ",
      stufe_label: null,
      stufe_kategorie: "quoted",
      firma_id: "oc",
      firma_name: "Kottke",
    });
    expect(d?.titel).toBe("Ohne Namen");
    expect(d?.stufe).toEqual({ label: "Ohne Stufe", kategorie: "quoted" });
    expect(d?.firma?.marke).toBe("kottke");
    expect(d?.angelegtAm.startsWith("2026-11-08")).toBe(true);
  });
});

describe("kundenAkteBauen", () => {
  it("baut Umzüge, Gespräche je Firma und Dubletten ohne Doppel", () => {
    const personRoh = person({
      personId: "p1",
      name: "Wanda Wieder",
      telefone: ["0171 1", "0171 2"],
      emails: ["w@k.de"],
      kontaktart: "lead_kunde",
      deals: [
        deal({
          dealId: "d-alt",
          erstelltAm: "2026-05-01T00:00:00.000Z",
          kategorie: "paid",
          label: "Bezahlt",
          umzugsdatum: "2026-05-02",
          firma: { id: "oc-k", name: "Kottke", marke: "kottke" },
          titel: "Erster",
          nichtKontaktieren: true,
        }),
        deal({
          dealId: "d-neu",
          erstelltAm: "2026-11-01T00:00:00.000Z",
          kategorie: "booked",
          firma: { id: "oc-c", name: "Ceylan", marke: "ceylan" },
          titel: "Zweiter",
        }),
      ],
    });
    const geldMap = new Map<string, OffenEingabe>([
      ["d-neu", { rechnung: { status: "gestellt", bruttoCent: 10000 }, annahmeCent: 999, festpreis: "1.00", istStunden: false, zahlungen: [] }],
    ]);
    const akte = kundenAkteBauen({
      person: personRoh,
      geld: geldMap,
      gespraeche: [
        { conversationId: "c-k", kanal: "whatsapp", konto: "Kottke WhatsApp", firma: { id: "oc-k", name: "Kottke", marke: "kottke" }, letzteNachrichtAm: "2026-11-01T00:00:00.000Z", dealId: null },
        { conversationId: "c-c", kanal: "email", konto: "Ceylan Mail", firma: { id: "oc-c", name: "Ceylan", marke: "ceylan" }, letzteNachrichtAm: "2026-11-02T00:00:00.000Z", dealId: "d-neu" },
      ],
      vorschlaege: [{ personId: "p-anna", name: "Anna Berger" }],
      namenMitDeal: [
        { personId: "p-anna", name: "Anna Berger" },
        { personId: "p-gleich", name: "Wanda Wieder" },
        { personId: "p1", name: "Wanda Wieder" },
      ],
    });
    expect(akte.umzuege.map((u) => u.dealId)).toEqual(["d-neu", "d-alt"]);
    expect(akte.umzuege[0]).toMatchObject({ gesamtCent: 10000, offenCent: 10000, bewertung: null, firma: { marke: "ceylan" } });
    expect(akte.offenCent).toBe(10000);
    expect(akte.mehrfachFirma).toBe(true);
    expect(akte.wiederkehrer).toBe(true);
    expect(akte.bewertungGesperrt).toBe(true);
    expect(akte.art).toBe("kunde");
    expect(akte.gespraeche.map((g) => g.firma?.id)).toEqual(["oc-c", "oc-k"]);
    expect(akte.dubletten).toEqual([
      { personId: "p-anna", name: "Anna Berger", grund: "vorschlag" },
      { personId: "p-gleich", name: "Wanda Wieder", grund: "gleicher_name" },
    ]);
    expect(akte.telefone).toEqual(["0171 1", "0171 2"]);
  });
});
