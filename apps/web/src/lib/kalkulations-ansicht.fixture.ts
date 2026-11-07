/**
 * Testdaten der Kalkulationsseite: Familie Weber, Umzug Stuttgart-West nach
 * Esslingen (die Zahlen des Mockups 05-kalkulation.html). Das Rechner-Ergebnis
 * hat die Form, die der Angebotsrechner heute speichert (Schlüssel, Formeln
 * und Bezeichnungen wie in `src/engine/kosten.ts` und `formel.ts` des
 * Rechners); Grundlage, Kostenzeilen und Anfrage baut der echte CRM-Kern
 * (`grundlageAus`, `kostenzeilenAus`, `anfrageMitUebersteuerungen`).
 * Nur für Tests und Vorschauen, keine Server-Importe.
 */
import type { InboxAnhangZeile, InventarZeile } from "./kalkulations-ansicht";
import {
  anfrageMitUebersteuerungen,
  grundlageAus,
  kostenzeilenAus,
  type Uebersteuerung,
} from "./kalkulation-versionen";
import type { RechnerErgebnis } from "@/services/rechner/client";
import { rechnerAnfrageAus, type LeadDaten } from "@/services/rechner/eingabe";
import type { VersionsZeile } from "@/services/kalkulation-versionen";

export const WEBER_DEAL = "deal_weber";
export const WEBER_HEUTE = "2026-11-06";
/** Fr 06.11.2026, 10:00 in Berlin */
export const WEBER_JETZT = new Date("2026-11-06T09:00:00.000Z");

export const WEBER_LEAD: LeadDaten = {
  von: "Rotebühlstr. 112, 70178 Stuttgart",
  nach: "Plochinger Str. 8, 73730 Esslingen",
  etageVon: 2,
  etageNach: 0,
  zugangVon: "Treppe",
  zugangNach: "Erdgeschoss",
  umzugsdatum: "2026-11-21",
  wohnflaecheQm: 70,
  zimmer: 3,
  tragestreckeVonM: null,
  tragestreckeNachM: null,
  halteverbot: true,
  halteverbotNach: true,
  packService: true,
  kartons: 60,
  marke: "kottke",
  quelle: "kleinanzeigen",
  auftragsart: "umzug",
  inventar: [
    { name: "Wandschrank 3-türig", menge: 1, groessenklasse: "sperrig", volumenCbm: 2.4, mitnehmen: true, abbau: "company", aufbau: "company", quelle: "foto" },
    { name: "Bett 180x200", menge: 1, groessenklasse: "gross", volumenCbm: 1.6, mitnehmen: true, abbau: "company", aufbau: "company", quelle: "chat" },
    { name: "Sofa 3-Sitzer", menge: 1, groessenklasse: "gross", volumenCbm: 2, mitnehmen: true, quelle: "foto" },
    { name: "Waschmaschine", menge: 1, groessenklasse: "mittel", volumenCbm: 0.6, mitnehmen: true, quelle: "chat" },
    { name: "Kommode", menge: 2, groessenklasse: "mittel", volumenCbm: 0.8, mitnehmen: true, quelle: "foto" },
    { name: "Vitrine Eigenbau", menge: 1, groessenklasse: "gross", volumenCbm: 0.9, mitnehmen: true, abbau: "company", aufbau: "company", quelle: "foto" },
  ],
};

const posten = (
  key: string,
  bezeichnung: string,
  menge: number | null,
  einheit: string | null,
  satz: number | null,
  betrag: number,
  formel: string | null,
  extra: { quelle?: string; hebel?: "halteverbot" } = {}
) => ({ key, bezeichnung, menge, einheit, satz, betrag, formel, quelle: extra.quelle ?? "tarif", ...(extra.hebel ? { hebel: extra.hebel } : {}) });

