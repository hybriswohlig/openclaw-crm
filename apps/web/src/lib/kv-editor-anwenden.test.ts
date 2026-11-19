import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { RenderInput } from "@openclaw-crm/document-templates";
import {
  KV_FELDER_VPS,
  KV_KUECHE_TEXTFELDER,
  KV_LEISTUNGEN_KUECHE,
  KV_LEISTUNGEN_UMZUG,
  type KvAenderung,
  type KvBasis,
  type KvFeld,
  type KvKonflikt,
  type KvWert,
  type PushPruefEingabe,
  type VpsPaketTeile,
  kvFelderVpsGeprueft,
} from "./kv-editor";
import rohJson from "./__fixtures__/kv-paket-umzug.json";
import {
  abgleichen,
  crmAnwenden,
  crmBasis,
  listeFortschreiben,
  preisVerdacht,
  pruefeEingabe,
  pushPruefung,
  standUnterschied,
  vpsAnwenden,
  vpsBasis,
  vpsErwarteteBetraege,
  vpsPreisPruefung,
  zusammenfuehren,
} from "./kv-editor-anwenden";

const roh = rohJson as {
  details: VpsPaketTeile["details"];
  auftrag: VpsPaketTeile["auftrag"];
  inventarIds: (string | null)[];
  bildIds: string[];
  preise: Record<string, unknown>;
  gesamtCent: number;
  bezahltCent: number;
};

const TEXT = readFileSync(new URL("./__fixtures__/kv-text-umzug.txt", import.meta.url), "utf8");

const ALLE_MUSTER = new Set(KV_FELDER_VPS.map((d) => d.muster));

function teile(): VpsPaketTeile {
  return {
    details: structuredClone(roh.details),
    auftrag: structuredClone(roh.auftrag),
    inventarIds: structuredClone(roh.inventarIds),
    bildIds: structuredClone(roh.bildIds),
  };
}

function aend(
  schluessel: string,
  wert: KvWert,
  vorher: KvWert,
  quelle: "hand" | "ki" = "hand",
  extra?: { von?: string; am?: string }
): KvAenderung {
  return {
    schluessel,
    wert,
    vorher,
    quelle,
    von: extra?.von ?? "user-1",
    am: extra?.am ?? "2026-11-18T10:00:00.000Z",
  };
}

function feld(e: Pick<KvFeld, "schluessel" | "art" | "basis"> & Partial<KvFeld>): KvFeld {
  return { abschnitt: "uebersicht", label: "Feld", ...e };
}

describe("Fixture Umzug", () => {
  it("hat sieben Möbel, eine Zeile ohne Lead-ID und dreizehn Fotos", () => {
    expect(roh.details.inventory).toHaveLength(7);
    expect(roh.inventarIds).toHaveLength(7);
    expect(roh.inventarIds.filter((id) => id === null)).toEqual([null]);
    expect(roh.bildIds).toHaveLength(13);
    expect(roh.details.serviceType).toBe("move");
    expect(Object.keys(roh.details.services ?? {})).toEqual(Object.keys(KV_LEISTUNGEN_UMZUG));
    expect(roh.details.cardAgreed).toBe(false);
    expect(roh.details.validUntil).toBe("2026-12-31");
    expect(roh.gesamtCent).toBe(162000);
    expect(roh.bezahltCent).toBe(0);
    // Anonymisiert nach dem unpdf-Text von KV-KO-20261110-ART-3 (Seiten mit \f getrennt).
    expect(TEXT).toContain("KV-KO-20261110-BEI-1");
    expect(TEXT).toContain("Vertragsunterlagen");
    expect(TEXT).toContain("1.160,00 €");
  });
});

