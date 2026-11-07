import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PLAN5_FEHLER_TEXT } from "@/lib/angebot-wahl";
import { PAKETE_5B, STUNDEN_5B, TAGE_5B, weberAnsicht5b, type Variante5b } from "@/lib/kalkulations-ansicht-5b.fixture";
import type { KalkKontext } from "./kalk-seite";
import { KernWarnung } from "./kern-warnung";
import { MargeSpalte } from "./marge-spalte";
import { PaketPreise, PreismodusWahl, TagePreise } from "./paket-preise";
import { tagespreiseKnopf } from "./preis-logik";
import { SperrenBereich } from "./sperren-bereich";
import { StundenBlock } from "./stunden-ansicht";

// Vitest übersetzt JSX klassisch (React.createElement): React global bereitstellen.
(globalThis as { React?: typeof React }).React = React;

const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ");

function kontext(felder: Partial<KalkKontext> = {}): KalkKontext {
  return {
    dealId: "deal_weber",
    versionNr: 2,
    bearbeitbar: true,
    laeuft: null,
    uebersteuern: vi.fn(async () => ({ ok: true as const })),
    neuLaden: vi.fn(async () => {}),
    neueVersion: vi.fn(async () => {}),
    neuRechnen: vi.fn(async () => {}),
    wechsleVersion: vi.fn(),
    setzeLauf: vi.fn(),
    ausstehend: false,
    setzeAusstehend: vi.fn(),
    ...felder,
  };
}

const spalte = (v: Variante5b) => html(createElement(MargeSpalte, { ansicht: weberAnsicht5b(v), kontext: kontext() }));

describe("PaketPreise", () => {
  const h = html(createElement(PaketPreise, { pakete: PAKETE_5B, beschaeftigt: false, onPreis: vi.fn() }));

  it("je Paket wirksamer Preis, Leistungen und Knopf", () => {
    const t = text(h);
    expect(t).toContain("Basis 1.990 € Anpassen");
    expect(t).toContain("nur Kern");
    expect(t).toContain("Komfort 2.390 € Anpassen");
    expect(t).toContain("Kern + Halteverbot, Montage");
    expect(t).toContain("Kern + Halteverbot, Montage, Einpacken, Küche");
  });

  it("Anpassung gold mit Rechnerpreis und Grund", () => {
    expect(h).toMatch(/<li class="kalk-pz" data-uebersteuert="">/);
    expect(text(h)).toContain("Rechner 2.480 €, angepasst: „Stammkunde, Preis vom Telefonat“");
  });

  it("Paket ohne Preis: „kein Preis“ und „Eintragen“", () => {
    expect(text(h)).toContain("Einzeltransport kein Preis Eintragen");
    expect(h).toContain('aria-label="Einzeltransport: Preis eintragen"');
  });

  it("kleiner Kern im Paket als Warnung", () => {
    expect(text(h)).toContain("Erster Posten nur 44 % des Preises");
  });

  it("Nicht-Basis-Paket ohne Hebel zeigt, warum es sperrt", () => {
    const ohne = html(createElement(PaketPreise, { pakete: [{ ...PAKETE_5B[1], hebel: [] }], beschaeftigt: false, onPreis: vi.fn() }));
    expect(text(ohne)).toContain("Keine Leistungen hinterlegt");
  });

  it("während eines Laufs alle Knöpfe gesperrt; ohne Pakete nichts", () => {
    const b = html(createElement(PaketPreise, { pakete: PAKETE_5B, beschaeftigt: true, onPreis: vi.fn() }));
    expect(b.match(/disabled=""/g)?.length).toBe(PAKETE_5B.length);
    expect(html(createElement(PaketPreise, { pakete: [], beschaeftigt: false, onPreis: vi.fn() }))).toBe("");
  });
});

