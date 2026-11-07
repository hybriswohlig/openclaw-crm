/**
 * Testdaten der Kalkulationsseite für Plan 5b (Task U1): Familie Weber mit
 * den Feldern, die Task K auf dem Server füllt (`pakete` mit Anpassung,
 * `tage`, `stunden`, `kern`, `preisHash`, `schalter`, `kvDarstellung`).
 * Die Basis baut der echte Kern (`ansichtAus` über `weberVersion`); die
 * 5b-Felder liegen als reine Daten darüber, damit die Sichtprüfung im
 * Browser dieselben Werte über die echte Ansicht legen kann
 * (`ansicht5bFelder`). Nur für Tests und Vorschauen.
 */
import type { KalkulationsAnsicht, PaketAnsicht, StundenAnsicht, TagAnsicht } from "./kalkulations-ansicht";
import { ansichtAus, type AnsichtRest } from "./kalkulations-ansicht";
import { DARIO, WEBER_DEAL, WEBER_JETZT, weberFotos, weberInventar, weberVersion } from "./kalkulations-ansicht.fixture";

export type Variante5b = "aus" | "pakete" | "kern_klein" | "kern_negativ" | "ein_posten" | "stunden" | "stunden_ohne_satz" | "gesperrt";

export const PAKETE_5B: PaketAnsicht[] = [
  {
    slug: "basis",
    name: "Basis",
    preisCent: 199000,
    rechnerPreisCent: 199000,
    uebersteuert: null,
    untergrenzeCent: 185000,
    hinweis: null,
    hebel: [],
    kern: { art: "ein_posten" },
  },
  {
    slug: "komfort",
    name: "Komfort",
    preisCent: 239000,
    rechnerPreisCent: 248000,
    uebersteuert: { betragCent: 239000, grund: "Stammkunde, Preis vom Telefonat" },
    untergrenzeCent: 219000,
    hinweis: null,
    hebel: ["halteverbot", "montage"],
    kern: { art: "ok" },
  },
  {
    slug: "premium",
    name: "Premium",
    preisCent: 289000,
    rechnerPreisCent: 289000,
    uebersteuert: null,
    untergrenzeCent: 255000,
    hinweis: null,
    hebel: ["halteverbot", "montage", "einpacken", "kueche"],
    kern: { art: "klein", anteil: 0.44 },
  },
  {
    slug: "einzeltransport",
    name: "Einzeltransport",
    preisCent: null,
    rechnerPreisCent: null,
    uebersteuert: null,
    untergrenzeCent: null,
    hinweis: "Preis nur mit Anpassung und Grund.",
    kern: null,
  },
];

export const TAGE_5B: TagAnsicht[] = [
  {
    datum: "2026-11-20",
    text: "Fr 20.11.",
    feiertag: false,
    empfohlen: false,
    preisCent: 246000,
    rechnerPreisCent: 246000,
    uebersteuert: null,
    gruende: [{ text: "Freitag", punkte: 0 }],
    paketPreiseCent: { basis: 197000, komfort: 237000, premium: 287000 },
    slots: [{ label: "ab 8 Uhr", startTime: "08:00", endTime: null }],
    note: null,
  },
  {
    datum: "2026-11-21",
    text: "Sa 21.11.",
    feiertag: false,
    empfohlen: true,
    preisCent: 248000,
    rechnerPreisCent: 258000,
    uebersteuert: { betragCent: 248000, grund: "Samstag wie Freitag angeboten" },
    gruende: [{ text: "Samstag", punkte: 3 }],
    paketPreiseCent: { basis: 199000, komfort: 239000, premium: 289000 },
    slots: [{ label: "ab 8 Uhr", startTime: "08:00", endTime: null }],
    note: "Kunde bevorzugt Samstag",
  },
];

export const STUNDEN_5B: StundenAnsicht = {
  helfer: 3,
  transporter: 1,
  stundenGeschaetzt: 7.5,
  mindestStunden: 3,
  satzHelferEur: 35,
  satzTransporterEur: 25,
  summeGeschaetztCent: 98500,
  mindestbetragCent: 39000,
  zusatzposten: [],
};

const HASH = "-@-=248000|basis@-=199000|einzeltransport@-=x|komfort@-=239000|premium@-=289000";

