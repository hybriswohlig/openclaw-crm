/**
 * Leistung, wie der Kunde sie im Portal liest. Rechtlich zählt weiter nur die
 * ServiceArt (Widerruf, § 451g HGB). „Entrümpelung + Umzug“ ist rechtlich ein
 * Umzug mit Zusatz: serviceType "move" und documentDetails.mitEntruempelung.
 */
import type { ServiceArt } from "./annahme-recht";
import { kundenAnrede } from "./anrede";

export type PortalLeistung = ServiceArt | "clearance_move";

export function portalLeistung(serviceType: ServiceArt, mitEntruempelung: boolean | null | undefined): PortalLeistung {
  return serviceType === "move" && mitEntruempelung === true ? "clearance_move" : serviceType;
}

/** Welche ServiceArt rechtlich gilt und ob die Entrümpelung dazugehört. */
export function ausPortalLeistung(l: PortalLeistung): { serviceType: ServiceArt; mitEntruempelung: boolean } {
  return l === "clearance_move" ? { serviceType: "move", mitEntruempelung: true } : { serviceType: l, mitEntruempelung: false };
}

export interface LeistungsWorte {
  /** „Umzug“, „Küchenmontage“ … für Labels. */
  name: string;
  /** Nach „für“: „den Umzug“. */
  akkusativ: string;
  /** „deinen Umzug“ / „Ihren Umzug“. */
  deinAkk: string;
  /** „deinem Umzug“ / „Ihrem Umzug“. */
  deinDat: string;
  /** Satzanfang: „Dein Umzug“ / „Ihr Umzug“. */
  deinNom: string;
  /** „des Umzugs“. */
  genitiv: string;
  /** Letzter Schritt in der Fortschrittsleiste. */
  stufe: string;
  termin: string;
  /** „Umzugsteam“; ohne eigenes Wort nur „Team“. */
  team: string;
  abgeschlossen: string;
  /** Schlusssatz nach erledigtem Auftrag. */
  abschlussWunsch: string;
  /** Umzug: Abholung und Ziel. Sonst ein einziger Einsatzort. */
  adressen: "strecke" | "einsatzort";
  einsatzortLabel: string;
  inventarTitel: string;
  volumenLabel: string;
  /** Umzugs-Checkliste (Packen, Halteverbot …) zeigen. */
  checkliste: boolean;
  /** Umzugs-Standardleistungen (Decken, Möbelhund, Kartons …) zeigen. */
  standardleistungen: boolean;
}

type Paar = readonly [sie: string, du: string];

interface Vorlage {
  name: string;
  akkusativ: string;
  deinAkk: Paar;
  deinDat: Paar;
  deinNom: Paar;
  genitiv: string;
  stufe: string;
  termin: string;
  team: string;
  abgeschlossen: string;
  abschlussWunsch: Paar;
  adressen: "strecke" | "einsatzort";
  einsatzortLabel: string;
  inventarTitel: string;
  volumenLabel: string;
  checkliste: boolean;
  standardleistungen: boolean;
}

const UMZUG_WUNSCH: Paar = [
  "Wir wünschen Ihnen viel Freude in Ihrem neuen Zuhause.",
  "Wir wünschen dir viel Freude in deinem neuen Zuhause.",
];