describe("vpsBasis", () => {
  it("baut den Katalog in KV-Reihenfolge, nur freigeschaltete Muster", () => {
    const p = teile();
    const basis = vpsBasis(p, ALLE_MUSTER);
    const ids = roh.inventarIds.filter((id): id is string => id !== null);
    const services = Object.keys(roh.details.services ?? {});
    const erwartet = [
      "uebersicht:termin:zeit",
      "uebersicht:auszug:details",
      "uebersicht:einzug:details",
      "uebersicht:umzugsgut:text",
      ...services.map((k) => `leistungen:${k}:notiz`),
      ...services.map((k) => `leistungen:${k}:zustaendig`),
      ...["bezeichnung", "raum", "notiz", "demontage", "montage"].flatMap((f) =>
        ids.map((id) => `umzugsgut:${id}:${f}`)
      ),
      ...roh.bildIds.map((id) => `bilder:${id}:zeigen`),
      "vereinbarungen:text:text",
    ];
    expect(basis.renderer).toBe("vps");
    expect(basis.felder.map((f) => f.schluessel)).toEqual(erwartet);
    expect(basis.felder.some((f) => f.schluessel.includes("Esstisch") || f.gruppe === "Esstisch")).toBe(false);
    expect(basis.felder.some((f) => f.schluessel.includes("companyWork"))).toBe(false);

    const zeit = basis.felder[0];
    expect(zeit).toMatchObject({
      basis: "Beginn gegen acht Uhr",
      label: "Uhrzeit",
      art: "text",
      max: 120,
      abschnitt: "uebersicht",
    });
    expect(zeit.gruppe).toBeUndefined();
    expect(zeit.firmaWaehlbar).toBeUndefined();

    const umzugsgut = basis.felder.find((f) => f.schluessel === "uebersicht:umzugsgut:text");
    expect(umzugsgut?.basis).toBe("etwa zwanzig Kubikmeter Hausrat");
    expect(umzugsgut?.gruppe).toBeUndefined();

    const transport = basis.felder.find((f) => f.schluessel === "leistungen:transport:zustaendig");
    const packing = basis.felder.find((f) => f.schluessel === "leistungen:packing:zustaendig");
    expect(transport).toMatchObject({ basis: "company", gruppe: "Transport", firmaWaehlbar: true, art: "zustaendig" });
    expect(packing).toMatchObject({ basis: "customer", gruppe: "Einpacken", firmaWaehlbar: false });
    expect(basis.felder.find((f) => f.schluessel === "leistungen:assembly:notiz")?.basis).toBe("");

    const sofa = basis.felder.find((f) => f.schluessel === "umzugsgut:inv-sofa:notiz");
    expect(sofa).toMatchObject({
      basis: "Auf Foto erkannt, im Chat nicht erwähnt",
      gruppe: "Sofa",
      label: "Notiz",
    });
    const schrank = basis.felder.find((f) => f.schluessel === "umzugsgut:inv-kleiderschrank:demontage");
    expect(schrank).toMatchObject({ basis: "company", firmaWaehlbar: true, gruppe: "Kleiderschrank 3-türig" });
    const waschen = basis.felder.find((f) => f.schluessel === "umzugsgut:inv-waschmaschine:raum");
    expect(waschen?.basis).toBe("");

    const foto = basis.felder.find((f) => f.schluessel === "bilder:bild-03:zeigen");
    expect(foto).toMatchObject({ basis: true, anhangId: "bild-03", gruppe: "Foto 3", art: "zeigen", label: "Im KV zeigen" });
    expect(basis.felder.find((f) => f.schluessel === "bilder:bild-13:zeigen")?.gruppe).toBe("Foto 13");
    expect(basis.felder.find((f) => f.schluessel === "vereinbarungen:text:text")?.basis).toBe(
      "Parkplatz vor dem Haus ist reserviert"
    );
    expect(p).toEqual(teile());
  });

  it("leerer Satz ergibt einen leeren Katalog, ein konkreter Schlüssel genau ein Feld", () => {
    expect(vpsBasis(teile(), new Set()).felder).toEqual([]);
    const nur = vpsBasis(teile(), new Set(["leistungen:transport:notiz"]));
    expect(nur.felder).toHaveLength(1);
    expect(nur.felder[0]).toMatchObject({
      schluessel: "leistungen:transport:notiz",
      basis: "Transport mit einem Koffer-Lkw",
      gruppe: "Transport",
      art: "langtext",
      label: "Notiz",
      abschnitt: "leistungen",
      max: 500,
    });
  });

  it("folgt innerhalb eines Musters der Reihenfolge der Daten", () => {
    const p = teile();
    p.details.services = {
      materials: { owner: "none", note: "Folie" },
      transport: { owner: "company", note: "Lkw" },
    };
    const basis = vpsBasis(p, new Set(["leistungen:{key}:notiz", "leistungen:{key}:zustaendig"]));
    expect(basis.felder.map((f) => f.schluessel)).toEqual([
      "leistungen:materials:notiz",
      "leistungen:transport:notiz",
      "leistungen:materials:zustaendig",
      "leistungen:transport:zustaendig",
    ]);
  });

  it("nimmt fehlende Texte als leeren String, Zahlen im Auftrag nicht", () => {
    const p = teile();
    p.details.time = undefined;
    p.details.from = undefined;
    p.auftrag = { volumen: 20, besonderheiten: 3 };
    const basis = vpsBasis(p, ALLE_MUSTER);
    expect(basis.felder.find((f) => f.schluessel === "uebersicht:termin:zeit")?.basis).toBe("");
    expect(basis.felder.find((f) => f.schluessel === "uebersicht:auszug:details")?.basis).toBe("");
    expect(basis.felder.find((f) => f.schluessel === "uebersicht:umzugsgut:text")?.basis).toBe("");
    expect(basis.felder.find((f) => f.schluessel === "vereinbarungen:text:text")?.basis).toBe("");
  });

  it("nimmt die Küche ohne Unsere Arbeiten und ohne Küchenteile auf", () => {
    const p = teile();
    p.details.kitchen = {
      details: "Küchenzeile in L-Form",
      dimensions: "",
      customerPrep: "Schränke vorher leer räumen",
      companyWork: "Montage der Küche laut Plan",
      excluded: "Fliesenarbeiten nicht enthalten",
      notes: "Altgeräte bleiben im Keller",
      time: "Beginn gegen neun Uhr",
      services: {
        installation: { owner: "company", note: "zwei Monteure" },
        disposal: { owner: "none" },
      },
      components: [{ category: "Unterschrank", name: "Spüle", quantity: 1, note: "weiß" }],
    };
    const basis = vpsBasis(p, ALLE_MUSTER);
    const kueche = basis.felder.filter((f) => f.abschnitt === "kueche").map((f) => f.schluessel);
    expect(kueche).toEqual([
      ...KV_KUECHE_TEXTFELDER.map((f) => `kueche:${f}:text`),
      "kueche-leistung:installation:notiz",
      "kueche-leistung:disposal:notiz",
      "kueche-leistung:installation:zustaendig",
      "kueche-leistung:disposal:zustaendig",
    ]);
    expect(kueche.some((s) => s.includes("companyWork") || s.includes("components") || s.startsWith("kueche-teil"))).toBe(
      false
    );
    expect(basis.felder.find((f) => f.schluessel === "kueche:details:text")?.basis).toBe("Küchenzeile in L-Form");
    expect(basis.felder.find((f) => f.schluessel === "kueche:otherContractor:text")?.basis).toBe("");
    expect(basis.felder.find((f) => f.schluessel === "kueche-leistung:installation:notiz")).toMatchObject({
      basis: "zwei Monteure",
      gruppe: KV_LEISTUNGEN_KUECHE.installation,
    });
    expect(basis.felder.find((f) => f.schluessel === "kueche-leistung:disposal:notiz")?.basis).toBe("");
    expect(basis.felder.find((f) => f.schluessel === "kueche-leistung:disposal:zustaendig")?.firmaWaehlbar).toBe(false);
    expect(basis.felder.find((f) => f.schluessel === "kueche-leistung:installation:zustaendig")?.firmaWaehlbar).toBe(true);
  });
});

