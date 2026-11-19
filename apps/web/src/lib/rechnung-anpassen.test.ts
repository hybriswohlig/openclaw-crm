import { describe, expect, it } from "vitest";
import {
  anpassungenFehler,
  anpassungenFuerVps,
  anpassungenSumme,
  anpassungZeilen,
  nachlassZuHoch,
  nachlassZuHochText,
  offenAus,
  prozentBetragCent,
  rechnungsPruefung,
  type RechnungAnpassung,
  type RechnungsPruefungEingabe,
} from "./geld";
import { parsePreviewBody, parseRechnungEingabe, parseRenderBody } from "./commercial-document-request";

/** Rechnung anpassen (19.11.): Nachlass und Aufschlag als eigene Zeile, Vertrag und Parser. */

const nachlass = (betragCent: number, extra: Partial<RechnungAnpassung> = {}): RechnungAnpassung => ({
  art: "nachlass",
  bezeichnung: "Nachlass wie vereinbart",
  betragCent,
  ...extra,
});
const aufschlag = (betragCent: number, extra: Partial<RechnungAnpassung> = {}): RechnungAnpassung => ({
  art: "aufschlag",
  bezeichnung: "Mehraufwand Kellerräumung",
  betragCent,
  ...extra,
});

describe("Anpassungszeilen", () => {
  it("Prozent kaufmännisch auf den Grundbetrag, Summe mit Vorzeichen", () => {
    expect(prozentBetragCent(90000, 10)).toBe(9000);
    expect(prozentBetragCent(12345, 3)).toBe(370); // 370,35 → 370
    expect(prozentBetragCent(150, 7.5)).toBe(11); // 11,25 → 11
    expect(prozentBetragCent(10, 5)).toBe(1); // 0,5 → 1
    expect(anpassungenSumme([nachlass(9000), aufschlag(4550)])).toBe(-4450);
    expect(anpassungenSumme(null)).toBe(0);
  });

  it("Zeilen für die Renderer: erst Nachlass, dann Aufschlag; VPS als Euro-Text mit Vorzeichen", () => {
    const liste = [aufschlag(4550), nachlass(9000, { bezeichnung: "  Nachlass   wie\nvereinbart " })];
    expect(anpassungZeilen(liste)).toEqual([
      { titel: "Nachlass wie vereinbart", cent: -9000 },
      { titel: "Mehraufwand Kellerräumung", cent: 4550 },
    ]);
    expect(anpassungenFuerVps(liste)).toEqual([
      { titel: "Nachlass wie vereinbart", betrag: "-90.00" },
      { titel: "Mehraufwand Kellerräumung", betrag: "45.50" },
    ]);
  });

  it("Prüfregeln: je Art höchstens eine Zeile, Bezeichnung, Betrag, Prozent passend, Rechnungsbetrag über 0", () => {
    expect(anpassungenFehler([], 90000)).toBeNull();
    expect(anpassungenFehler([nachlass(9000), aufschlag(100)], 90000)).toBeNull();
    expect(anpassungenFehler([nachlass(9000, { prozent: 10 })], 90000)).toBeNull();
    expect(anpassungenFehler([nachlass(9000), nachlass(100)], 90000)).toBe("ANPASSUNG_UNGUELTIG");
    expect(anpassungenFehler([nachlass(1), aufschlag(1), aufschlag(2)], 90000)).toBe("ANPASSUNG_UNGUELTIG");
    expect(anpassungenFehler([nachlass(9000, { bezeichnung: "ab" })], 90000)).toBe("ANPASSUNG_UNGUELTIG");
    expect(anpassungenFehler([nachlass(9000, { bezeichnung: "x".repeat(81) })], 90000)).toBe("ANPASSUNG_UNGUELTIG");
    expect(anpassungenFehler([nachlass(0)], 90000)).toBe("ANPASSUNG_UNGUELTIG");
    expect(anpassungenFehler([nachlass(10.5)], 90000)).toBe("ANPASSUNG_UNGUELTIG");
    expect(anpassungenFehler([nachlass(9001, { prozent: 10 })], 90000)).toBe("ANPASSUNG_UNGUELTIG");
    expect(anpassungenFehler([nachlass(9000, { prozent: 10.001 })], 90000)).toBe("ANPASSUNG_UNGUELTIG");
    expect(anpassungenFehler([nachlass(90000, { prozent: 100 })], 90000)).toBe("BETRAG_FEHLT");
    expect(anpassungenFehler([nachlass(95000)], 90000)).toBe("BETRAG_FEHLT");
    expect(anpassungenFehler([{ art: "rabatt" as never, bezeichnung: "Rabatt", betragCent: 1 }], 90000)).toBe("ANPASSUNG_UNGUELTIG");
  });
});