const VORLAGEN: Record<PortalLeistung, Vorlage> = {
  move: {
    name: "Umzug",
    akkusativ: "den Umzug",
    deinAkk: ["Ihren Umzug", "deinen Umzug"],
    deinDat: ["Ihrem Umzug", "deinem Umzug"],
    deinNom: ["Ihr Umzug", "Dein Umzug"],
    genitiv: "des Umzugs",
    stufe: "Umzug",
    termin: "Umzugstermin",
    team: "Umzugsteam",
    abgeschlossen: "Umzug abgeschlossen",
    abschlussWunsch: UMZUG_WUNSCH,
    adressen: "strecke",
    einsatzortLabel: "Einsatzort",
    inventarTitel: "Möbelliste",
    volumenLabel: "Umzugsvolumen",
    checkliste: true,
    standardleistungen: true,
  },
  kitchen_installation: {
    name: "Küchenmontage",
    akkusativ: "die Küchenmontage",
    deinAkk: ["Ihre Küchenmontage", "deine Küchenmontage"],
    deinDat: ["Ihrer Küchenmontage", "deiner Küchenmontage"],
    deinNom: ["Ihre Küchenmontage", "Deine Küchenmontage"],
    genitiv: "der Montage",
    stufe: "Montage",
    termin: "Montagetermin",
    team: "Montageteam",
    abgeschlossen: "Montage abgeschlossen",
    abschlussWunsch: [
      "Wir wünschen Ihnen viel Freude mit Ihrer neuen Küche.",
      "Wir wünschen dir viel Freude mit deiner neuen Küche.",
    ],
    adressen: "einsatzort",
    einsatzortLabel: "Montageort",
    inventarTitel: "Küchenteile",
    volumenLabel: "Volumen",
    checkliste: false,
    standardleistungen: false,
  },
  clearance: {
    name: "Entrümpelung",
    akkusativ: "die Entrümpelung",
    deinAkk: ["Ihre Entrümpelung", "deine Entrümpelung"],
    deinDat: ["Ihrer Entrümpelung", "deiner Entrümpelung"],
    deinNom: ["Ihre Entrümpelung", "Deine Entrümpelung"],
    genitiv: "der Entrümpelung",
    stufe: "Entrümpelung",
    termin: "Termin",
    team: "Team",
    abgeschlossen: "Entrümpelung abgeschlossen",
    abschlussWunsch: [
      "Wir hoffen, Sie sind mit dem Ergebnis zufrieden.",
      "Wir hoffen, du bist mit dem Ergebnis zufrieden.",
    ],
    adressen: "einsatzort",
    einsatzortLabel: "Einsatzort",
    inventarTitel: "Gegenstände",
    volumenLabel: "Volumen",
    checkliste: false,
    standardleistungen: false,
  },
  clearance_move: {
    name: "Entrümpelung und Umzug",
    akkusativ: "die Entrümpelung und den Umzug",
    deinAkk: ["Ihren Auftrag", "deinen Auftrag"],
    deinDat: ["Ihrem Auftrag", "deinem Auftrag"],
    deinNom: ["Ihr Auftrag", "Dein Auftrag"],
    genitiv: "des Auftrags",
    stufe: "Umzug",
    termin: "Termin",
    team: "Team",
    abgeschlossen: "Auftrag abgeschlossen",
    abschlussWunsch: UMZUG_WUNSCH,
    adressen: "strecke",
    einsatzortLabel: "Einsatzort",
    inventarTitel: "Möbelliste",
    volumenLabel: "Volumen",
    checkliste: true,
    standardleistungen: true,
  },
};

/** Alle Wörter einer Leistung in der Anrede der Firma (Kottke du, sonst Sie). */
export function leistungsWorte(leistung: PortalLeistung | null | undefined, firma: string | null | undefined): LeistungsWorte {
  const v = VORLAGEN[leistung ?? "move"] ?? VORLAGEN.move;
  const i = kundenAnrede(firma) === "du" ? 1 : 0;
  return {
    ...v,
    deinAkk: v.deinAkk[i],
    deinDat: v.deinDat[i],
    deinNom: v.deinNom[i],
    abschlussWunsch: v.abschlussWunsch[i],
  };
}

/**
 * Leistung aus freiem Text (Angebotstext, Positionen, Deal-Titel). Nur ein
 * Vorschlag für den KV-Dialog und für neue Angebote ohne Angabe; der Mensch
 * oder der Bot kann ihn jederzeit überschreiben.
 */
export function leistungAusText(text: string | null | undefined): PortalLeistung | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  const kueche = /küchen(?:montage|aufbau|einbau)|küche(?:nzeile)? (?:montieren|aufbauen|einbauen)|ikea-küche|kücheneinbau|einbauküche montage/.test(t);
  const entruempelung = /entrümpel|haushaltsauflösung|wohnungsauflösung|räumung|sperrmüll/.test(t);
  const umzug = /umzug|umziehen|umzieh/.test(t);
  if (entruempelung && umzug) return "clearance_move";
  if (entruempelung) return "clearance";
  if (kueche && !umzug) return "kitchen_installation";
  return null;
}