/** Die 5b-Felder je Variante, als reine Daten (auch für das Browser-Skript der Sichtprüfung). */
export function ansicht5bFelder(variante: Variante5b): Partial<KalkulationsAnsicht> & {
  versionPatch?: Partial<KalkulationsAnsicht["version"]>;
} {
  const an = { angebotAusKalkulation: true, tagespreise: true };
  switch (variante) {
    case "aus":
      return { schalter: { angebotAusKalkulation: false, tagespreise: false } };
    case "pakete":
      return { pakete: PAKETE_5B, tage: TAGE_5B, kern: { art: "ok" }, preisHash: HASH, schalter: an, kvDarstellung: "posten" };
    case "kern_klein":
      return {
        pakete: PAKETE_5B,
        kern: { art: "klein", anteil: 0.38 },
        preisHash: HASH,
        schalter: { angebotAusKalkulation: true, tagespreise: false },
        kvDarstellung: "posten",
      };
    case "kern_negativ":
      return {
        pakete: [],
        kern: { art: "negativ" },
        preisHash: "-@-=248000",
        schalter: an,
        kvDarstellung: "posten",
        versionPatch: { sperrbar: false, sperrGrund: "Die Hebel sind größer als der Preis. Bitte Marge oder Hebel prüfen." },
      };
    case "ein_posten":
      return {
        pakete: [],
        kern: { art: "ein_posten" },
        preisHash: "-@-=248000",
        schalter: an,
        kvDarstellung: "ein_posten",
      };
    case "stunden":
      return {
        pakete: [],
        stunden: STUNDEN_5B,
        kern: null,
        preisHash: "-@-=98500",
        schalter: an,
        kvDarstellung: "posten",
        versionPatch: { preisModus: "stunden" },
      };
    case "stunden_ohne_satz":
      return {
        pakete: [],
        stunden: null,
        kern: null,
        preisHash: null,
        schalter: an,
        kvDarstellung: "posten",
        versionPatch: {
          preisModus: "stunden",
          sperrbar: false,
          sperrGrund: "Für diese Firma sind keine Stundensätze hinterlegt. Bitte in den Rechner-Einstellungen eintragen.",
        },
      };
    case "gesperrt":
      return {
        pakete: PAKETE_5B,
        tage: TAGE_5B,
        kern: { art: "ok" },
        preisHash: HASH,
        schalter: an,
        kvDarstellung: "posten",
        versionPatch: {
          status: "gesperrt",
          bearbeitbar: false,
          sperrbar: false,
          gesperrtText: "v2 gesperrt · noch nicht gesendet",
          sperrGrund: "v2 ist gesperrt. Änderungen landen in einem neuen Entwurf.",
        },
      };
  }
}

/** `ansicht` mit den 5b-Feldern einer Variante darüber gelegt (gleiche Regel wie das Browser-Skript). */
export function mit5b(basis: KalkulationsAnsicht, variante: Variante5b): KalkulationsAnsicht {
  const { versionPatch, ...felder } = ansicht5bFelder(variante);
  return { ...basis, ...felder, version: { ...basis.version, ...(versionPatch ?? {}) } };
}

function rest(felder: Partial<AnsichtRest> = {}): AnsichtRest {
  return {
    alle: [
      { version: 1, status: "gesperrt", priceCents: 239000, sentAt: new Date("2026-11-04T10:40:00.000Z") },
      { version: 2, status: "entwurf", priceCents: 248000, sentAt: null },
    ],
    namen: { [DARIO]: "Dario Kottke" },
    deal: { name: "Familie Weber", art: "Umzug", strecke: "Stuttgart nach Esslingen", termin: "2026-11-21", aktenLink: `/app/leads/${WEBER_DEAL}` },
    inventar: weberInventar(),
    fotos: weberFotos(),
    vorlagen: [],
    angebot: null,
    veraltet: false,
    kvDokument: null,
    jetzt: WEBER_JETZT,
    hatPakete: false,
    paketNamen: {},
    renderer: "vps",
    ...felder,
  };
}

/** Weber-Ansicht (Entwurf v2) mit den 5b-Feldern einer Variante. */
export function weberAnsicht5b(variante: Variante5b, felder: Partial<AnsichtRest> = {}): KalkulationsAnsicht {
  return mit5b(ansichtAus(weberVersion(), rest(felder)), variante);
}