describe("vpsAnwenden", () => {
  it("schreibt nur die Pfade der Felder und lässt die Eingabe unverändert", () => {
    const eingabe = teile();
    eingabe.details.kitchen = {
      details: "Küchenzeile in L-Form",
      companyWork: "Montage der Küche laut Plan",
      services: { installation: { owner: "company", note: "zwei Monteure" } },
      components: [{ name: "Spüle", quantity: 1 }],
    };
    const vorher = structuredClone(eingabe);
    const preiseVorher = structuredClone(roh.preise);
    const aus = vpsAnwenden(eingabe, [
      aend("uebersicht:termin:zeit", "Beginn gegen neun Uhr", "Beginn gegen acht Uhr"),
      aend("uebersicht:auszug:details", "Hof einfahrt", "Zufahrt über den Hinterhof, Klingel defekt"),
      aend("uebersicht:einzug:details", "Code an der Tür", "Schlüssel beim Hausmeister"),
      aend("uebersicht:umzugsgut:text", "etwa fünfundzwanzig Kubikmeter", "etwa zwanzig Kubikmeter Hausrat"),
      aend("leistungen:packing:notiz", "Kartons stehen im Flur", "Kartons stehen im Keller bereit"),
      aend("leistungen:packing:zustaendig", "none", "customer"),
      aend("leistungen:gibt-es-nicht:notiz", "weg", ""),
      aend("umzugsgut:inv-sofa:bezeichnung", "Ecksofa", "Sofa"),
      aend("umzugsgut:inv-sofa:notiz", "Ecke links", "Auf Foto erkannt, im Chat nicht erwähnt"),
      aend("umzugsgut:inv-kommode:raum", "Diele", "Flur"),
      aend("umzugsgut:inv-kommode:montage", "customer", "company"),
      aend("umzugsgut:phantom:bezeichnung", "Geist", "x"),
      aend("umzugsgut:3:notiz", "Index", "x"),
      aend("bilder:bild-07:zeigen", false, true),
      aend("vereinbarungen:text:text", "Parkplatz entfällt", "Parkplatz vor dem Haus ist reserviert"),
      aend("kueche:details:text", "Küchenzeile in U-Form", "Küchenzeile in L-Form"),
      aend("kueche:companyWork:text", "anders", "Montage der Küche laut Plan"),
      aend("kueche-leistung:installation:notiz", "drei Monteure", "zwei Monteure"),
      aend("kueche-leistung:delivery:notiz", "fehlt", ""),
      aend("kueche-teil:spüle:notiz", "weg", ""),
      aend("preise:pauschale:betrag", "1", "0"),
      aend("unbekannt", "x", "y"),
    ]);

    expect(eingabe).toEqual(vorher);
    expect(roh.preise).toEqual(preiseVorher);
    expect(aus).not.toHaveProperty("preise");
    expect(aus.details.time).toBe("Beginn gegen neun Uhr");
    expect(aus.details.from?.details).toBe("Hof einfahrt");
    expect(aus.details.to?.details).toBe("Code an der Tür");
    expect(aus.auftrag.volumen).toBe("etwa fünfundzwanzig Kubikmeter");
    expect(aus.auftrag.datum).toBe("2026-12-15");
    expect(aus.auftrag.besonderheiten).toBe("Parkplatz entfällt");
    expect(aus.details.services?.packing).toEqual({ owner: "none", note: "Kartons stehen im Flur" });
    expect(aus.details.services?.transport).toEqual(vorher.details.services?.transport);
    expect(aus.details.services?.["gibt-es-nicht"]).toBeUndefined();

    expect(aus.details.inventory?.[2]).toMatchObject({ name: "Ecksofa", note: "Ecke links", quantity: 1 });
    expect(aus.details.inventory?.[3]).toMatchObject({ name: "Esstisch", quantity: 1, note: "" });
    expect(aus.details.inventory?.[4]).toMatchObject({ name: "Kommode", room: "Diele", assembly: "customer", quantity: 2 });
    expect(aus.details.inventory).toHaveLength(7);
    expect(aus.details.inventory?.map((z) => z.quantity)).toEqual(vorher.details.inventory?.map((z) => z.quantity));

    expect(aus.bildIds).toEqual(vorher.bildIds.filter((id) => id !== "bild-07"));
    expect(aus.details.validUntil).toBe("2026-12-31");
    expect(aus.details.cardAgreed).toBe(false);
    expect(aus.details.depositDue).toBe("2026-12-01");
    expect(aus.details.kitchen?.companyWork).toBe("Montage der Küche laut Plan");
    expect(aus.details.kitchen?.components).toEqual([{ name: "Spüle", quantity: 1 }]);
    expect(aus.details.kitchen?.details).toBe("Küchenzeile in U-Form");
    expect(aus.details.kitchen?.services?.installation.note).toBe("drei Monteure");
    expect(aus.details.kitchen?.services?.delivery).toBeUndefined();
  });

  it("blendet ein Bild aus und lässt zeigen true stehen", () => {
    const eingabe = teile();
    const aus = vpsAnwenden(eingabe, [aend("bilder:bild-03:zeigen", false, true)]);
    expect(aus.bildIds).not.toContain("bild-03");
    expect(aus.bildIds).toHaveLength(12);

    const bleibt = vpsAnwenden(eingabe, [aend("bilder:bild-03:zeigen", true, true)]);
    expect(bleibt.bildIds).toEqual(eingabe.bildIds);

    const danach = vpsAnwenden(eingabe, [
      aend("bilder:bild-03:zeigen", false, true),
      aend("bilder:bild-03:zeigen", true, true),
    ]);
    expect(danach.bildIds).not.toContain("bild-03");
  });

  it("übergeht Küche, Leistung und Zeile, wenn das Ziel fehlt", () => {
    const eingabe = teile();
    const aus = vpsAnwenden(eingabe, [
      aend("kueche:details:text", "U-Form", ""),
      aend("kueche-leistung:installation:owner", "company", "none"),
    ]);
    expect(aus.details.kitchen).toBeUndefined();
    expect(aus.details).toEqual(eingabe.details);
  });
});

describe("crmBasis und crmAnwenden", () => {
  const model = {
    intro: ["Sehr geehrte Frau A,", "wir danken Ihnen für die Anfrage.", "Der Umzug ist am Dienstag."],
    closing: ["Mit freundlichen Grüßen", "Ihr Team"],
    remarks: "Bitte die Klingel nutzen.",
    summary: "Umzug der Wohnung",
  };
  const einleitung = "wir danken Ihnen für die Anfrage.\n\nDer Umzug ist am Dienstag.";

  function eingabe(copy?: RenderInput["copy"]): RenderInput {
    return {
      kind: "KV",
      deal: { firma: "ceylan", customerName: "Frau A", documentDate: "2026-11-10" },
      quotation: {
        isVariable: false,
        fixedPrice: "1620.00",
        lineItems: [],
        depositRequiredCents: null,
        paymentMethodPreference: null,
        validUntil: null,
        summary: "Umzug der Wohnung",
        serviceType: "move",
      },
      copy,
    };
  }

  it("lässt die Begrüßung aus der Basis, auch nach geändertem Namen", () => {
    const basis = crmBasis(model, {});
    expect(basis.renderer).toBe("crm");
    expect(basis.felder.map((f) => f.schluessel)).toEqual([
      "anschreiben:einleitung:text",
      "uebersicht:zusammenfassung:text",
      "bemerkungen:text:text",
      "anschreiben:schluss:text",
    ]);
    expect(basis.felder[0]).toMatchObject({ basis: einleitung, art: "langtext", max: 2000, label: "Einleitung" });
    expect(basis.felder[1].basis).toBe("Umzug der Wohnung");
    expect(basis.felder[2].basis).toBe("Bitte die Klingel nutzen.");
    expect(basis.felder[3].basis).toBe("Mit freundlichen Grüßen\n\nIhr Team");
    expect(basis.felder[0].gruppe).toBeUndefined();

    const umbenannt = crmBasis({ ...model, intro: ["Sehr geehrter Herr B,", ...model.intro.slice(1)] }, {});
    expect(umbenannt.felder[0].basis).toBe(basis.felder[0].basis);
  });

  it("nimmt introText, sonst altes intro, sonst den Text nach der Begrüßung", () => {
    expect(crmBasis(model, { intro: "Alter Anschreibentext" }).felder[0].basis).toBe("Alter Anschreibentext");
    expect(crmBasis(model, { introText: "Eigener Text", intro: "Alter Anschreibentext" }).felder[0].basis).toBe(
      "Eigener Text"
    );
    expect(crmBasis(model, { introText: "" }).felder[0].basis).toBe("");
    expect(crmBasis({ ...model, remarks: undefined, summary: undefined }, {}).felder.map((f) => f.basis)).toEqual([
      einleitung,
      "",
      "",
      "Mit freundlichen Grüßen\n\nIhr Team",
    ]);
  });

  it("setzt introText, löscht intro und schreibt die Zusammenfassung nur ins PDF", () => {
    const input = eingabe({ intro: "Alter Anschreibentext", closing: "Alt", remarks: "Alt" });
    const vorher = structuredClone(input);
    const aus = crmAnwenden(input, [
      aend("anschreiben:einleitung:text", "Wir kommen am Dienstag.", einleitung),
      aend("anschreiben:schluss:text", "Herzliche Grüße", "Alt"),
      aend("bemerkungen:text:text", "Bitte den Hof freihalten.", "Alt"),
      aend("uebersicht:zusammenfassung:text", "Umzug mit Einpacken", "Umzug der Wohnung"),
      aend("uebersicht:termin:zeit", "neun", "acht"),
    ]);
    const copy = aus.copy as { introText?: string; intro?: string; closing?: string; remarks?: string };
    expect(copy.introText).toBe("Wir kommen am Dienstag.");
    expect(copy.intro).toBeUndefined();
    expect(copy.closing).toBe("Herzliche Grüße");
    expect(copy.remarks).toBe("Bitte den Hof freihalten.");
    expect(aus.quotation.summary).toBe("Umzug mit Einpacken");
    expect(aus.quotation.fixedPrice).toBe("1620.00");
    expect(aus.deal).toEqual(input.deal);
    expect(input).toEqual(vorher);
  });
});

