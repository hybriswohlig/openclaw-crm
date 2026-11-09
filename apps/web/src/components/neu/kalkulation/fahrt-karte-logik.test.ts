import { describe, expect, it } from "vitest";
import { fahrtAnsicht } from "@/lib/kalkulation-annahmen";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { fahrtGoogleLink, fahrtLinien } from "./fahrt-karte-logik";
import type { Teilstrecke } from "./route-karte";

/** Google-Polyline kodieren (für Testdaten). */
function kodiere(punkte: [number, number][]): string {
  let alt = [0, 0];
  let aus = "";
  const zahl = (n: number) => {
    let v = n < 0 ? ~(n << 1) : n << 1;
    let s = "";
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lng, lat] of punkte) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    aus += zahl(la - alt[0]) + zahl(ln - alt[1]);
    alt = [la, ln];
  }
  return aus;
}

const S: [number, number] = [9.0, 48.7];
const B: [number, number] = [9.2, 48.8];
const E: [number, number] = [9.3, 48.75];
const teil = (von: string, nach: string, punkte: [number, number][], haupt = false): Teilstrecke => ({ von, nach, km: 1, minuten: 1, polyline: kodiere(punkte), haupt });
const route = [teil("Station", "Beladen", [S, B]), teil("Beladen", "Entladen", [B, [9.25, 48.79], E], true), teil("Entladen", "Station", [E, S])];

const ergebnis = (quelle: "google" | "angenommen"): RechnerErgebnis => ({
  team: { groesse: 5, quelle: "staffel" },
  kosten: { selbstkosten: 1, personalStunden: { arbeitPm: 1, fahrerPm: 0, fahrzeitPm: 1, pufferProzent: 10, personenH: 1 } },
  fahrtAufschluesselung: {
    anfahrt: { km: 20, min: 30, quelle },
    strecke: { km: 15, min: 25, quelle },
    rueckfahrt: { km: 20, min: 30, quelle },
    fahrten: 2,
    wege: 3,
    fahrtMin: 135,
  },
});

describe("fahrtLinien (Bauteil 12)", () => {
  it("mit Route: eigene Linie je Strecke, Rückweg ist die Hauptstrecke rückwärts", () => {
    const f = fahrtAnsicht(ergebnis("google"), { von_adresse: "Hauptstr. 1, 70372 Stuttgart", nach_adresse: "Am Bach 2, 71032 Böblingen" })!;
    const l = fahrtLinien(f.strecken, route);
    expect(l.map((x) => [x.key, x.gestrichelt])).toEqual([
      ["anfahrt", false],
      ["tour.1", false],
      ["rueckweg.1", false],
      ["tour.2", false],
      ["rueckfahrt", false],
    ]);
    expect(l[2].punkte[0][0]).toBeCloseTo(E[0], 4);
    expect(new Set(l.map((x) => x.farbe)).size).toBe(4);
  });

  it("nur geschätzt: gestrichelte Geraden zwischen bekannten Punkten, Hinweis im Label", () => {
    const f = fahrtAnsicht(ergebnis("angenommen"), {})!;
    const l = fahrtLinien(f.strecken, route);
    expect(l.every((x) => x.gestrichelt && x.punkte.length === 2)).toBe(true);
    expect(l[0].label).toBe("Anfahrt: Station → Beladen · geschätzt, keine Route");
  });

  it("ohne Route und ohne Punkte: keine Linien", () => {
    const f = fahrtAnsicht(ergebnis("angenommen"), {})!;
    expect(fahrtLinien(f.strecken, [])).toEqual([]);
  });
});

describe("fahrtGoogleLink", () => {
  it("alle Wegpunkte in Fahrreihenfolge", () => {
    const link = fahrtGoogleLink({ station: "S 1, 71229 Leonberg", beladen: "70372 Stuttgart", entladen: "71032 Böblingen" }, 2)!;
    const u = new URL(link);
    expect(u.searchParams.get("waypoints")).toBe("70372 Stuttgart|71032 Böblingen|70372 Stuttgart|71032 Böblingen");
    expect(u.searchParams.get("origin")).toBe("S 1, 71229 Leonberg");
    expect(fahrtGoogleLink({ station: null, beladen: "x", entladen: null }, 1)).toBeNull();
  });
});