/** Gespeichertes Ergebnis des Rechners: Selbstkosten 1.533,35 €, Marge 38 %, Festpreis 2.480 €. */
export function weberErgebnis(): RechnerErgebnis {
  return {
    montageJePosition: true,
    preis: {
      festpreis: 2480,
      festpreisRoh: 2473.15,
      mindestpreis: 2200,
      margeEur: 946.65,
      margeProzent: 38,
      posten: [
        posten("verkauf.arbeitsstunden", "Arbeitsstunden", 25.96, "Std", 35, 908.6, "25,96 Std × 35,00 €"),
        posten("verkauf.halteverbot", "Halteverbotszone", 2, "Stück", 150, 300, "2 Stück × 150,00 €"),
      ],
      nichtKalkulierbarGrund: null,
      listenpreis: 2650,
      festpreisBeiMindestmarge: 2200,
      selbstkosten: 1533.35,
      margeWirksamProzent: 38,
      margeQuelle: "anfrage",
      rundungEur: 10,
      margeVorschlag: {
        prozent: 37,
        gruende: [
          { text: "Basis Kottke", punkte: 40 },
          { text: "Quelle Kleinanzeigen", punkte: -3 },
          { text: "Freitag, keine Eile, kein Monatsende", punkte: 0 },
        ],
      },
    },
    kosten: {
      selbstkosten: 1533.35,
      personenH: 25.96,
      personalStunden: { arbeitPm: 1170, fahrerPm: 30, fahrzeitPm: 216, pufferProzent: 10, personenH: 25.96 },
      posten: [
        posten("personal.arbeit", "Personal Arbeit (Arbeit, Fahrzeugübergabe, Puffer)", 22, "Std", 20, 440, "22 Personenstunden × 20,00 €/h"),
        posten("personal.fahrt", "Personal Fahrt (Fahrzeit, Puffer)", 3.96, "Std", 15, 59.4, "3,96 Std × 15,00 €"),
        posten("fahrzeug.sprinter@sixt-feuerbach.kraftstoff", "Sprinter L: Kraftstoff (48 km × 12 l/100 km)", 5.76, "l", 1.65, 9.5, "5,76 l × 1,65 €"),
        posten("fahrzeug.sprinter@sixt-feuerbach.miete", "Sprinter L: Miete", 1, "Tag", 136.5, 136.5, "1 Tag × 136,50 €"),
        posten("halteverbot", "Halteverbotszone", 2, "Stück", 130, 260, "2 Stück × 130,00 €", { hebel: "halteverbot" }),
        posten("material.folie", "Folie", 1, "pauschal", 30, 30, "1 pauschal × 30,00 €"),
        posten("material.decken", "Decken und Gurte", 38, "m³", 0.7, 26.6, "38 m³ × 0,70 €"),
        posten("material.kartons", "Umzugskartons", 60, "Stück", 2.5, 150, "60 Stück × 2,50 €"),
        posten("anfahrtsgeld", "Anfahrtsgeld Team", null, null, null, 9, null),
        posten("gemeinkosten", "Gemeinkosten", null, null, null, 392.35, "35 % von 1.121,00 €"),
        posten("versicherung", "Versicherung", null, null, null, 20, null),
      ],
    },
    zuordnungFreitext: { nichtZugeordnet: [{ name: "Vitrine Eigenbau", grund: "ohne Katalogtreffer" }] },
    volumen: { nettoCbm: 38, ladeCbm: 41.8, gewichtKg: 3800 },
    zeiten: { fahrtMin: 72, uhrzeitMin: 470, einsatztage: 1, demontage: 50, montage: 40, packen: 120, zeitpostenPm: 90 },
    tarif: { id: "tarif_kottke", version: 1, marke: "kottke" },
    paketpreise: [],
    team: { groesse: 3 },
    schaetzung: null,
    margeVorschlag: {
      prozent: 37,
      gruende: [
        { text: "Basis Kottke", punkte: 40 },
        { text: "Quelle Kleinanzeigen", punkte: -3 },
        { text: "Freitag, keine Eile, kein Monatsende", punkte: 0 },
      ],
    },
    mietstation: {
      name: "Sixt Feuerbach", anbieter: "Sixt", adresse: "Stuttgarter Str. 50, 70469 Stuttgart", quelle: "google",
      anfahrtKm: 9, anfahrtMin: 16, rueckfahrtKm: 18, rueckfahrtMin: 24,
    },
    stationsVergleich: [
      { name: "Sixt Feuerbach", festpreis: 2480, selbstkosten: 1533.35, gewaehlt: true, anfahrtMin: 16, rueckfahrtMin: 24, fahrzeug: "Sprinter L" },
      { name: "Europcar Vaihingen", festpreis: 2530, selbstkosten: 1565.1, gewaehlt: false, anfahrtMin: 22, rueckfahrtMin: 31, fahrzeug: "Sprinter L" },
    ],
    positionen: [
      { name: "Wandschrank 3-türig", menge: 1, volumenCbm: 2.4, zerlegt: true, demontageQuelle: "wunsch", ungeprueft: false },
      { name: "Bett 180x200", menge: 1, volumenCbm: 1.6, zerlegt: true, demontageQuelle: "wunsch", ungeprueft: false },
      { name: "Sofa 3-Sitzer", menge: 1, volumenCbm: 2, zerlegt: false, demontageQuelle: "nicht_zerlegbar", ungeprueft: false },
      { name: "Waschmaschine", menge: 1, volumenCbm: 0.6, zerlegt: false, demontageQuelle: "nicht_zerlegbar", ungeprueft: false },
      { name: "Kommode", menge: 2, volumenCbm: 0.8, zerlegt: false, demontageQuelle: "nein", ungeprueft: false },
      { name: "Vitrine Eigenbau", menge: 1, volumenCbm: 0.9, zerlegt: false, demontageQuelle: "keine_regel", ungeprueft: true },
    ],
    hinweise: [{ typ: "ungeprueft", text: "Vitrine Eigenbau ohne Katalogtreffer" }],
    annahmen: ['Position "Vitrine Eigenbau" ohne Katalogtreffer: 0.9 m³ (vorgegeben) und 90 kg (Standard der Größenklasse gross) je Stück.'],
    fahrzeitHinweis: null,
    fahrzeugoptionen: [
      { id: "opt_sprinter_l", name: "Sprinter L", fahrten: 2, km: 48, fahrtMin: 72, teamgroesse: 3, uhrzeitMin: 470, auslastung: 0.95 },
      { id: "opt_lkw_75", name: "LKW 7,5 t", fahrten: 1, km: 41, fahrtMin: 58, teamgroesse: 3, uhrzeitMin: 430, auslastung: 0.6 },
    ],
    empfehlungOptionId: "opt_sprinter_l",
  };
}

