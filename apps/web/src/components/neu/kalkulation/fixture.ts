/**
 * Ansichtsmodell der Familie Weber aus dem Mockup (05-kalkulation.html), als
 * Fixture für Sichtprüfung und Tests der Oberfläche. Erfundene Zahlen, aber in
 * den Formen von `KalkulationsAnsicht`. Zwei Stände: der Entwurf v3 mit einer
 * Zeitposten- und einer Marge-Anpassung, und die gesperrte, gesendete v2.
 */
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";

/** Platzhalterfoto als SVG-Datenadresse (zwei Töne, wie die Kacheln des Mockups). */
function bild(a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><rect x="28" y="52" width="104" height="70" rx="6" fill="rgba(255,255,255,.35)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const FOTOS: KalkulationsAnsicht["grundlage"]["fotos"] = [
  { id: "f1", url: bild("#e7e9ed", "#cfd3da"), treffer: [{ name: "Wandschrank", volumenCbm: 3.2 }] },
  { id: "f2", url: bild("#e3e6ea", "#c9ced6"), treffer: [] },
  { id: "f3", url: bild("#e8e4e0", "#d1c9c2"), treffer: [{ name: "Sofa", volumenCbm: 2.1 }] },
  { id: "f4", url: bild("#e5e8ec", "#c8cdd5"), treffer: [] },
  { id: "f5", url: bild("#e9e7e4", "#d3cfca"), treffer: [] },
  { id: "f6", url: bild("#e2e6ea", "#c4cad2"), treffer: [{ name: "Küche", volumenCbm: null }] },
  { id: "f7", url: bild("#e6e8eb", "#cdd1d8"), treffer: [] },
  { id: "f8", url: bild("#e8e9ec", "#cfd2d9"), treffer: [] },
  { id: "f9", url: bild("#e4e7eb", "#c7ccd4"), treffer: [{ name: "Bett", volumenCbm: 1.8 }] },
  { id: "f10", url: bild("#e7e5e2", "#d0cbc5"), treffer: [] },
  { id: "f11", url: bild("#e5e8ec", "#c9ced6"), treffer: [] },
  { id: "f12", url: bild("#e8e7e5", "#d2cfcb"), treffer: [] },
  { id: "f13", url: bild("#e3e6ea", "#c5cad2"), treffer: [] },
  { id: "f14", url: bild("#e6e8eb", "#ccd0d7"), treffer: [] },
];

const GRUNDLAGE: KalkulationsAnsicht["grundlage"] = {
  fotos: FOTOS,
  fotosGesamt: 14,
  adressen: { beladen: "Beispielweg 12, 70178 Stuttgart-West", entladen: "Probenstraße 4, 73728 Esslingen" },
  zeilen: [
    {
      key: "volumen",
      label: "Volumen",
      wert: "38 m³",
      herkunft: [
        { art: "FOTO", text: "Foto" },
        { art: "CHAT", text: "Chat" },
      ],
      warum: "31 Teile erkannt · Kunde nannte „3 Zimmer, ca. 70 m²“",
      bearbeitet: null,
      felder: [{ key: "volumen", label: "Volumen in m³", typ: "zahl", wert: 38 }],
    },
    {
      key: "beladen",
      label: "Beladen · Beispielweg 12",
      wert: "2. OG, kein Aufzug",
      herkunft: [{ art: "CHAT", text: "Chat" }],
      warum: "Tragweg 25 m (Standard)",
      bearbeitet: null,
      felder: [
        { key: "beladen.etage", label: "Etage", typ: "zahl", wert: 2 },
        { key: "beladen.aufzug", label: "Aufzug", typ: "aufzug", wert: "keiner" },
        { key: "beladen.tragweg", label: "Tragweg in m", typ: "zahl", wert: 25 },
      ],
    },
    {
      key: "entladen",
      label: "Entladen · Probenstraße 4, Esslingen",
      wert: "EG, Haus",
      herkunft: [{ art: "CHAT", text: "Chat" }],
      warum: "Tragweg 10 m (Standard)",
      bearbeitet: null,
      felder: [
        { key: "entladen.etage", label: "Etage", typ: "zahl", wert: 0 },
        { key: "entladen.aufzug", label: "Aufzug", typ: "aufzug", wert: "keiner" },
        { key: "entladen.tragweg", label: "Tragweg in m", typ: "zahl", wert: 10 },
      ],
    },
    {
      key: "halteverbot",
      label: "Halteverbot",
      wert: "beidseitig",
      herkunft: [{ art: "KUNDE", text: "Kunde" }],
      warum: "Stuttgart-West eng, Esslingen Hofzufahrt",
      bearbeitet: null,
      felder: [
        { key: "halteverbot.beladen", label: "Beim Beladen", typ: "ja_nein", wert: true },
        { key: "halteverbot.entladen", label: "Beim Entladen", typ: "ja_nein", wert: true },
      ],
    },
    {
      key: "kartons",
      label: "Kartons",
      wert: "60 Stück",
      herkunft: [{ art: "KUNDE", text: "Kunde" }],
      warum: "Anlieferung 14.11.",
      bearbeitet: null,
      felder: [{ key: "kartons", label: "Kartons", typ: "ganzzahl", wert: 60 }],
    },
    {
      key: "montage",
      label: "Montage",
      wert: "Wandschrank, Bett",
      herkunft: [
        { art: "FOTO", text: "Foto 3" },
        { art: "MANUELL", text: "Dario" },
      ],
      warum: "1 Position ohne Katalogzeit, bitte Zeitposten anlegen",
      bearbeitet: { von: "Dario", am: "04.11. 10:48", grund: "Wandschrank 3-türig, Demontage + Aufbau" },
      felder: [],
    },
    {
      key: "team",
      label: "Team",
      wert: "3 Personen",
      herkunft: [{ art: "REGEL", text: "Regel" }],
      warum: "Sprinter L · 2 Touren",
      bearbeitet: null,
      felder: [{ key: "team", label: "Personen", typ: "ganzzahl", wert: 3 }],
    },
    {
      key: "termin",
      label: "Termin",
      wert: "Fr 20.11.",
      herkunft: [{ art: "KUNDE", text: "Kunde" }],
      warum: null,
      bearbeitet: null,
      felder: [{ key: "termin", label: "Termin", typ: "datum", wert: "2026-11-20" }],
    },
  ],
};

