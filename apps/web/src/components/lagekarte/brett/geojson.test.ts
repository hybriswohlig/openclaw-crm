import { describe, expect, it } from "vitest";
import { WERT_PLAUSIBEL_MAX_CENT, type Firma, type KartenOrt, type LeadPunkt } from "@/lib/lagekarte/typen";
import {
  auftraegeZuGeoJson,
  auftragsSaeulen,
  auswahlLinie,
  iconName,
  kreisAktivitaet,
  kreisHoeheM,
  leadsZuGeoJson,
  SAEULE_MIN_M,
  saeulenHoeheM,
} from "./geojson";
import { BW_GRENZEN, alleGrenzen, kernGrenzen } from "./kamera";

function ort(lat: number, lng: number, kreisAgs: string | null = "08111", plz: string | null = "70176"): KartenOrt {
  return { lat, lng, plz, ortsname: "Stuttgart-West", kreisAgs, genauigkeit: "plz", quelle: "abholadresse" };
}

const STUTTGART = ort(48.7718, 9.1686);
const BOEBLINGEN = ort(48.6902, 8.9705, "08115", "71034");
const TUEBINGEN = ort(48.5216, 9.0576, "08416", "72070");

function lead(teil: Partial<LeadPunkt> & { id: string }): LeadPunkt {
  return {
    nummer: null,
    name: `Lead ${teil.id}`,
    angelegtAm: "2026-10-01T08:00:00.000Z",
    umzugAm: null,
    firmaId: null,
    stufe: null,
    status: "kontakt",
    statusHinweis: null,
    zahlungOffen: false,
    ort: STUTTGART,
    ziel: null,
    wert: null,
    bezahltCent: 0,
    wartet: null,
    veraltet: false,
    emailUngelesen: 0,
    chats: [],
    kv: {
      angebotErstellt: false,
      angebotErstelltAm: null,
      linkAktiv: false,
      linkErstelltAm: null,
      linkAngesehenAnzahl: 0,
      linkZuletztAngesehen: null,
      angenommenAm: null,
      dokumentId: null,
      dokumentStand: "keins",
    },
    kiEntwurfWartet: false,
    telefon: null,
    ...teil,
  };
}

const FIRMEN: Firma[] = [
  { id: "firma-kottke", name: "Kottke-Umzüge", kurz: "K", farbe: "#1f3a5f" },
  { id: "firma-ceylan", name: "Ceylan Operations", kurz: "C", farbe: "#ea580c" },
];

describe("leadsZuGeoJson", () => {
  it("lässt Leads ohne Ort weg", () => {
    const fc = leadsZuGeoJson([lead({ id: "a" }), lead({ id: "b", ort: null })], "hell");
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.map((f) => f.properties?.id)).toEqual(["a"]);
  });

  it("nimmt Aufträge nicht auf (eigene, ungeclusterte Quelle)", () => {
    const fc = leadsZuGeoJson([lead({ id: "a", status: "neu" }), lead({ id: "b", status: "auftrag" })], "hell");
    expect(fc.features.map((f) => f.properties?.id)).toEqual(["a"]);
  });

  it("setzt wartet als boolean", () => {
    const fc = leadsZuGeoJson(
      [
        lead({ id: "a", wartet: { art: "antwort", seit: "2026-10-08T05:00:00.000Z", chatId: "c1" } }),
        lead({ id: "b", wartet: null }),
      ],
      "hell",
    );
    expect(fc.features.map((f) => f.properties?.wartet)).toEqual([true, false]);
  });

  it("legt Punktgeometrie als [lng, lat] an", () => {
    const fc = leadsZuGeoJson([lead({ id: "a" })], "dunkel");
    expect(fc.features[0].geometry).toEqual({ type: "Point", coordinates: [9.1686, 48.7718] });
    expect(fc.features[0].properties?.status).toBe("kontakt");
  });

  it("wählt Icon nach Status, Thema und Firmenkürzel", () => {
    const fc = leadsZuGeoJson(
      [
        lead({ id: "a", status: "neu" }),
        lead({ id: "b", status: "angebot", firmaId: "firma-kottke" }),
        lead({ id: "c", status: "kontakt", firmaId: "firma-unbekannt" }),
      ],
      "dunkel",
      FIRMEN,
    );
    expect(fc.features.map((f) => f.properties?.icon)).toEqual(["lk-neu-dunkel", "lk-angebot-dunkel-K", "lk-kontakt-dunkel"]);
  });

  it("baut Iconnamen wie in icons.ts registriert", () => {
    expect(iconName("erledigt", "hell")).toBe("lk-erledigt-hell");
    expect(iconName("auftrag", "dunkel", "C")).toBe("lk-auftrag-dunkel-C");
  });
});