describe("rechnungsPruefung mit Nachlass und Aufschlag", () => {
  const basis: RechnungsPruefungEingabe = {
    firmaId: "oc",
    aktiveRechnung: false,
    istStunden: false,
    annahmeCent: 90000,
    festpreisCent: 90000,
    pdfBetragCent: 81000,
    eingabe: { bruttoCent: 81000, abweichungGrund: "Am Telefon zugesagt", anpassungen: [nachlass(9000)] },
    durchAgent: false,
  };

  it("Festpreis: Rechnungsbetrag = PDF-Betrag mit Zeile, Grund gespeichert", () => {
    expect(rechnungsPruefung(basis)).toEqual({ ok: true, bruttoCent: 81000, abweichungGrund: "Am Telefon zugesagt" });
    // ohne Annahme (mündlich, Altbestand) ebenso nur mit Grund
    expect(rechnungsPruefung({ ...basis, annahmeCent: null })).toMatchObject({ ok: true, bruttoCent: 81000 });
  });

  it("Bots nie, ohne Grund nie, Dialog-Betrag anders als PDF nie", () => {
    expect(rechnungsPruefung({ ...basis, durchAgent: true })).toEqual({ ok: false, code: "NUR_MENSCH" });
    expect(rechnungsPruefung({ ...basis, annahmeCent: null, durchAgent: true })).toEqual({ ok: false, code: "NUR_MENSCH" });
    expect(rechnungsPruefung({ ...basis, eingabe: { ...basis.eingabe!, abweichungGrund: "kurz" } })).toEqual({ ok: false, code: "GRUND_FEHLT" });
    expect(rechnungsPruefung({ ...basis, eingabe: { ...basis.eingabe!, bruttoCent: 90000 } })).toEqual({ ok: false, code: "RECHNUNG_PDF_ANDERS" });
  });

  it("Prozent passt nur zum Grundbetrag des PDFs; Upload ohne gedruckten Betrag kennt keine Zeilen", () => {
    const prozent = { ...basis, eingabe: { ...basis.eingabe!, anpassungen: [nachlass(9000, { prozent: 10 })] } };
    expect(rechnungsPruefung(prozent)).toMatchObject({ ok: true, bruttoCent: 81000 });
    const anderesPdf = { ...prozent, pdfBetragCent: 86000, eingabe: { ...prozent.eingabe, bruttoCent: 86000 } };
    expect(rechnungsPruefung(anderesPdf)).toEqual({ ok: false, code: "ANPASSUNG_UNGUELTIG" });
    expect(rechnungsPruefung({ ...basis, pdfBetragCent: null })).toEqual({ ok: false, code: "ANPASSUNG_UNGUELTIG" });
  });

  it("Stunden-KV: bestätigter Betrag ist der Rechnungsbetrag, Grundbetrag = Betrag minus Zeilen", () => {
    const stunden: RechnungsPruefungEingabe = {
      ...basis,
      istStunden: true,
      annahmeCent: null,
      festpreisCent: null,
      pdfBetragCent: null,
      eingabe: { bruttoCent: 128000, abweichungGrund: "Keller zusätzlich", anpassungen: [aufschlag(4655, { prozent: 3.77 })] },
    };
    // Grundbetrag 123.450 → 3,77 % = 4.654,07 → 4.654; 4.655 passt nicht
    expect(rechnungsPruefung(stunden)).toEqual({ ok: false, code: "ANPASSUNG_UNGUELTIG" });
    const passend = { ...stunden, eingabe: { ...stunden.eingabe!, bruttoCent: 128104, anpassungen: [aufschlag(4654, { prozent: 3.77 })] } };
    expect(rechnungsPruefung(passend)).toEqual({ ok: true, bruttoCent: 128104, abweichungGrund: "Keller zusätzlich" });
    expect(rechnungsPruefung({ ...passend, eingabe: { ...passend.eingabe, abweichungGrund: null } })).toEqual({ ok: false, code: "GRUND_FEHLT" });
  });

  it("Review Grok 1: Nachlass nie unter Anzahlung oder schon Gezahltes, Aufschlag allein nie gesperrt", () => {
    expect(rechnungsPruefung({ ...basis, anzahlungCent: 85000 })).toEqual({ ok: false, code: "NACHLASS_ZU_HOCH" });
    expect(rechnungsPruefung({ ...basis, bezahltCent: 81001 })).toEqual({ ok: false, code: "NACHLASS_ZU_HOCH" });
    expect(rechnungsPruefung({ ...basis, anzahlungCent: 81000, bezahltCent: 81000 })).toMatchObject({ ok: true });
    expect(nachlassZuHoch({ bruttoCent: 30000, anpassungen: [nachlass(60000)], anzahlungCent: 40000, bezahltCent: 0 })).toEqual({ grenzeCent: 40000, art: "anzahlung" });
    expect(nachlassZuHoch({ bruttoCent: 30000, anpassungen: [nachlass(60000)], anzahlungCent: 40000, bezahltCent: 50000 })).toEqual({ grenzeCent: 50000, art: "bezahlt" });
    expect(nachlassZuHoch({ bruttoCent: 30000, anpassungen: [aufschlag(100)], anzahlungCent: 40000, bezahltCent: 50000 })).toBeNull();
    expect(nachlassZuHochText({ grenzeCent: 50000, art: "bezahlt" }).replace(/\u00a0/g, " ")).toBe(
      "Nachlass zu hoch: Es sind schon 500,00 € angezahlt bzw. bezahlt. Bitte erst die Zahlung klären."
    );
    // Stunden ebenso
    const st: RechnungsPruefungEingabe = {
      ...basis, istStunden: true, pdfBetragCent: null, annahmeCent: null, festpreisCent: null, bezahltCent: 30000,
      eingabe: { bruttoCent: 21250, abweichungGrund: "Zugesagt", anpassungen: [nachlass(40000)] },
    };
    expect(rechnungsPruefung(st)).toEqual({ ok: false, code: "NACHLASS_ZU_HOCH" });
  });

  it("ohne Zeilen alles wie bisher", () => {
    const ohne = { ...basis, pdfBetragCent: 90000, eingabe: { bruttoCent: 90000 } };
    expect(rechnungsPruefung(ohne)).toEqual({ ok: true, bruttoCent: 90000, abweichungGrund: null });
    expect(rechnungsPruefung({ ...ohne, eingabe: { bruttoCent: 90000, anpassungen: [] } })).toEqual({ ok: true, bruttoCent: 90000, abweichungGrund: null });
  });

  it("Kasse, Übersicht und Erinnerung rechnen mit dem Rechnungsbetrag statt der Annahme", () => {
    const offen = offenAus({
      rechnung: { status: "gestellt", bruttoCent: 81000 },
      annahmeCent: 90000,
      festpreis: "900.00",
      istStunden: false,
      zahlungen: [{ amount: "100.00", taxTreatment: "standard" }],
    });
    expect(offen).toMatchObject({ gesamtCent: 81000, restCent: 71000, quelle: "rechnung" });
  });
});