describe("TagePreise und PreismodusWahl", () => {
  it("Tage mit Preis, Empfehlung und Anpassung", () => {
    const t = text(html(createElement(TagePreise, { tage: TAGE_5B })));
    expect(t).toContain("Fr 20.11. 2.460 €");
    expect(t).toContain("Sa 21.11. empfohlen 2.480 €");
    expect(t).toContain("Rechner 2.580 €, angepasst: „Samstag wie Freitag angeboten“");
    expect(t).toContain("ab 8 Uhr · Kunde bevorzugt Samstag");
  });

  it("mit Paketen: je Tag der Preis des empfohlenen Pakets, die anderen darunter, Anpassung des Pakets am Tag", () => {
    const pakete = PAKETE_5B.map((p) => ({ ...p, empfohlen: p.slug === "komfort" }));
    const tage = TAGE_5B.map((t, i) => (i === 0 ? { ...t, paketUebersteuert: { komfort: { betragCent: 237000, grund: "Freitag knapp" } } } : t));
    const t = text(html(createElement(TagePreise, { tage, pakete })));
    expect(t).toContain("Fr 20.11. Komfort 2.370 €");
    expect(t).toContain("angepasst: „Freitag knapp“");
    expect(t).toContain("Basis 1.970 € · Premium 2.870 €");
    // Der Tageshauptpreis ohne Paket (2.460 €) erscheint nicht: kein Kunde mit Paket sieht ihn.
    expect(t).not.toContain("2.460 €");
    // Die Tagesanpassung ohne Paket gilt hier nicht als Anpassung der Zeile.
    expect(t).not.toContain("Samstag wie Freitag angeboten");
  });

  it("Preismodus: aktiver Modus gedrückt", () => {
    const h = html(createElement(PreismodusWahl, { modus: "stunden", beschaeftigt: false, onPreis: vi.fn() }));
    expect(h).toMatch(/aria-pressed="false"[^>]*>Festpreis/);
    expect(h).toMatch(/aria-pressed="true"[^>]*>Stunden-KV/);
  });
});

describe("KernWarnung", () => {
  it("klein: Knopf „Als ein Posten zeigen“", () => {
    const h = html(createElement(KernWarnung, { kern: { art: "klein", anteil: 0.38 }, kvDarstellung: "posten", beschaeftigt: false, onPreis: vi.fn() }));
    expect(h).toContain('data-ton="gold"');
    expect(text(h)).toContain("Als ein Posten zeigen");
  });

  it("negativ: Text des Vertrags ohne Knopf", () => {
    const h = html(createElement(KernWarnung, { kern: { art: "negativ" }, kvDarstellung: "posten", beschaeftigt: false, onPreis: vi.fn() }));
    expect(text(h)).toContain(PLAN5_FEHLER_TEXT.KERN_NEGATIV);
    expect(h).not.toContain("<button");
  });

  it("ok: nichts", () => {
    expect(html(createElement(KernWarnung, { kern: { art: "ok" }, kvDarstellung: "posten", beschaeftigt: false, onPreis: vi.fn() }))).toBe("");
  });
});

describe("StundenBlock", () => {
  it("Helfer, Transporter, Stunden, Mindeststunden, Schätzung und Kundentext", () => {
    const t = text(html(createElement(StundenBlock, { stunden: STUNDEN_5B })));
    expect(t).toContain("3 Helfer 35 €/h");
    expect(t).toContain("1 Transporter 25 €/h");
    expect(t).toContain("Stunden geschätzt 7,5 h");
    expect(t).toContain("Mindeststunden 3 h");
    expect(t).toContain("Schätzung 985 €");
    expect(t).toContain("voraussichtlich 985 €, abgerechnet nach Aufwand, mindestens 3 Stunden (390 €)");
  });

  it("ohne Rechner-Stunden: Hinweis auf die Rechner-Einstellungen", () => {
    expect(text(html(createElement(StundenBlock, { stunden: null })))).toContain("keine Stundensätze");
  });
});