describe("preisVerdacht", () => {
  it.each([
    "20 % Rabatt",
    "Der Umzug ist kostenlos",
    "Wir verzichten auf den Aufpreis",
    "Zahlung in Raten",
    "Festpreis 1620",
    "1.620,00 €",
    "Die Kosten stehen im Kostenvoranschlag",
    "200 Euro",
    "Gesamtpreis",
    "Das ist gratis fertig",
    // Aufgabe 8 (Review 4, Grok 4)
    "Die Montage erfolgt ohne Berechnung.",
    "Wir erstatten Ihnen die Anfahrt.",
    "Als Stammkunde erhalten Sie eine Gutschrift.",
    "Endsumme 12500",
    "Gesamtsumme wie besprochen",
    "Ermäßigung für Senioren",
  ])("erkennt %s", (text) => {
    expect(preisVerdacht(text)).toBe(true);
  });

  it.each([
    "3,20 m",
    "4. Stock",
    "15.12.2026",
    "15.12.26",
    "Euro-Paletten",
    "20 Euro-Paletten",
    "EUR-Paletten",
    "Laut Kostenvoranschlag",
    "Laut Kostenvoranschläge",
    "Laut Kostenvoranschlags",
    "Kleiderschrank 3-türig",
    "ab 8 Uhr",
    "2,5 cbm",
    "Wir beraten Sie gern.",
    "Wir fahren durch Europa.",
    "812 kg",
    "812 Stück",
    "3,20 m²",
  ])("lässt %s durch", (text) => {
    expect(preisVerdacht(text)).toBe(false);
  });

  // Entscheidung Koordinator (Aufgabe 3): Postleitzahl, Telefon, Wohnung und Hausnummer sind keine Preise.
  it.each([
    "Einzug 70173 Stuttgart",
    "PLZ 71229",
    "Bitte vorher anrufen: +49 711 1234567",
    "Tel. +49 (0)711 123456",
    "Hausmeister 0711 / 123456",
    "Hausmeister 0711 123456",
    "Hausmeister 0711-123456",
    "Handy 01711234567",
    "Rückruf unter 123456",
    "Wohnung 104",
    "Whg. 312, 3. Stock",
    "Whg 312",
    "Nr. 117 im Hinterhof",
    "Wohnung 12, Klingel Nr. 104",
    "Hausmeister 0711 / 123456, Zufahrt über 70173",
    "PLZ 70173.",
  ])("lässt %s durch", (text) => {
    expect(preisVerdacht(text)).toBe(false);
  });

  it.each([
    "Preis 71229",
    "Festpreis 123456",
    "Anzahlung 0711 123456",
    "Wohnung 104 für 250",
    "Nr. 12 kostet 300",
    "1620 statt 1800",
    "123456 €",
    "Kosten 1.620",
    "Zuschlag 123456,50",
    "123456,50",
  ])("lehnt %s weiter ab", (text) => {
    expect(preisVerdacht(text)).toBe(true);
  });

  it.each([
    "prozent",
    "rabatt",
    "nachlass",
    "skonto",
    "kostenlos",
    "kostenfrei",
    "gratis",
    "umsonst",
    "unentgeltlich",
    "aufpreis",
    "zuschlag",
    "aufschlag",
    "betrag",
    "kosten",
    "kostet",
    "mehrkosten",
    "bezahl",
    "zahlung",
    "zahlbar",
    "anzahlung",
    "rechnung",
  ])("Wortanfang %s", (wort) => {
    expect(preisVerdacht(`Hinweis ${wort} im Text`)).toBe(true);
  });
});

describe("pruefeEingabe", () => {
  const basis: KvBasis = {
    renderer: "vps",
    felder: [
      feld({ schluessel: "uebersicht:termin:zeit", art: "text", basis: "PLZ 70173", max: 20, label: "Uhrzeit" }),
      feld({ schluessel: "vereinbarungen:text:text", art: "langtext", basis: "kurz", max: 8, label: "Text" }),
      feld({
        schluessel: "leistungen:packing:zustaendig",
        art: "zustaendig",
        basis: "customer",
        firmaWaehlbar: false,
        label: "Zuständig",
      }),
      feld({
        schluessel: "leistungen:transport:zustaendig",
        art: "zustaendig",
        basis: "company",
        firmaWaehlbar: true,
        label: "Zuständig",
      }),
      feld({ schluessel: "bilder:bild-01:zeigen", art: "zeigen", basis: true, label: "Im KV zeigen" }),
      feld({ schluessel: "bilder:bild-02:zeigen", art: "zeigen", basis: false, label: "Im KV zeigen" }),
    ],
  };

  it("lehnt jeden Grund ab und lässt unveränderten Text mit Postleitzahl zu", () => {
    const setzen = [
      { schluessel: "uebersicht:termin:zeit", wert: "  Hallo  " },
      { schluessel: "gibt-es-nicht", wert: "x" },
      { schluessel: "uebersicht:termin:zeit", wert: "  PLZ 70173  " },
      { schluessel: "vereinbarungen:text:text", wert: 12 },
      { schluessel: "vereinbarungen:text:text", wert: "viel zu langer Text" },
      { schluessel: "leistungen:packing:zustaendig", wert: "firma" },
      { schluessel: "leistungen:packing:zustaendig", wert: "company" },
      { schluessel: "leistungen:transport:zustaendig", wert: "customer" },
      { schluessel: "bilder:bild-01:zeigen", wert: "ja" },
      { schluessel: "bilder:bild-02:zeigen", wert: true },
      { schluessel: "bilder:bild-01:zeigen", wert: false },
      { schluessel: "vereinbarungen:text:text", wert: "Rabatt" },
    ];
    const ergebnis = pruefeEingabe(basis, setzen);
    expect(ergebnis.ok).toEqual([
      { schluessel: "uebersicht:termin:zeit", wert: "PLZ 70173", vorher: "PLZ 70173" },
      { schluessel: "leistungen:transport:zustaendig", wert: "customer", vorher: "company" },
      { schluessel: "bilder:bild-01:zeigen", wert: false, vorher: true },
    ]);
    expect(ergebnis.abgelehnt).toEqual([
      { schluessel: "gibt-es-nicht", grund: "UNBEKANNT" },
      { schluessel: "vereinbarungen:text:text", grund: "PREIS" },
      { schluessel: "leistungen:packing:zustaendig", grund: "FIRMA_GESPERRT" },
      { schluessel: "bilder:bild-02:zeigen", grund: "TYP" },
    ]);
  });

  it("meldet ZU_LANG vor PREIS und TYP bei falscher Art", () => {
    const zuLang = pruefeEingabe(basis, [{ schluessel: "vereinbarungen:text:text", wert: "Rabatt extra" }]);
    expect(zuLang.abgelehnt).toEqual([{ schluessel: "vereinbarungen:text:text", grund: "ZU_LANG" }]);
    const typ = pruefeEingabe(basis, [
      { schluessel: "uebersicht:termin:zeit", wert: 8 },
      { schluessel: "leistungen:transport:zustaendig", wert: "company " },
      { schluessel: "bilder:bild-01:zeigen", wert: 1 },
    ]);
    expect(typ.abgelehnt.map((a) => a.grund)).toEqual(["TYP", "TYP", "TYP"]);
    const leer = pruefeEingabe(basis, [{ schluessel: "uebersicht:termin:zeit", wert: "   " }]);
    expect(leer.ok).toEqual([{ schluessel: "uebersicht:termin:zeit", wert: "", vorher: "PLZ 70173" }]);
  });
});