const SELBSTKOSTEN: KalkulationsAnsicht["selbstkosten"] = {
  gruppen: [
    {
      key: "personal.arbeit",
      label: "Arbeit",
      formel: "3 × 7,2 h × 20 €",
      betragCent: 43200,
      uebersteuert: false,
      unterzeilen: [
        { key: "arbeit.laden", label: "18,2 h Laden, Tragen, Montage", formel: "38 m³ × 25 min + 2. OG ohne Aufzug", wert: "18,2 h", uebersteuert: false },
        { key: "zeitposten.wandschrank", label: "Wandschrank, Demontage + Aufbau · Dario", formel: null, wert: "+90 min", uebersteuert: true },
        { key: "arbeit.puffer", label: "Puffer 10 %", formel: null, wert: "+2,0 h", uebersteuert: false },
        { key: "arbeit.personenh", label: "= 21,7 Personenstunden", formel: "÷ 3 Personen", wert: "7,2 h je Person", uebersteuert: false },
      ],
    },
    { key: "personal.fahrt", label: "Fahrt", formel: "3 × 1,2 h × 15 €", betragCent: 5400, uebersteuert: false, unterzeilen: [] },
    {
      key: "fahrzeug.sprinter_l",
      label: "Transporter",
      formel: "Wochenmiete 450 € ÷ 3 Umzüge",
      betragCent: 15900,
      uebersteuert: false,
      unterzeilen: [
        { key: "fahrzeug.sprinter_l.kraftstoff", label: "Kraftstoff 48 km", formel: null, wert: "9 €", uebersteuert: false },
        { key: "fahrzeug.sprinter_l.mehrkm", label: "Mehrkilometer · 48 von 310 km Rest inklusive", formel: null, wert: "0 €", uebersteuert: false },
      ],
    },
    { key: "halteverbot", label: "Halteverbot beidseitig", formel: "2 × 130 €", betragCent: 26000, uebersteuert: false, unterzeilen: [] },
    {
      key: "material",
      label: "Material",
      formel: null,
      betragCent: 20700,
      uebersteuert: false,
      unterzeilen: [
        { key: "material.folie", label: "Folie", formel: "Vorgabe 30 €, hier unverändert", wert: "30 €", uebersteuert: false },
        { key: "material.decken", label: "Decken und Gurte", formel: "38 m³ × 0,70 €", wert: "27 €", uebersteuert: false },
        { key: "material.kartons", label: "60 Umzugskartons", formel: "2,50 € je Stück", wert: "150 €", uebersteuert: false },
      ],
    },
    { key: "anfahrtsgeld", label: "Mitarbeiter-Anfahrt", formel: "eigener PKW · 0,30 €/km", betragCent: 900, uebersteuert: false, unterzeilen: [] },
  ],
  zwischensummeCent: 112100,
  gemeinkosten: { prozent: 35, betragCent: 39200 },
  versicherungCent: 2000,
  selbstkostenCent: 153300,
  tarifText: "Tarif v1 · Sätze aus Einstellungen",
};

const MARGE: KalkulationsAnsicht["marge"] = {
  vorschlagProzent: 37,
  gewaehltProzent: 38,
  gewaehltVon: "Dario",
  gruende: [
    { text: "Basis Kottke", punkte: 40 },
    { text: "Quelle Kleinanzeigen", punkte: -3 },
    { text: "Freitag, keine Eile, kein Monatsende", punkte: 0 },
  ],
  min: 30,
  max: 60,
  rundungEur: 10,
  selbstkostenEur: 1533,
};

const PREIS: KalkulationsAnsicht["preis"] = {
  formel: "Preis = 1.533 € ÷ (1 − 0,38)",
  preisRohText: "2.473 €",
  gerundetCent: 248000,
  gewinnCent: 94700,
  listenpreisCent: 265000,
  spanne: null,
};

