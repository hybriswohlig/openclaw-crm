import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { verwaisteZeilenUebersteuerungen } from "@/lib/angebot-wahl";
import { verwaistMitNamen, type AnpassungAnsicht, type VerwaistAnsicht } from "@/lib/kalkulations-ansicht";
import { ALT, KLASSE, NEU, UUID, uuidVersion } from "@/lib/kalkulations-ansicht-verwaist.fixture";
import { ohneVerwaiste, uebertragbar, uebertragenEingaben, verwaistHinweis, verwerfenEingaben } from "./verwaist-logik";
import { VerwaisteAnpassungen } from "./verwaiste-anpassungen";

// Vitest übersetzt JSX klassisch (React.createElement): React global bereitstellen.
(globalThis as { React?: typeof React }).React = React;

// Echte Rechner-Schlüssel mit UUIDs (Review Focus 5a-5); Namen kommen aus der Ansicht.
const v = uuidVersion();
const [EIN] = verwaistMitNamen(verwaisteZeilenUebersteuerungen(v.overrides, v.rechnerResult?.kosten?.posten ?? []), v);
const ZWEITER = `fahrzeug.${KLASSE}@0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e.miete`;
const MEHR: VerwaistAnsicht = {
  ...EIN,
  kandidaten: [NEU, ZWEITER],
  kandidatenText: ["Sprinter L, Miete an Sixt Feuerbach", "Sprinter L, Miete an Sixt Feuerbach"],
  kandidatenStation: ["Sixt Feuerbach", "Sixt Feuerbach"],
};
const KEIN: VerwaistAnsicht = { ...EIN, kandidaten: [], kandidatenText: [], kandidatenStation: [] };

const ANPASSUNG: AnpassungAnsicht = {
  id: EIN.id,
  art: "zeile",
  key: ALT,
  text: "Sprinter L, Miete an einer früheren Station: 120 € (wirkt nicht, die Zeile gibt es nach dem Neurechnen nicht mehr)",
  wert: 120,
  von: "Dario",
  am: "05.11. 11:00",
  grund: "Angebot Sixt",
};
const ANDERE: AnpassungAnsicht = { ...ANPASSUNG, id: "u2", key: "personal.arbeit", text: "Arbeit: 900 €", wert: 900 };

describe("verwaiste Fahrzeug-Anpassung (Entscheidung 5a-9)", () => {
  it("die Ansicht liefert lesbare Namen", () => {
    expect(EIN.text).toBe("Sprinter L, Miete an einer früheren Station: 120 €");
    expect(EIN.kandidaten).toEqual([NEU]);
  });

  it("Übertragen nur bei genau einem Kandidaten und Zahlenwert", () => {
    expect(uebertragbar(EIN)).toBe(true);
    expect(uebertragbar(MEHR)).toBe(false);
    expect(uebertragbar(KEIN)).toBe(false);
    expect(uebertragbar({ ...EIN, wert: null })).toBe(false);
    expect(uebertragenEingaben(MEHR)).toEqual([]);
  });

  it("Übertragen: erst Kandidat mit gleichem Wert und „übertragen von früherer Station“, dann die alte löschen", () => {
    expect(uebertragenEingaben(EIN)).toEqual([
      { art: "zeile", key: NEU, wert: 120, grund: "übertragen von früherer Station" },
      { art: "zeile", key: ALT, wert: null, grund: "übertragen nach Sixt Feuerbach" },
    ]);
  });

  it("Verwerfen: nur löschen (wert null) mit Grund", () => {
    const [e] = verwerfenEingaben(EIN);
    expect(e).toMatchObject({ art: "zeile", key: ALT, wert: null });
    expect(e.grund.length).toBeGreaterThan(0);
  });

  it("Hinweis je Fall, ohne Gedankenstriche und ohne UUID", () => {
    expect(verwaistHinweis(EIN)).toContain("Übertragen setzt denselben Wert an Sixt Feuerbach.");
    expect(verwaistHinweis(MEHR)).toContain("mehrere Zeilen in Frage");
    expect(verwaistHinweis(KEIN)).toContain("keine passende Zeile");
    for (const x of [EIN, MEHR, KEIN]) {
      expect(verwaistHinweis(x)).not.toMatch(/[—–]/);
      expect(verwaistHinweis(x)).not.toMatch(UUID);
    }
    for (const e of [...uebertragenEingaben(EIN), ...verwerfenEingaben(EIN)]) expect(e.grund).not.toMatch(UUID);
  });

  it("Liste der Anpassungen ohne die verwaisten", () => {
    expect(ohneVerwaiste([ANPASSUNG, ANDERE], [EIN]).map((a) => a.id)).toEqual(["u2"]);
    expect(ohneVerwaiste([ANPASSUNG, ANDERE], [])).toHaveLength(2);
  });
});

describe("VerwaisteAnpassungen gerendert", () => {
  const rendern = (verwaist: VerwaistAnsicht[], bearbeitbar = true) =>
    renderToStaticMarkup(
      createElement(VerwaisteAnpassungen, {
        verwaist,
        anpassungen: [ANPASSUNG, ANDERE],
        kontext: { bearbeitbar, uebersteuern: vi.fn(async () => ({ ok: true as const })) },
        beschaeftigt: false,
        portalZiel: undefined,
      })
    );

  it("goldene Zeile mit Übertragen und Verwerfen bei einem Kandidaten, nie eine UUID", () => {
    const html = rendern([EIN]);
    expect(html).toContain('class="kalk-verwaist" data-ton="gold"');
    expect(html).toContain("Sprinter L, Miete an einer früheren Station: 120 €");
    expect(html).toContain("Dario · 05.11. 11:00 · „Angebot Sixt“");
    expect(html).toContain(">Übertragen<");
    expect(html).toContain(">Verwerfen<");
    expect(html).not.toMatch(UUID);
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