export const DARIO = "usr_dario";

/** Übersteuerungen von v2: Zeitposten Wandschrank, Marge 38 %, ein aufgehobener Satz. */
export function weberUebersteuerungen(): Uebersteuerung[] {
  const autor = { userId: DARIO, quelle: "mensch" as const };
  return [
    {
      id: "u_wandschrank", art: "zeitposten", key: "wandschrank", rechnerwert: null,
      wert: { bezeichnung: "Wandschrank, Demontage + Aufbau", minuten: 90 },
      grund: "3-türig, auf Foto 3, braucht Demontage und Aufbau, Rechner hatte 0",
      autor, zeit: "2026-11-04T09:48:00.000Z", fotoRef: "att_3",
    },
    {
      id: "u_satz", art: "satz", key: "arbeit", rechnerwert: 20, wert: 22, grund: "Test", autor, zeit: "2026-11-04T09:50:00.000Z", fotoRef: null,
    },
    {
      id: "u_satz_zurueck", art: "satz", key: "arbeit", rechnerwert: 20, wert: null, grund: "doch Tarif", autor, zeit: "2026-11-04T09:51:00.000Z", fotoRef: null,
    },
    {
      id: "u_marge", art: "marge", key: "marge", rechnerwert: 37, wert: 38, grund: "Marge im Regler gewählt", autor, zeit: "2026-11-04T10:05:00.000Z", fotoRef: null,
    },
  ];
}