describe("listeFortschreiben", () => {
  const wer = { quelle: "hand" as const, von: "neu-user", am: "2026-11-18T12:00:00.000Z" };

  it("entfernt den Basiswert bei Hand und KI, behält denselben Wert, ersetzt an der Stelle", () => {
    const vorher: KvAenderung[] = [
      aend("a", "alt", "basis", "ki", { von: "ki-user", am: "2026-11-01T00:00:00.000Z" }),
      aend("b", "gleich", "basis-b", "ki", { von: "ki-user", am: "2026-11-02T00:00:00.000Z" }),
      aend("c", "alt", "basis-c", "hand", { am: "2026-11-03T00:00:00.000Z" }),
      aend("d", "weg", "basis-d"),
    ];
    const aus = listeFortschreiben(
      vorher,
      [
        { schluessel: "a", wert: "basis", vorher: "basis" },
        { schluessel: "b", wert: "gleich", vorher: "andere-basis" },
        { schluessel: "c", wert: "neu", vorher: "basis-c" },
        { schluessel: "e", wert: "dazu", vorher: "basis-e" },
      ],
      ["d"],
      wer
    );
    expect(vorher.map((x) => x.schluessel)).toEqual(["a", "b", "c", "d"]);
    expect(aus.map((x) => x.schluessel)).toEqual(["b", "c", "e"]);
    expect(aus[0]).toEqual(vorher[1]);
    expect(aus[0]).not.toBe(vorher[1]);
    expect(aus[1]).toEqual({ ...aend("c", "neu", "basis-c"), quelle: "hand", von: "neu-user", am: wer.am });
    expect(aus[2]).toEqual(aend("e", "dazu", "basis-e", "hand", { von: "neu-user", am: wer.am }));
  });

  it("hängt einen zurückgesetzten und neu gesetzten Schlüssel hinten an", () => {
    const aus = listeFortschreiben(
      [aend("a", "x", "basis"), aend("b", "y", "basis-b")],
      [{ schluessel: "a", wert: "neu", vorher: "basis" }],
      ["a"],
      wer
    );
    expect(aus.map((x) => x.schluessel)).toEqual(["b", "a"]);
    expect(aus[1].wert).toBe("neu");
  });
});

describe("abgleichen", () => {
  const basis: KvBasis = {
    renderer: "vps",
    felder: [
      feld({ schluessel: "leistungen:transport:notiz", art: "langtext", basis: "Hinweis neu", max: 500 }),
      feld({
        schluessel: "leistungen:transport:zustaendig",
        art: "zustaendig",
        basis: "customer",
        firmaWaehlbar: false,
      }),
      feld({ schluessel: "umzugsgut:inv1:notiz", art: "text", basis: "Foto", max: 300 }),
      feld({ schluessel: "umzugsgut:inv1:bezeichnung", art: "text", basis: "Schrank", max: 120 }),
      feld({ schluessel: "umzugsgut:inv1:raum", art: "text", basis: "Flur", max: 60 }),
      feld({
        schluessel: "umzugsgut:inv1:montage",
        art: "zustaendig",
        basis: "company",
        firmaWaehlbar: true,
      }),
      feld({ schluessel: "vereinbarungen:text:text", art: "langtext", basis: "Parkplatz neu", max: 2000 }),
    ],
  };

  it("bewertet Änderungen und offene Konflikte über zwei Stände", () => {
    const aenderungen = [
      aend("leistungen:transport:notiz", "Hinweis neu", "Hinweis alt", "hand", { am: "2026-11-01T00:00:00.000Z" }),
      aend("leistungen:transport:zustaendig", "company", "company"),
      aend("umzugsgut:inv1:notiz", "ohne Glas", "Foto", "ki"),
      aend("umzugsgut:inv1:bezeichnung", "Regal", "Kommode"),
      aend("umzugsgut:inv-weg:raum", "Keller", "Flur"),
    ];
    const offen: KvKonflikt[] = [
      {
        aenderung: aend("umzugsgut:inv1:raum", "Bad", "Flur"),
        art: "basis_geaendert",
        basisJetzt: "Hof",
        status: "offen",
        entschiedenVon: "alt",
        entschiedenAm: "2026-11-01T00:00:00.000Z",
      },
      {
        aenderung: aend("umzugsgut:inv1:montage", "company", "none"),
        art: "basis_geaendert",
        basisJetzt: "none",
        status: "offen",
      },
      {
        aenderung: aend("vereinbarungen:text:text", "Hof", "Parkplatz alt"),
        art: "ziel_fehlt",
        basisJetzt: null,
        status: "offen",
        entschiedenVon: "alt",
      },
      {
        aenderung: aend("umzugsgut:inv1:notiz", "anderes", "Foto"),
        art: "basis_geaendert",
        basisJetzt: "x",
        status: "offen",
      },
      {
        aenderung: aend("bilder:weg:zeigen", false, true),
        art: "basis_geaendert",
        basisJetzt: true,
        status: "offen",
      },
      {
        aenderung: aend("leistungen:packing:notiz", "weg", "alt"),
        art: "basis_geaendert",
        basisJetzt: "alt",
        status: "verworfen",
        entschiedenVon: "nuri",
      },
      {
        aenderung: aend("leistungen:materials:notiz", "weg", "alt"),
        art: "basis_geaendert",
        basisJetzt: "alt",
        status: "uebernommen",
      },
    ];
    const vorherA = structuredClone(aenderungen);
    const vorherO = structuredClone(offen);
    const aus = abgleichen(basis, aenderungen, offen);

    expect(aenderungen).toEqual(vorherA);
    expect(offen).toEqual(vorherO);
    expect(aus.liste.map((a) => a.schluessel)).toEqual([
      "leistungen:transport:notiz",
      "umzugsgut:inv1:notiz",
      "umzugsgut:inv1:raum",
      "umzugsgut:inv1:montage",
    ]);
    expect(aus.liste[0]).toEqual({ ...aenderungen[0], vorher: "Hinweis neu" });
    expect(aus.liste[1]).toEqual(aenderungen[2]);
    expect(aus.liste[2]).toEqual(offen[0].aenderung);
    expect(aus.liste[3]).toEqual({ ...offen[1].aenderung, vorher: "company" });

    expect(aus.konflikte).toEqual([
      {
        aenderung: aenderungen[1],
        art: "nicht_erlaubt",
        basisJetzt: "customer",
        status: "offen",
      },
      {
        aenderung: aenderungen[3],
        art: "basis_geaendert",
        basisJetzt: "Schrank",
        status: "offen",
      },
      {
        aenderung: aenderungen[4],
        art: "ziel_fehlt",
        basisJetzt: null,
        status: "offen",
      },
      {
        aenderung: offen[2].aenderung,
        art: "basis_geaendert",
        basisJetzt: "Parkplatz neu",
        status: "offen",
      },
      {
        aenderung: offen[4].aenderung,
        art: "ziel_fehlt",
        basisJetzt: null,
        status: "offen",
      },
    ]);
  });
});