const KV: KalkulationsAnsicht["kv"] = {
  posten: [
    { text: "Umzugsteam 3 Personen und Sprinter", betragCent: 195000, herkunft: "Rest nach den Hebeln · inkl. Anfahrt, Material, Versicherung" },
    { text: "Halteverbot beidseitig", betragCent: 30000, herkunft: "Halteverbot · aus 260 € Kosten" },
    { text: "Demontage & Montage (Wandschrank, Bett)", betragCent: 6000, herkunft: "Montage · 1,5 h × 35 €, aufgerundet" },
    { text: "60 Umzugskartons", betragCent: 17000, herkunft: "Einpacken · aus 150 € Kosten" },
  ],
  summeCent: 248000,
  vorschau: true,
  obergrenze: false,
};

const KOPF: KalkulationsAnsicht["kopf"] = {
  name: "Familie Weber",
  strecke: "Stuttgart-West nach Esslingen",
  termin: "Fr 20.11.",
  aktenLink: "/app/leads/weber",
  schritt: "Schritt 3 von 11",
  unterzeile: "Familie Weber, Umzug Stuttgart-West nach Esslingen, Fr 20.11.",
};

export const WEBER_ENTWURF: KalkulationsAnsicht = {
  kopf: KOPF,
  versionen: [
    { version: 1, status: "gesperrt", preisCent: 239000, aktiv: false, gesendet: null },
    { version: 2, status: "gesperrt", preisCent: 248000, aktiv: false, gesendet: "Di 04.11. 11:40" },
    { version: 3, status: "entwurf", preisCent: 248000, aktiv: true, gesendet: null },
  ],
  version: {
    nummer: 3,
    status: "entwurf",
    bearbeitbar: true,
    gesperrtText: null,
    veraltet: false,
    fehler: null,
    tarif: "Tarif v1",
    kvDokument: null,
    sperrbar: true,
    sperrGrund: null,
    preisModus: "fest",
    renderer: "crm",
  },
  grundlage: GRUNDLAGE,
  selbstkosten: SELBSTKOSTEN,
  marge: MARGE,
  preis: PREIS,
  kv: KV,
  kvFehler: null,
  pakete: [],
  angebotsformularLink: "/deals/weber?tab=quotation",
  anpassungen: [
    {
      id: "u-zeitposten",
      art: "zeitposten",
      key: "frei.wandschrank",
      text: "Wandschrank, Demontage + Aufbau: +90 min",
      von: "Dario",
      am: "04.11. 10:48",
      grund: "3-türig, auf Foto 3, braucht Demontage und Aufbau, Rechner hatte 0",
    },
    {
      id: "u-marge",
      art: "marge",
      key: "marge",
      text: "Marge: 38 %",
      von: "Dario",
      am: "04.11. 10:52",
      grund: "Marge im Regler gewählt",
    },
  ],
  zeitpostenVorlagen: [
    { id: "klavier", bezeichnung: "Klavier", minuten: 60 },
    { id: "waschmaschine", bezeichnung: "Waschmaschine", minuten: 20 },
    { id: "kueche", bezeichnung: "Küche abbauen", minuten: 120 },
    { id: "tragweg", bezeichnung: "langer Tragweg je 10 m", minuten: 15 },
  ],
};

export const WEBER_GESPERRT: KalkulationsAnsicht = {
  ...WEBER_ENTWURF,
  versionen: WEBER_ENTWURF.versionen.map((v) => ({ ...v, aktiv: v.version === 2 })),
  version: {
    nummer: 2,
    status: "gesperrt",
    bearbeitbar: false,
    gesperrtText: "v2 gesperrt · gesendet Di 04.11. 11:40",
    veraltet: false,
    fehler: null,
    tarif: "Tarif v1",
    kvDokument: { id: "dok-kv-v2", fileName: "KV-Familie-Weber-v2.pdf" },
    sperrbar: false,
    sperrGrund: "Version v2 ist gesperrt.",
    preisModus: "fest",
    renderer: "crm",
  },
  selbstkosten: {
    ...SELBSTKOSTEN,
    gruppen: SELBSTKOSTEN.gruppen.map((g) =>
      g.key === "personal.arbeit" ? { ...g, unterzeilen: g.unterzeilen.filter((u) => !u.uebersteuert) } : g
    ),
  },
  marge: { ...MARGE, gewaehltProzent: null, gewaehltVon: null },
  preis: { ...PREIS, formel: "Preis = 1.533 € ÷ (1 − 0,37)", preisRohText: "2.434 €", gerundetCent: 244000, gewinnCent: 90700 },
  kv: KV ? { ...KV, vorschau: false, summeCent: 248000 } : null,
  anpassungen: [],
};

/** Entwurf, der veraltet ist und nicht gesperrt werden kann (Review Focus 3). */
export const WEBER_VERALTET: KalkulationsAnsicht = {
  ...WEBER_ENTWURF,
  version: {
    ...WEBER_ENTWURF.version,
    veraltet: true,
    sperrbar: false,
    sperrGrund: "Der Entwurf ist veraltet. Bitte zuerst neu rechnen.",
  },
};
