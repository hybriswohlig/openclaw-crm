import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { VerwaisteUebersteuerung } from "@/lib/angebot-wahl";
import type { AnpassungAnsicht } from "@/lib/kalkulations-ansicht";
import {
  ohneVerwaiste,
  stationAus,
  stationText,
  uebertragbar,
  uebertragenEingaben,
  verwaistHinweis,
  verwaistText,
  verwerfenEingaben,
} from "./verwaist-logik";
import { VerwaisteAnpassungen } from "./verwaiste-anpassungen";

// Vitest übersetzt JSX klassisch (React.createElement): React global bereitstellen.
(globalThis as { React?: typeof React }).React = React;

// Echtes Schlüsselformat `fahrzeug.<klasse>@<station>.<teil>` (Review Focus 5a-5).
const ALT = "fahrzeug.sprinter_l@sixt_stuttgart.miete";
const NEU = "fahrzeug.sprinter_l@sixt_esslingen.miete";

const EIN: VerwaisteUebersteuerung = { id: "u1", key: ALT, kandidaten: [NEU] };
const MEHR: VerwaisteUebersteuerung = { id: "u1", key: ALT, kandidaten: [NEU, "fahrzeug.sprinter_l@europcar_fellbach.miete"] };
const KEIN: VerwaisteUebersteuerung = { id: "u1", key: ALT, kandidaten: [] };

const ANPASSUNG: AnpassungAnsicht = {
  id: "u1",
  art: "zeile",
  key: ALT,
  text: "Sprinter L: Miete: 120 € (wirkt nicht, die Zeile gibt es nach dem Neurechnen nicht mehr)",
  wert: 120,
  von: "Dario",
  am: "05.11. 11:00",
  grund: "Angebot Sixt",
};
const ANDERE: AnpassungAnsicht = { ...ANPASSUNG, id: "u2", key: "personal.arbeit", text: "Arbeit: 900 €", wert: 900 };

describe("verwaiste Fahrzeug-Anpassung (Entscheidung 5a-9)", () => {
  it("Station aus dem Schlüssel", () => {
    expect(stationAus(ALT)).toBe("sixt_stuttgart");
    expect(stationText(NEU)).toBe("sixt esslingen");
    expect(stationAus("personal.arbeit")).toBeNull();
  });

  it("Text ohne den Zusatz „wirkt nicht“; ohne Anpassung der Schlüssel", () => {
    expect(verwaistText(EIN, ANPASSUNG)).toBe("Sprinter L: Miete: 120 €");
    expect(verwaistText(EIN, undefined)).toBe("Sprinter L, Miete an sixt stuttgart");
    // Ohne Bezeichnung (Zeile weg) trägt der Text den Rohschlüssel: dann der lesbare Name.
    expect(verwaistText(EIN, { ...ANPASSUNG, text: `${ALT}: 120 € (wirkt nicht, die Zeile gibt es nach dem Neurechnen nicht mehr)` })).toBe(
      "Sprinter L, Miete an sixt stuttgart: 120 €"
    );
  });

  it("Übertragen nur bei genau einem Kandidaten und Zahlenwert", () => {
    expect(uebertragbar(EIN, ANPASSUNG)).toBe(true);
    expect(uebertragbar(MEHR, ANPASSUNG)).toBe(false);
    expect(uebertragbar(KEIN, ANPASSUNG)).toBe(false);
    expect(uebertragbar(EIN, undefined)).toBe(false);
    expect(uebertragenEingaben(MEHR, ANPASSUNG)).toEqual([]);
  });

  it("Übertragen: erst Kandidat mit gleichem Wert und Grund „übertragen von {Station}“, dann die alte löschen", () => {
    expect(uebertragenEingaben(EIN, ANPASSUNG)).toEqual([
      { art: "zeile", key: NEU, wert: 120, grund: "übertragen von sixt stuttgart" },
      { art: "zeile", key: ALT, wert: null, grund: "übertragen nach sixt esslingen" },
    ]);
  });

  it("Verwerfen: nur löschen (wert null) mit Grund", () => {
    const [e] = verwerfenEingaben(EIN);
    expect(e).toMatchObject({ art: "zeile", key: ALT, wert: null });
    expect(e.grund.length).toBeGreaterThan(0);
  });

  it("Hinweis je Fall, ohne Gedankenstriche", () => {
    expect(verwaistHinweis(EIN, ANPASSUNG)).toContain("Übertragen setzt denselben Wert an sixt esslingen.");
    expect(verwaistHinweis(MEHR, ANPASSUNG)).toContain("mehrere Stationen in Frage (sixt esslingen, europcar fellbach)");
    expect(verwaistHinweis(KEIN, ANPASSUNG)).toContain("keine passende Zeile");
    for (const v of [EIN, MEHR, KEIN]) expect(verwaistHinweis(v, ANPASSUNG)).not.toMatch(/[—–]/);
  });

  it("Liste der Anpassungen ohne die verwaisten", () => {
    expect(ohneVerwaiste([ANPASSUNG, ANDERE], [EIN]).map((a) => a.id)).toEqual(["u2"]);
    expect(ohneVerwaiste([ANPASSUNG, ANDERE], [])).toHaveLength(2);
  });
});

describe("VerwaisteAnpassungen gerendert", () => {
  const rendern = (verwaist: VerwaisteUebersteuerung[], bearbeitbar = true) =>
    renderToStaticMarkup(
      createElement(VerwaisteAnpassungen, {
        verwaist,
        anpassungen: [ANPASSUNG, ANDERE],
        kontext: { bearbeitbar, uebersteuern: vi.fn(async () => ({ ok: true as const })) },
        beschaeftigt: false,
        portalZiel: undefined,
      })
    );

  it("goldene Zeile mit Übertragen und Verwerfen bei einem Kandidaten", () => {
    const html = rendern([EIN]);
    expect(html).toContain('class="kalk-verwaist" data-ton="gold"');
    expect(html).toContain("Sprinter L: Miete: 120 €");
    expect(html).toContain("Dario · 05.11. 11:00 · „Angebot Sixt“");
    expect(html).toContain(">Übertragen<");
    expect(html).toContain(">Verwerfen<");
  });

  it("mehrere Kandidaten: nur Verwerfen", () => {
    const html = rendern([MEHR]);
    expect(html).not.toContain(">Übertragen<");
    expect(html).toContain(">Verwerfen<");
  });

  it("nichts ohne verwaiste Anpassung oder bei gesperrter Version", () => {
    expect(rendern([])).toBe("");
    expect(rendern([EIN], false)).toBe("");
  });
});