describe("zusammenfuehren", () => {
  it("nimmt die geänderte Seite, bei gleichem Wert meins, sonst einen Konflikt", () => {
    const gemeinsam = [
      aend("nur-ich", "alt", "0"),
      aend("nur-die", "alt", "0"),
      aend("gleich", "alt", "0"),
      aend("verschieden", "alt", "0"),
      aend("weg", "alt", "0"),
      aend("beide-weg", "alt", "0"),
    ];
    const meins = [
      aend("nur-ich", "neu", "alt", "hand", { von: "ich" }),
      aend("nur-die", "alt", "0"),
      aend("gleich", "neu", "alt", "hand", { von: "ich" }),
      aend("verschieden", "x", "alt", "hand", { von: "ich" }),
      aend("weg", "alt", "0"),
      aend("nur-neu", "dazu", "0", "hand", { von: "ich" }),
    ];
    const deren = [
      aend("nur-ich", "alt", "0", "ki", { von: "die" }),
      aend("nur-die", "neu", "alt", "ki", { von: "die" }),
      aend("gleich", "neu", "woanders", "ki", { von: "die" }),
      aend("verschieden", "y", "alt", "ki", { von: "die" }),
      aend("nur-bei-denen", "extra", "0", "ki", { von: "die" }),
    ];
    const aus = zusammenfuehren(gemeinsam, meins, deren);
    expect(aus.liste).toEqual([
      meins[0],
      deren[1],
      meins[2],
      meins[5],
      deren[4],
    ]);
    expect(aus.konflikte).toEqual([
      { schluessel: "verschieden", meins: meins[3], deren: deren[3] },
    ]);
    expect(aus.liste.map((a) => a.schluessel)).not.toContain("weg");
    expect(aus.liste.map((a) => a.schluessel)).not.toContain("beide-weg");
  });
});

describe("standUnterschied", () => {
  const basis: KvBasis = {
    renderer: "vps",
    felder: [
      feld({ schluessel: "uebersicht:termin:zeit", art: "text", basis: "acht", label: "Uhrzeit", abschnitt: "uebersicht" }),
      feld({
        schluessel: "vereinbarungen:text:text",
        art: "langtext",
        basis: "Parkplatz",
        label: "Ergänzende Vereinbarungen",
        abschnitt: "vereinbarungen",
      }),
      feld({
        schluessel: "umzugsgut:inv-1:bezeichnung",
        art: "text",
        basis: "Schrank",
        label: "Bezeichnung",
        abschnitt: "umzugsgut",
        gruppe: "Schrank",
      }),
    ],
  };

  it("zeigt neu, geändert und zurück in Katalogreihenfolge", () => {
    const zeilen = standUnterschied(
      basis,
      [
        aend("uebersicht:termin:zeit", "neun", "acht"),
        aend("umzugsgut:inv-1:bezeichnung", "Regal", "Schrank"),
        aend("leistungen:packing:notiz", "gleich", ""),
        aend("leistungen:transport:notiz", "alt", ""),
        aend("kaputt", "x", "y"),
      ],
      [
        aend("umzugsgut:inv-1:bezeichnung", "Kommode", "Schrank"),
        aend("vereinbarungen:text:text", "Hof", "Parkplatz"),
        aend("leistungen:packing:notiz", "gleich", ""),
        aend("leistungen:transport:notiz", "neu", ""),
        aend("auch-kaputt", "z", "y"),
      ]
    );
    expect(zeilen).toEqual([
      {
        schluessel: "uebersicht:termin:zeit",
        abschnitt: "uebersicht",
        label: "Uhrzeit",
        vorher: "neun",
        nachher: "acht",
        art: "zurueck",
      },
      {
        schluessel: "vereinbarungen:text:text",
        abschnitt: "vereinbarungen",
        label: "Ergänzende Vereinbarungen",
        vorher: "Parkplatz",
        nachher: "Hof",
        art: "neu",
      },
      {
        schluessel: "umzugsgut:inv-1:bezeichnung",
        abschnitt: "umzugsgut",
        gruppe: "Schrank",
        label: "Bezeichnung",
        vorher: "Regal",
        nachher: "Kommode",
        art: "geaendert",
      },
      {
        schluessel: "leistungen:transport:notiz",
        abschnitt: "leistungen",
        label: "Notiz",
        vorher: "alt",
        nachher: "neu",
        art: "geaendert",
      },
    ]);
  });
});

describe("pushPruefung", () => {
  const fertig: PushPruefEingabe = {
    status: "fertig",
    standVersionId: "v1",
    quotationVersionId: "v1",
    aktuellDokumentId: "d1",
    erwartetAktuellDokumentId: "d1",
    schonGepusht: false,
    annahmeAktiv: false,
    annahmeAufhebenBestaetigt: false,
    admin: false,
    preisOk: true,
  };

  it("Aufgabe 8: Preisstand geändert bei gleicher Version → KALKULATION_NEU (Review 1)", () => {
    expect(pushPruefung({ ...fertig, preisStandGleich: false })).toEqual({ ok: false, fehler: "KALKULATION_NEU" });
    expect(pushPruefung({ ...fertig, preisStandGleich: true })).toEqual({ ok: true, annahmeAufheben: false });
    // Reihenfolge: AKTUELL_GEAENDERT vor dem Preisstand.
    expect(pushPruefung({ ...fertig, preisStandGleich: false, erwartetAktuellDokumentId: "d0" })).toEqual({ ok: false, fehler: "AKTUELL_GEAENDERT" });
  });

  it("prüft in der Reihenfolge des Vertrags und gibt jeden Code", () => {
    expect(pushPruefung(fertig)).toEqual({ ok: true, annahmeAufheben: false });
    expect(pushPruefung({ ...fertig, standVersionId: null, quotationVersionId: null })).toEqual({
      ok: true,
      annahmeAufheben: false,
    });

    expect(pushPruefung({ ...fertig, status: "druckt", schonGepusht: true, preisOk: false })).toEqual({
      ok: false,
      fehler: "STAND_NICHT_FERTIG",
    });
    expect(pushPruefung({ ...fertig, status: "fehler" })).toEqual({ ok: false, fehler: "STAND_NICHT_FERTIG" });
    expect(pushPruefung({ ...fertig, preisOk: false })).toEqual({ ok: false, fehler: "STAND_NICHT_FERTIG" });

    expect(
      pushPruefung({ ...fertig, schonGepusht: true, aktuellDokumentId: "andere", standVersionId: "alt" })
    ).toEqual({ ok: false, fehler: "UNGUELTIG" });

    expect(pushPruefung({ ...fertig, aktuellDokumentId: "andere", standVersionId: "alt", annahmeAktiv: true })).toEqual({
      ok: false,
      fehler: "AKTUELL_GEAENDERT",
    });
    expect(pushPruefung({ ...fertig, aktuellDokumentId: null, erwartetAktuellDokumentId: "d1" })).toEqual({
      ok: false,
      fehler: "AKTUELL_GEAENDERT",
    });

    expect(pushPruefung({ ...fertig, standVersionId: "alt", quotationVersionId: "neu", annahmeAktiv: true })).toEqual({
      ok: false,
      fehler: "KALKULATION_NEU",
    });

    expect(pushPruefung({ ...fertig, annahmeAktiv: true, admin: true })).toEqual({
      ok: false,
      fehler: "ANNAHME_AKTIV",
    });
    expect(pushPruefung({ ...fertig, annahmeAktiv: true, annahmeAufhebenBestaetigt: true, admin: false })).toEqual({
      ok: false,
      fehler: "NUR_ADMIN",
    });
    expect(pushPruefung({ ...fertig, annahmeAktiv: true, annahmeAufhebenBestaetigt: true, admin: true })).toEqual({
      ok: true,
      annahmeAufheben: true,
    });
  });
});

