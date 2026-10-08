import { describe, expect, it } from "vitest";
import {
  SCHILD_ABSTAND_PX,
  SCHILD_HOEHE_PX,
  SCHILD_SEITE_ABSTAND_PX,
  SCHILD_VERSATZ_PX,
  STAPEL_MITTE,
  STAPEL_RADIUS_PX,
  auswahlPlatz,
  schildRechteck,
  waehleSchildSeite,
  type Hindernis,
} from "./schild";

const BREITE = 140;

/** Cluster mit Zahl: Gewicht hoch, Radius wie die Cluster-Kreise plus Wartet-Punkt. */
function cluster(x: number, y: number, r = 20): Hindernis {
  return { x, y, r, gewicht: 3 };
}

function figur(x: number, y: number): Hindernis {
  return { x, y, r: 11, gewicht: 1 };
}

describe("schildRechteck", () => {
  it("liegt über, unter, rechts oder links vom Auswahlring, relativ zum Lead", () => {
    expect(schildRechteck("oben", BREITE)).toEqual({
      links: -70,
      rechts: 70,
      oben: -SCHILD_ABSTAND_PX - SCHILD_HOEHE_PX,
      unten: -SCHILD_ABSTAND_PX,
    });
    expect(schildRechteck("unten", BREITE)).toEqual({
      links: -70,
      rechts: 70,
      oben: SCHILD_ABSTAND_PX,
      unten: SCHILD_ABSTAND_PX + SCHILD_HOEHE_PX,
    });
    expect(schildRechteck("rechts", BREITE)).toEqual({
      links: SCHILD_SEITE_ABSTAND_PX,
      rechts: SCHILD_SEITE_ABSTAND_PX + BREITE,
      oben: -SCHILD_HOEHE_PX / 2,
      unten: SCHILD_HOEHE_PX / 2,
    });
    expect(schildRechteck("links", BREITE)).toEqual({
      links: -SCHILD_SEITE_ABSTAND_PX - BREITE,
      rechts: -SCHILD_SEITE_ABSTAND_PX,
      oben: -SCHILD_HOEHE_PX / 2,
      unten: SCHILD_HOEHE_PX / 2,
    });
  });

  it("schräg: über bzw. unter dem Ring, zur Seite versetzt", () => {
    expect(schildRechteck("unten-rechts", BREITE)).toEqual({
      links: -SCHILD_VERSATZ_PX,
      rechts: -SCHILD_VERSATZ_PX + BREITE,
      oben: SCHILD_ABSTAND_PX,
      unten: SCHILD_ABSTAND_PX + SCHILD_HOEHE_PX,
    });
    expect(schildRechteck("oben-links", BREITE)).toEqual({
      links: SCHILD_VERSATZ_PX - BREITE,
      rechts: SCHILD_VERSATZ_PX,
      oben: -SCHILD_ABSTAND_PX - SCHILD_HOEHE_PX,
      unten: -SCHILD_ABSTAND_PX,
    });
  });
});

describe("waehleSchildSeite", () => {
  it("bleibt oben, wenn dort nichts liegt", () => {
    expect(waehleSchildSeite([], BREITE)).toBe("oben");
    expect(waehleSchildSeite([cluster(0, 80), figur(-150, 0)], BREITE)).toBe("oben");
  });

  it("weicht einem Cluster über dem Lead aus (Zahl bleibt lesbar)", () => {
    // Wie im Review: Cluster „11“ links oberhalb, „20“ links unterhalb.
    const seite = waehleSchildSeite([cluster(-45, -38), cluster(-40, 30)], BREITE);
    expect(seite).toBe("rechts");
  });

  it("nimmt die Seite mit dem geringsten Schaden, Cluster wiegen mehr als einzelne Figuren", () => {
    const hindernisse = [
      cluster(0, -40), // oben
      cluster(90, 0), // rechts
      cluster(-90, 0), // links
      figur(0, 36), // unten nur eine Figur
    ];
    expect(waehleSchildSeite(hindernisse, BREITE)).toBe("unten");
  });

  it("nimmt eine freie Schrägposition, bevor es eine Figur halb verdeckt", () => {
    // Nachgestellt aus dem Browser: Cluster links oben und links unten, eine
    // Figur rechts knapp unter der Mitte, eine Figur über dem Ring.
    const hindernisse = [cluster(-50, -50, 22), cluster(-42, 18, 22), figur(72, 12), figur(15, -58)];
    expect(waehleSchildSeite(hindernisse, 131)).toBe("unten-rechts");
  });

  it("vermeidet den Kartenrand", () => {
    // Lead 20 px unter der Oberkante: oben passt das Schild nicht hin.
    const grenze = { links: -600, oben: -20, rechts: 600, unten: 400 };
    expect(waehleSchildSeite([], BREITE, grenze)).toBe("rechts");
    // Zusätzlich rechts am Rand: links.
    expect(waehleSchildSeite([], BREITE, { ...grenze, rechts: 60 })).toBe("links");
  });

  it("ein Kreis, der das Rechteck nur knapp verfehlt, stört nicht", () => {
    // Rechteck oben endet bei y = -24; Kreis bei y = 0 mit r = 20 reicht bis -20.
    expect(waehleSchildSeite([cluster(0, 0, 20)], BREITE)).toBe("oben");
  });
});

describe("auswahlPlatz (Cluster unter dem Auswahlring)", () => {
  it("ohne Cluster unter dem Ring: kein Stapel, Seite wie waehleSchildSeite", () => {
    const platz = auswahlPlatz([{ x: -45, y: -38, r: 22, anzahl: 11 }], [], BREITE);
    expect(platz.stapel).toBeNull();
    expect(platz.seite).toBe(waehleSchildSeite([{ x: -45, y: -38, r: 22, gewicht: 3 }], BREITE));
  });

  it("Cluster mittig unter dem Ring: seine Zahl wird zur Plakette, er selbst blockiert keine Seite", () => {
    // Großer Cluster (r 28 inkl. Rand) direkt unter dem Lead würde sonst alle vier Seiten treffen.
    const platz = auswahlPlatz([{ x: 2, y: -3, r: 28, anzahl: 19 }], [], BREITE);
    expect(platz.stapel).toBe(19);
    expect(platz.seite).toBe("oben");
  });

  it("das Schild verdeckt die Plakette nicht", () => {
    // Oben und rechts belegt: links läge auf der Plakette (unten links am Ring), also unten.
    const platz = auswahlPlatz(
      [
        { x: 0, y: 0, r: 22, anzahl: 7 },
        { x: 0, y: -45, r: 22, anzahl: 5 },
        { x: 80, y: 0, r: 22, anzahl: 4 },
      ],
      [],
      BREITE,
    );
    expect(platz.stapel).toBe(7);
    expect(platz.seite).toBe("unten");
    // Kontrolle: die Plakette liegt wirklich im linken Rechteck.
    const links = schildRechteck("links", BREITE);
    expect(STAPEL_MITTE.x + STAPEL_RADIUS_PX).toBeGreaterThan(links.links);
    expect(STAPEL_MITTE.x - STAPEL_RADIUS_PX).toBeLessThan(links.rechts);
  });

  it("nimmt bei zwei Kandidaten den Cluster, der am nächsten an der Ringmitte liegt", () => {
    const platz = auswahlPlatz(
      [
        { x: 12, y: 6, r: 22, anzahl: 3 },
        { x: 1, y: 1, r: 22, anzahl: 20 },
      ],
      [],
      BREITE,
    );
    expect(platz.stapel).toBe(20);
  });
});