/** v2 als Entwurf, gerechnet heute (06.11.) mit genau dieser Anfrage. */
export function weberVersion(felder: Partial<VersionsZeile> = {}): VersionsZeile {
  const overrides = felder.overrides ?? weberUebersteuerungen();
  const ergebnis = felder.rechnerResult === undefined ? weberErgebnis() : felder.rechnerResult;
  const jetzt = new Date("2026-11-06T08:00:00.000Z");
  return {
    id: "ver_v2",
    workspaceId: "ws_1",
    dealRecordId: WEBER_DEAL,
    version: 2,
    status: "entwurf",
    pricingMode: "fest",
    referenceDate: WEBER_HEUTE,
    inputs: grundlageAus(WEBER_LEAD, ergebnis, overrides),
    overrides,
    rechnerRequest: anfrageMitUebersteuerungen(rechnerAnfrageAus(WEBER_LEAD), overrides, { referenceDate: WEBER_HEUTE }),
    rechnerResult: ergebnis,
    error: null,
    costLines: kostenzeilenAus(ergebnis, overrides),
    margin: { vorschlagProzent: 37, gruende: ergebnis?.preis?.margeVorschlag?.gruende ?? [], gewaehltProzent: 38 },
    priceCents: 248000,
    packagePrices: [],
    dayPrices: [],
    kvItems: [],
    tariff: { id: "tarif_kottke", version: 1, marke: "kottke" },
    vehicleBookingId: null,
    createdBy: DARIO,
    createdAt: jetzt,
    updatedAt: jetzt,
    lockedAt: null,
    lockedBy: null,
    sentAt: null,
    sentVia: null,
    ...felder,
  };
}

/** Inventar des Deals (Zeilen aus `deal_inventory_items`): 31 Teile zum Mitnehmen. */
export function weberInventar(): InventarZeile[] {
  const z = (
    name: string,
    quantity: number,
    source: "chat" | "foto" | "operator",
    felder: Partial<InventarZeile> = {}
  ): InventarZeile => ({
    name, quantity, source, moveFlag: true, photoAttachmentId: null, volumeCbmEstimate: null,
    dismantlingOwner: "none", assemblyOwner: "none", ...felder,
  });
  return [
    z("Wandschrank 3-türig", 1, "foto", { photoAttachmentId: "att_3", volumeCbmEstimate: "2.4", dismantlingOwner: "company", assemblyOwner: "company" }),
    z("Bett 180x200", 1, "chat", { volumeCbmEstimate: "1.6", dismantlingOwner: "company", assemblyOwner: "company" }),
    z("Sofa 3-Sitzer", 1, "foto", { photoAttachmentId: "att_1", volumeCbmEstimate: "2" }),
    z("Waschmaschine", 1, "chat"),
    z("Kommode", 2, "foto", { photoAttachmentId: "att_1", volumeCbmEstimate: "0.8" }),
    z("Vitrine Eigenbau", 1, "foto", { photoAttachmentId: "att_2", dismantlingOwner: "company", assemblyOwner: "company" }),
    z("Bücherregal", 3, "chat"),
    z("Stuhl", 6, "chat"),
    z("Esstisch", 1, "chat"),
    z("Lampe", 4, "chat"),
    z("Fernseher", 1, "chat"),
    z("Pflanze", 9, "chat"),
    z("Alter Kühlschrank", 1, "chat", { moveFlag: false }),
  ];
}

/** Anhänge des Deals, neueste zuerst (wie `getAttachmentsForDeal`). */
export function weberFotos(): InboxAnhangZeile[] {
  return [
    { id: "att_pdf", mimeType: "application/pdf", fileName: "Grundriss.pdf", createdAt: new Date("2026-11-03T12:00:00.000Z") },
    { id: "att_3", mimeType: "image/jpeg", fileName: "IMG_3.jpg", createdAt: new Date("2026-11-03T08:03:00.000Z") },
    { id: "att_2", mimeType: "image/jpeg", fileName: "IMG_2.jpg", createdAt: new Date("2026-11-03T08:02:00.000Z") },
    { id: "att_1", mimeType: "image/heic", fileName: "IMG_1.heic", createdAt: new Date("2026-11-03T08:01:00.000Z") },
  ];
}