describe("vpsErwarteteBetraege", () => {
  it("rechnet Posten, Anzahlung und Gesamt des Umzugs", () => {
    expect(vpsErwarteteBetraege(roh.preise, { gesamtCent: 162000, bezahltCent: 0 })).toEqual({
      erwartetCent: [20000, 46000, 116000, 162000],
      // Anzahlung minus bezahlt ist 20000 und steht zusätzlich in erlaubt.
      erlaubtCent: [0, 20000, 142000, 162000],
    });
  });

  it("nimmt Euro als Zahl oder String, nur endlich und größer als null, ohne Doppelte", () => {
    const aus = vpsErwarteteBetraege(
      {
        pauschale_betrag: "10",
        pauschale_positionen: [{ betrag: 10 }, { betrag: 0 }, { betrag: -3 }, { betrag: "abc" }, { titel: "ohne" }],
        stundensatz_helfer_eur: 45.5,
        stundensatz_transporter_eur: "45.5",
        anzahlung_betrag_eur: 0,
      },
      { gesamtCent: null, bezahltCent: 1000 }
    );
    expect(aus).toEqual({ erwartetCent: [1000, 4550], erlaubtCent: [0, 1000] });
  });

  it("erlaubt die offene Anzahlung, wenn schon etwas bezahlt ist", () => {
    const aus = vpsErwarteteBetraege(roh.preise, { gesamtCent: 162000, bezahltCent: 5000 });
    expect(aus.erlaubtCent).toEqual([0, 5000, 15000, 142000, 157000]);
  });
});

describe("vpsPreisPruefung", () => {
  const betreage = () => vpsErwarteteBetraege(roh.preise, { gesamtCent: roh.gesamtCent, bezahltCent: roh.bezahltCent });

  it("liest den Text der Fixture bis Vertragsunterlagen als ok", () => {
    expect(vpsPreisPruefung(TEXT, betreage())).toEqual({ preis: "ok", fehlt: [], fremd: [] });
  });

  it("liest geschützte Leerzeichen vor dem Euro wie Leerzeichen", () => {
    const text = TEXT.replace("Gesamtpreis 1.620,00 €", "Gesamtpreis 1.620,00\u00A0€").replace("460,00 € 460,00 €", "460,00\u202F€ 460,00 €");
    expect(vpsPreisPruefung(text, betreage())).toEqual({ preis: "ok", fehlt: [], fremd: [] });
  });

  it("meldet einen vertauschten Betrag als Abweichung", () => {
    const text = TEXT.replaceAll("1.160,00", "1.260,00");
    expect(vpsPreisPruefung(text, betreage())).toEqual({
      preis: "abweichung",
      fehlt: [116000],
      fremd: [126000],
    });
  });

  it("meldet leeren Text als nicht lesbar und zählt die AGB nicht", () => {
    const erwartet = betreage();
    expect(vpsPreisPruefung("   \u00A0  ", erwartet)).toEqual({
      preis: "nicht_lesbar",
      fehlt: erwartet.erwartetCent,
      fremd: [],
    });
    expect(vpsPreisPruefung("Vertragsunterlagen\nHaftung bis 620,00 €", erwartet).preis).toBe("nicht_lesbar");
  });

  it("Aufgabe 8: das Wort Vertragsunterlagen im Freitext kürzt den geprüften Teil nicht (Review 5)", () => {
    const seiten = TEXT.split("\f");
    const mitFreitext = [seiten[13], "Bitte Vertragsunterlagen bereithalten. Zuschlag 970,00 €", ...seiten.slice(14)].join("\f");
    expect(vpsPreisPruefung(mitFreitext, betreage())).toMatchObject({ preis: "abweichung", fremd: [97000] });
  });

  it("Aufgabe 8: vorangestellte Währung zählt als Betrag, Tabellenzeilen nicht doppelt (Grok 1)", () => {
    const preis = TEXT.split("\f")[13];
    expect(vpsPreisPruefung(`${preis}\nBitte € 999,00 nennen`, betreage())).toMatchObject({ preis: "abweichung", fremd: [99900] });
    expect(vpsPreisPruefung(`${preis}\nEUR 999 bar`, betreage())).toMatchObject({ preis: "abweichung", fremd: [99900] });
    expect(vpsPreisPruefung(`${preis}\nTransport 1.160,00 € 2 Helfer`, betreage()).preis).toBe("ok");
  });

  it("Aufgabe 8: ohne erwarteten Betrag nie ok (Review 2)", () => {
    expect(vpsPreisPruefung("Kostenvoranschlag\nUmzug ohne Preis", { erwartetCent: [], erlaubtCent: [0] })).toEqual({
      preis: "nicht_lesbar",
      fehlt: [],
      fremd: [],
    });
    expect(vpsPreisPruefung("Gesamt 1.620,00 €", { erwartetCent: [], erlaubtCent: [0] })).toMatchObject({ preis: "nicht_lesbar", fremd: [162000] });
  });

  it("hat die Seitenstruktur des echten VPS-Texts: 21 Seiten, Vertragsunterlagen erst hinter dem Seiteninhalt", () => {
    const seiten = TEXT.split("\f");
    expect(seiten).toHaveLength(21);
    // Die Haftungsseite trägt 620 Euro vor ihrer Kopfzeile „Vertragsunterlagen“: zählt nicht.
    expect(seiten[16].indexOf("620\nEuro")).toBeLessThan(seiten[16].indexOf("Vertragsunterlagen"));
    expect(seiten.filter((s) => s.includes("Vertragsunterlagen"))).toHaveLength(5);
  });

  it("Entrümpelung: nur eine Seite mit Vertragsunterlagen, Beträge in ihrem Text zählen nicht", () => {
    const preis = TEXT.split("\f")[13];
    const agb = "Allgemeine Geschäftsbedingungen (AGB)\nStornogebühr 50,00 € je angefangene Stunde, Haftung bis 620 €.\nVertragsunterlagen\nAllgemeine\nGeschäftsbedingungen.";
    expect(vpsPreisPruefung([preis, agb].join("\f"), betreage())).toEqual({ preis: "ok", fehlt: [], fremd: [] });
  });

  it("zählt auch ganze Euro als Betrag, aber keine Euro-Paletten", () => {
    const preis = TEXT.split("\f")[13];
    expect(vpsPreisPruefung(`${preis}\nRabatt 100 € auf den Transport`, betreage())).toEqual({
      preis: "abweichung",
      fehlt: [],
      fremd: [10000],
    });
    expect(vpsPreisPruefung(`${preis}\nWir bringen 4 Euro-Paletten mit.`, betreage()).preis).toBe("ok");
  });
});