describe("SperrenBereich: Tagespreise im Termin-Dialog", () => {
  const version = weberAnsicht5b("pakete").version;
  const render = (tagespreise: { aktiv: boolean; hinweis: string | null }, laeuft: "sperren" | null = null) =>
    html(
      createElement(SperrenBereich, {
        dealId: "deal_weber",
        version,
        laeuft,
        onSperren: vi.fn(),
        onKv: vi.fn(),
        onNeueVersion: vi.fn(),
        onNeuRechnen: vi.fn(),
        tagespreise,
        onTagespreise: vi.fn(),
      })
    );

  it("mit Schalter aktiv, ohne Hinweis „kommt mit Plan 5“", () => {
    const h = render(tagespreiseKnopf({ angebotAusKalkulation: true, tagespreise: true }, version));
    expect(h).toMatch(/<button type="button" class="kalk-knopf" data-geist="">Tagespreise im Termin-Dialog/);
    expect(h).not.toContain("Plan 5");
  });

  it("ohne Schalter deaktiviert mit Hinweis", () => {
    const h = render(tagespreiseKnopf({ angebotAusKalkulation: true, tagespreise: false }, version));
    expect(h).toMatch(/data-geist="" disabled="">Tagespreise im Termin-Dialog/);
    expect(text(h)).toContain("Tagespreise sind für diese Firma aus.");
  });

  it("während eines Laufs deaktiviert", () => {
    const h = render({ aktiv: true, hinweis: null }, "sperren");
    expect(h).toMatch(/data-geist="" disabled="">Tagespreise im Termin-Dialog/);
  });

  it("Sperrgrund kommt unverändert vom Dienst", () => {
    const v = weberAnsicht5b("kern_negativ").version;
    const h = html(
      createElement(SperrenBereich, { dealId: "d", version: v, laeuft: null, onSperren: vi.fn(), onKv: vi.fn(), onNeueVersion: vi.fn(), onNeuRechnen: vi.fn() })
    );
    expect(text(h)).toContain(PLAN5_FEHLER_TEXT.KERN_NEGATIV);
  });
});

describe("MargeSpalte je Variante", () => {
  it("Schalter aus: wie vor 5b (kein Preismodus, keine Paketpreis-Knöpfe, Tagespreise aus)", () => {
    const h = spalte("aus");
    expect(h).not.toContain('aria-label="Preismodus"');
    expect(h).not.toContain("kalk-pz");
    expect(h).not.toContain("kalk-kern");
    expect(text(h)).toContain("Tagespreise sind für diese Firma aus.");
  });

  it("Pakete: Preismodus, Paketpreise, Tage und aktiver Tagespreis-Knopf", () => {
    const h = spalte("pakete");
    expect(h).toContain('aria-label="Preismodus"');
    expect(h).toContain('aria-label="Paketpreise"');
    expect(h).toContain('aria-label="Angebotene Tage"');
    expect(h).toMatch(/<button type="button" class="kalk-knopf" data-geist="">Tagespreise im Termin-Dialog/);
    expect(h).not.toContain("Angebotsformular öffnen");
  });

  it("kleiner Kern: Warnung unter dem KV", () => {
    expect(text(spalte("kern_klein"))).toContain("Als ein Posten zeigen");
  });

  it("als ein Posten: „Wieder einzeln zeigen“", () => {
    expect(text(spalte("ein_posten"))).toContain("Wieder einzeln zeigen");
  });

  it("Stunden: Stunden-KV statt Paketpreisen, kein Tagespreis-Knopf", () => {
    const h = spalte("stunden");
    expect(text(h)).toContain("Stunden-KV");
    expect(text(h)).toContain("voraussichtlich 985 €");
    expect(h).not.toContain('aria-label="Paketpreise"');
    expect(h).toMatch(/data-geist="" disabled="">Tagespreise im Termin-Dialog/);
  });

  it("Stunden (Entscheidung 7): kein Marge-Regler, keine Festpreis-Formel, keine Posten-Vorschau", () => {
    const h = spalte("stunden");
    expect(h).not.toContain('aria-label="Gründe des Vorschlags"');
    expect(h).not.toContain("kalk-preis");
    expect(text(h)).not.toContain("So steht es im KV");
    expect(text(h)).not.toContain("Gewinn");
    expect(h).toContain('aria-label="Preismodus"');
    expect(h).toContain('aria-label="Stunden-KV"');
    // Festpreis-Modus derselben Firma zeigt den Block weiter.
    const fest = spalte("pakete");
    expect(fest).toContain("kalk-preis");
    expect(text(fest)).toContain("So steht es im KV");
  });

  it("ohne Schalter bleibt der Festpreis-Block auch bei einer Stunden-Quotation (wie vor 5b)", () => {
    const a = weberAnsicht5b("aus");
    const h = html(createElement(MargeSpalte, { ansicht: { ...a, version: { ...a.version, preisModus: "stunden" } }, kontext: kontext() }));
    expect(h).toContain("kalk-preis");
    expect(h).toContain('aria-label="Gründe des Vorschlags"');
  });

  it("Kern negativ: Sperrgrund statt Sperrknopf", () => {
    const h = spalte("kern_negativ");
    expect(h).not.toContain("sperren und KV erstellen");
    expect(text(h)).toContain(PLAN5_FEHLER_TEXT.KERN_NEGATIV);
  });
});