describe("auftraegeZuGeoJson", () => {
  it("enthält nur Aufträge mit Ort, Wert in Cent oder null", () => {
    const fc = auftraegeZuGeoJson(
      [
        lead({ id: "a", status: "auftrag", wert: { cent: 189000, art: "bestaetigt" }, firmaId: "firma-ceylan" }),
        lead({ id: "b", status: "auftrag", ort: null }),
        lead({ id: "c", status: "angebot" }),
        lead({ id: "d", status: "auftrag", ort: BOEBLINGEN }),
      ],
      "hell",
      FIRMEN,
    );
    expect(fc.features.map((f) => f.properties?.id)).toEqual(["a", "d"]);
    expect(fc.features.map((f) => f.properties?.wertCent)).toEqual([189000, null]);
    expect(fc.features[0].properties?.icon).toBe("lk-auftrag-hell-C");
    expect(fc.features[1].properties?.icon).toBe("lk-auftrag-hell");
  });
});

describe("unplausible Werte (Ruling 7)", () => {
  it("Aufträge über 50.000 € gelten für die Markergröße als unbekannt", () => {
    const fc = auftraegeZuGeoJson(
      [
        lead({ id: "a", status: "auftrag", wert: { cent: 1_000_000_000, art: "bestaetigt" } }),
        lead({ id: "b", status: "auftrag", wert: { cent: WERT_PLAUSIBEL_MAX_CENT, art: "bestaetigt" } }),
      ],
      "hell",
    );
    expect(fc.features.map((f) => f.properties?.wertCent)).toEqual([null, WERT_PLAUSIBEL_MAX_CENT]);
  });

  it("Säulen mit unplausiblem Wert bekommen die Mindesthöhe", () => {
    const fc = auftragsSaeulen([lead({ id: "a", status: "auftrag", wert: { cent: 1_000_000_000, art: "bestaetigt" } })]);
    expect(fc.features[0].properties?.hoeheM).toBe(SAEULE_MIN_M);
  });
});

describe("auftragsSaeulen", () => {
  it("erzeugt ein geschlossenes Sechseck (7 Koordinaten) je Auftrag mit Ort", () => {
    const fc = auftragsSaeulen([
      lead({ id: "a", status: "auftrag" }),
      lead({ id: "b", status: "auftrag", ort: null }),
      lead({ id: "c", status: "kontakt" }),
    ]);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.properties?.id).toBe("a");
    expect(f.geometry.type).toBe("Polygon");
    const ring = f.geometry.coordinates[0];
    expect(ring).toHaveLength(7);
    expect(ring[6]).toEqual(ring[0]);
  });

  it("legt die Ecken im Abstand radiusM um den Ort", () => {
    const fc = auftragsSaeulen([lead({ id: "a", status: "auftrag" })], 1000);
    for (const [lng, lat] of fc.features[0].geometry.coordinates[0]) {
      const dy = (lat - STUTTGART.lat) * 111_320;
      const dx = (lng - STUTTGART.lng) * 111_320 * Math.cos((STUTTGART.lat * Math.PI) / 180);
      expect(Math.hypot(dx, dy)).toBeCloseTo(1000, -1);
    }
  });

  it("Höhe 1200 m bei unbekanntem Wert, steigt mit dem Wert, gedeckelt bei 9000 m", () => {
    const hoehe = (cent: number | null) =>
      auftragsSaeulen([lead({ id: "a", status: "auftrag", wert: cent === null ? null : { cent, art: "bestaetigt" } })])
        .features[0].properties?.hoeheM;
    expect(hoehe(null)).toBe(1200);
    expect(hoehe(100_000)).toBeGreaterThan(1200);
    expect(hoehe(300_000)).toBeGreaterThan(hoehe(100_000));
    expect(hoehe(5_000_000)).toBe(9000);
    expect(saeulenHoeheM(null)).toBe(1200);
    expect(saeulenHoeheM(99_000_000)).toBe(9000);
  });

  it("setzt die Säule auf das (angehobene) Kreisplättchen", () => {
    const fc = auftragsSaeulen([
      lead({ id: "a", status: "auftrag" }),
      lead({ id: "b", status: "kontakt" }),
      lead({ id: "c", status: "auftrag", ort: ort(48.14, 11.58, "09162", "80331") }),
    ]);
    const basis = Object.fromEntries(fc.features.map((f) => [f.properties?.id, f.properties?.basisM]));
    expect(basis.a).toBe(kreisHoeheM(2));
    expect(basis.c).toBe(0);
  });
});