describe("V2: Freigabe je Leistungsart (Entrümpelung)", () => {
  function entruempelung(): VpsPaketTeile {
    const p = teile();
    p.details.serviceType = "clearance";
    return p;
  }

  it("bietet bei clearance kein Ziel, keine Demontage oder Montage und keine Leistungen an", () => {
    const p = entruempelung();
    const basis = vpsBasis(p, kvFelderVpsGeprueft(p.details.serviceType));
    const s = basis.felder.map((f) => f.schluessel);
    expect(s).not.toContain("uebersicht:einzug:details");
    expect(s.some((x) => x.endsWith(":demontage") || x.endsWith(":montage"))).toBe(false);
    expect(s.some((x) => x.startsWith("leistungen:"))).toBe(false);
    expect(s).toContain("uebersicht:auszug:details");
    expect(s).toContain("umzugsgut:inv-sofa:notiz");
    expect(s).toContain("vereinbarungen:text:text");
    // Die ausgelassenen Schlüssel des Pakets stehen für das Mitwandern bereit.
    expect(basis.nichtFreigegeben).toEqual(
      expect.arrayContaining(["uebersicht:einzug:details", "umzugsgut:inv-sofa:demontage", "umzugsgut:inv-sofa:montage", "leistungen:transport:zustaendig"])
    );
  });

  it("beschriftet bei clearance Einsatzort und Umfang, beim Umzug wie bisher", () => {
    const label = (b: KvBasis, s: string) => b.felder.find((f) => f.schluessel === s)?.label;
    const p = entruempelung();
    const e = vpsBasis(p, kvFelderVpsGeprueft("clearance"));
    expect(label(e, "uebersicht:auszug:details")).toBe("Einsatzort, Hinweis");
    expect(label(e, "uebersicht:umzugsgut:text")).toBe("Umfang");
    const u = vpsBasis(teile(), kvFelderVpsGeprueft("move"));
    expect(label(u, "uebersicht:auszug:details")).toBe("Auszug, Hinweis");
    expect(label(u, "uebersicht:einzug:details")).toBe("Einzug, Hinweis");
    expect(label(u, "uebersicht:umzugsgut:text")).toBe("Umzugsgut");
    // Mit allen Mustern hat der Umzug keine ausgelassenen Schlüssel.
    expect(vpsBasis(teile(), ALLE_MUSTER).nichtFreigegeben).toBeUndefined();
  });

  it("Umzug bietet die V2-Notizen an (Auspacken, Halteverbot Einzug)", () => {
    const s = vpsBasis(teile(), kvFelderVpsGeprueft("move")).felder.map((f) => f.schluessel);
    expect(s).toContain("leistungen:unpacking:notiz");
    expect(s).toContain("leistungen:parkingDestination:notiz");
  });

  it("gespeicherte Änderungen an nicht freigegebenen Schlüsseln wandern als nicht_erlaubt mit", () => {
    const umzug = vpsBasis(teile(), kvFelderVpsGeprueft("move"));
    const einzug = aend("uebersicht:einzug:details", "Schlüssel beim Nachbarn", umzug.felder.find((f) => f.schluessel === "uebersicht:einzug:details")!.basis);
    const montage = aend("umzugsgut:inv-kleiderschrank:montage", "customer", "company");
    const notiz = aend("umzugsgut:inv-sofa:notiz", "Sofa vorher zerlegen", "Auf Foto erkannt, im Chat nicht erwähnt");
    const weg = aend("umzugsgut:inv-weg:raum", "Keller", "Flur");
    const offenAlt: KvKonflikt = {
      aenderung: aend("umzugsgut:inv-bett:demontage", "customer", "company"),
      art: "basis_geaendert",
      basisJetzt: "none",
      status: "offen",
    };

    // Der Deal wechselt auf Entrümpelung: der nächste Stand gleicht gegen den neuen Katalog ab.
    const p = entruempelung();
    const neu = vpsBasis(p, kvFelderVpsGeprueft(p.details.serviceType));
    const aus = abgleichen(neu, [einzug, montage, notiz, weg], [offenAlt]);
    expect(aus.liste).toEqual([notiz]);
    expect(aus.konflikte).toEqual([
      { aenderung: einzug, art: "nicht_erlaubt", basisJetzt: null, status: "offen" },
      { aenderung: montage, art: "nicht_erlaubt", basisJetzt: null, status: "offen" },
      { aenderung: weg, art: "ziel_fehlt", basisJetzt: null, status: "offen" },
      { aenderung: offenAlt.aenderung, art: "nicht_erlaubt", basisJetzt: null, status: "offen" },
    ]);
    // Angewendet wird nur die Liste: Ziel und Montage bleiben im Paket unverändert.
    const angewendet = vpsAnwenden(p, aus.liste);
    expect(angewendet.details.to).toEqual(p.details.to);
    expect(angewendet.details.inventory?.[0]).toEqual(p.details.inventory?.[0]);
  });
});

describe("V2: Stunden-KV, Preisprüfung am echten Druck", () => {
  // Anonymisierter Druck aus der VPS-Feldprüfung V2 (stunden-1, erfundener Kunde „Test Feldpruefung“).
  const STUNDEN = readFileSync(new URL("./__fixtures__/kv-text-stunden.txt", import.meta.url), "utf8");
  const preise = {
    modell: "stundensatz",
    helfer_anzahl: 2,
    stunden_geschaetzt: 4,
    mindest_stunden: 3,
    stundensatz_helfer_eur: 39,
    stundensatz_transporter_eur: 29,
    anzahlung_betrag_eur: 100,
    anzahlung_zahlungsweg: "bank_transfer",
  };
  const betraege = () => vpsErwarteteBetraege(preise, { gesamtCent: 42800, bezahltCent: 0 });

  it("erwartet Teamsatz und Zeilen statt des Helfersatzes, erlaubt den Mindestbetrag", () => {
    expect(betraege()).toEqual({
      // Transportersatz 29, Teamsatz 2 × 39, Anzahlung, Zeile Transporter 4 × 29, Zeile Team 4 × 78, Gesamt.
      erwartetCent: [2900, 7800, 10000, 11600, 31200, 42800],
      // 0, bezahlt 0, Rest nach Anzahlung 328, Mindestbetrag 3 × (78 + 29) = 321, Gesamt.
      erlaubtCent: [0, 10000, 32100, 32800, 42800],
    });
  });

  it("der echte Druck ergibt ok", () => {
    expect(STUNDEN).toContain("Umzugsteam (2 Helfer)");
    expect(STUNDEN).toContain("Vertragsunterlagen");
    expect(vpsPreisPruefung(STUNDEN, betraege())).toEqual({ preis: "ok", fehlt: [], fremd: [] });
  });

  it("ein anderer Satz im Druck bleibt eine Abweichung", () => {
    const text = STUNDEN.replace("78,00 €", "80,00 €").replace("312,00 €", "320,00 €");
    expect(vpsPreisPruefung(text, betraege())).toEqual({ preis: "abweichung", fehlt: [7800, 31200], fremd: [8000, 32000] });
  });

  it("Stunden unter dem Minimum zählen mit den Mindeststunden; halbe Stunden runden auf Cent", () => {
    const aus = vpsErwarteteBetraege(
      { modell: "stundensatz", helfer_anzahl: 3, stunden_geschaetzt: 7.5, mindest_stunden: 3, stundensatz_helfer_eur: 35, stundensatz_transporter_eur: 25 },
      { gesamtCent: 97500, bezahltCent: 0 }
    );
    expect(aus.erwartetCent).toEqual([2500, 10500, 18750, 78750, 97500]);
    expect(aus.erlaubtCent).toEqual([0, 39000, 97500]);
    const unter = vpsErwarteteBetraege(
      { modell: "stundensatz", helfer_anzahl: 1, stunden_geschaetzt: 2, mindest_stunden: 3, stundensatz_helfer_eur: 40, stundensatz_transporter_eur: 20 },
      { gesamtCent: null, bezahltCent: 0 }
    );
    expect(unter.erwartetCent).toEqual([2000, 4000, 6000, 12000]);
  });
});