describe("Parser: rechnung.anpassungen", () => {
  it("nimmt gültige Zeilen, kürzt die Bezeichnung auf eine Zeile", () => {
    const r = parseRechnungEingabe({
      bruttoCent: 81000,
      abweichungGrund: "Zugesagt",
      anpassungen: [{ art: "nachlass", bezeichnung: " Nachlass\n wie vereinbart ", betragCent: 9000, prozent: 10 }],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        bruttoCent: 81000,
        abweichungGrund: "Zugesagt",
        anpassungen: [{ art: "nachlass", bezeichnung: "Nachlass wie vereinbart", betragCent: 9000, prozent: 10 }],
      },
    });
    expect(parseRechnungEingabe({ bruttoCent: 1, anpassungen: [] })).toEqual({ ok: true, value: { bruttoCent: 1, abweichungGrund: null } });
  });

  it("lehnt falsche Typen ab", () => {
    for (const anpassungen of [
      "x",
      [{ art: "rabatt", bezeichnung: "a", betragCent: 1 }],
      [{ art: "nachlass", bezeichnung: 3, betragCent: 1 }],
      [{ art: "nachlass", bezeichnung: "abc", betragCent: -1 }],
      [{ art: "nachlass", bezeichnung: "abc", betragCent: 1.5 }],
      [{ art: "nachlass", bezeichnung: "abc", betragCent: 1, prozent: "10" }],
      [1, 2, 3],
    ]) {
      expect(parseRechnungEingabe({ anpassungen }).ok).toBe(false);
    }
  });

  it("Render und Vorschau reichen die Zeilen bei RE durch, KV und AB nie", () => {
    const rechnung = { bruttoCent: 81000, abweichungGrund: "Zugesagt", anpassungen: [{ art: "nachlass", bezeichnung: "Nachlass", betragCent: 9000 }] };
    const render = parseRenderBody({ renderer: "crm", documentType: "RE", rechnung });
    expect(render.ok && render.value.rechnung?.anpassungen).toHaveLength(1);
    const vorschau = parsePreviewBody({ documentType: "RE", rechnung });
    expect(vorschau.ok && vorschau.value.rechnung?.bruttoCent).toBe(81000);
    const kv = parsePreviewBody({ documentType: "KV", rechnung });
    expect(kv.ok && kv.value.rechnung).toBe(undefined);
    expect(parsePreviewBody({ documentType: "RE", rechnung: { anpassungen: "x" } }).ok).toBe(false);
  });
});