describe("kreisHoeheM", () => {
  it("600 m plus 900 m je Aktivität, höchstens 6 Stufen", () => {
    expect(kreisHoeheM(0)).toBe(600);
    expect(kreisHoeheM(1)).toBe(1500);
    expect(kreisHoeheM(6)).toBe(6000);
    expect(kreisHoeheM(40)).toBe(6000);
  });
});

describe("kreisAktivitaet", () => {
  it("zählt Leads pro Kreis-AGS, ohne Ort oder Kreis zählt nicht", () => {
    expect(
      kreisAktivitaet([
        lead({ id: "a" }),
        lead({ id: "b", status: "auftrag" }),
        lead({ id: "c", ort: BOEBLINGEN }),
        lead({ id: "d", ort: null }),
        lead({ id: "e", ort: ort(48.0, 9.0, null) }),
      ]),
    ).toEqual({ "08111": 2, "08115": 1 });
  });
});

describe("auswahlLinie", () => {
  it("zeichnet einen Bogen vom Abholort zum Ziel plus Zielpunkt", () => {
    const fc = auswahlLinie(lead({ id: "a", ziel: TUEBINGEN }));
    const linie = fc.features.find((f) => f.geometry.type === "LineString");
    const punkt = fc.features.find((f) => f.geometry.type === "Point");
    expect(linie?.geometry.type).toBe("LineString");
    const coords = linie?.geometry.type === "LineString" ? linie.geometry.coordinates : [];
    expect(coords[0]).toEqual([STUTTGART.lng, STUTTGART.lat]);
    expect(coords[coords.length - 1]).toEqual([TUEBINGEN.lng, TUEBINGEN.lat]);
    expect(coords.length).toBeGreaterThan(2);
    expect(punkt?.geometry).toEqual({ type: "Point", coordinates: [TUEBINGEN.lng, TUEBINGEN.lat] });
  });

  it("ist leer ohne Lead, ohne Ort, ohne Ziel oder bei gleicher PLZ", () => {
    expect(auswahlLinie(null).features).toEqual([]);
    expect(auswahlLinie(lead({ id: "a", ziel: null })).features).toEqual([]);
    expect(auswahlLinie(lead({ id: "a", ort: null, ziel: TUEBINGEN })).features).toEqual([]);
    expect(auswahlLinie(lead({ id: "a", ziel: ort(48.7719, 9.1687) })).features).toEqual([]);
  });
});

describe("Kamera-Grenzen (kamera.ts)", () => {
  it("Kerngebiet umfasst die BW-Leads und ignoriert Ausreißer außerhalb BW", () => {
    const g = kernGrenzen([
      lead({ id: "a" }),
      lead({ id: "b", ort: BOEBLINGEN }),
      lead({ id: "c", ort: TUEBINGEN }),
      lead({ id: "d", ort: ort(52.52, 13.4, "11000", "10115") }),
      lead({ id: "e", ort: null }),
    ]);
    expect(g).toEqual([
      [8.9705, 48.5216],
      [9.1686, 48.7718],
    ]);
  });

  it("ohne verortete BW-Leads ist das Kerngebiet ganz BW", () => {
    expect(kernGrenzen([])).toEqual(BW_GRENZEN);
    expect(kernGrenzen([lead({ id: "a", ort: ort(52.52, 13.4, "11000", "10115") })])).toEqual(BW_GRENZEN);
  });

  it("vereinzelte Leads am Landesrand verschieben das Kerngebiet nicht", () => {
    const kern = Array.from({ length: 18 }, (_, i) => lead({ id: `k${i}`, ort: ort(48.7 + i * 0.005, 9.1 + i * 0.005) }));
    const freiburg = lead({ id: "fr", ort: ort(47.99, 7.85, "08311", "79098") });
    const ulm = lead({ id: "ul", ort: ort(48.4, 9.99, "08421", "89073") });
    const [[w, s], [o, n]] = kernGrenzen([...kern, freiburg, ulm]);
    expect(w).toBeGreaterThan(9.0);
    expect(o).toBeLessThan(9.3);
    expect(s).toBeGreaterThan(48.6);
    expect(n).toBeLessThan(48.9);
  });

  it("„Alle“ umfasst BW und alle verorteten Leads", () => {
    const g = alleGrenzen([lead({ id: "a" }), lead({ id: "b", ort: ort(50.11, 8.68, "06412", "60311") })]);
    expect(g).toEqual([
      [BW_GRENZEN[0][0], BW_GRENZEN[0][1]],
      [BW_GRENZEN[1][0], 50.11],
    ]);
  });
});
