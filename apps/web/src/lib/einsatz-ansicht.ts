/**
 * Antwort von `GET /api/v1/deals/[recordId]/einsatz` (Plan 12a, Entscheidung 7).
 * Rein, nur Typen: der Einsatz-Dialog rechnet Summen im Browser mit den
 * Funktionen aus `lib/einsatz.ts` neu. Der Vorschlag wird nie gespeichert.
 */
import type {
  Anfahrt,
  AuslastungAnzeige,
  EinsatzKostenZeile,
  EinsatzPerson,
  KapazitaetTag,
  LohnVergleich,
  PersonLage,
  TeamVorschlag,
  TransporterBuchung,
  BuchungZuordnung,
  Zuteilung,
} from "./einsatz";

export interface EinsatzZuteilung extends Zuteilung {
  confirmedAt: string | null;
}

export interface EinsatzPersonLage extends EinsatzPerson {
  /** Lage über alle Tage des Umzugs, ohne den eigenen Deal gerechnet. */
  lage: PersonLage;
  /** Andere feste Umzüge an einem Tag dieses Umzugs. */
  belegtMit: Array<{ dealId: string; titel: string }>;
  /** Art der Abwesenheit an einem Tag dieses Umzugs. */
  abwesend: "urlaub" | "krank" | "gesperrt" | null;
  /** Gerade für diesen Auftrag eingestempelt (Entfernen geht nicht). */
  stempeltGerade: boolean;
}

/** Was der Browser braucht, um Minuten und Lohn bei jeder Auswahl neu zu rechnen. */
export interface EinsatzRechnerDaten {
  groesse: number | null;
  auftragsart: string | null;
  fahrtMin: number | null;
  personenH: number | null;
  personalStunden: { arbeitPm: number; fahrerPm: number; fahrzeitPm: number; pufferProzent: number } | null;
  /** Nur die Zeilen, die Team und Fahrzeug betreffen (`personal.*`, `anfahrtsgeld`, `fahrzeug.*`). */
  posten: Array<{ key: string; betrag: number }>;
  festpreisEur: number | null;
  selbstkostenEur: number | null;
  fahrzeugName: string | null;
  fahrzeugEur: number | null;
  /** Mietstation der Kalkulation (Name), falls bekannt. */
  station: string | null;
  /** Rechner nennt Fahrzeugoptionen der Empfehlung. */
  empfehlung: { id: string; name: string; fahrten: number; km: number } | null;
}

export interface EinsatzAnsicht {
  dealId: string;
  titel: string | null;
  firmaId: string | null;
  /** Tage des Umzugs (Plan), leer ohne Termin. */
  tage: string[];
  /** Fester Termin (jade oder gold im Plan)? */
  fest: boolean;
  version: { nummer: number; status: "entwurf" | "gesperrt" } | null;
  beladen: string | null;
  entladen: string | null;
  team: EinsatzZuteilung[];
  /** Alle aktiven Personen plus inaktive aus dem heutigen Team. */
  personen: EinsatzPersonLage[];
  kapazitaet: KapazitaetTag[];
  teamVorschlag: TeamVorschlag;
  rechner: EinsatzRechnerDaten | null;
  anfahrten: Anfahrt[];
  /** Für das heutige Team, sonst den Vorschlag. Der Browser rechnet bei jeder Auswahl neu. */
  einsatzKosten: EinsatzKostenZeile[];
  lohnVergleich: LohnVergleich;
  auslastung: AuslastungAnzeige;
  /** Übernommene „Anfahrt Team“ (Übersteuerung in Euro) der maßgeblichen Version, sonst null. */
  anfahrtUebernommenEur: number | null;
  /** 12b: zugeordnete Buchung und Buchungen der Firma, die einen Tag des Umzugs decken. */
  buchung: (TransporterBuchung & { text: string; zuordnungen: BuchungZuordnung[] }) | null;
  buchungenAmTag: Array<TransporterBuchung & { text: string; zuordnungen: BuchungZuordnung[] }>;
  /** 12b: Firmen-Schalter „Mietanteil im Preis“. */
  buchungImPreis: boolean;
  /** 12b: Übersteuerungen `station` und `fahrzeugklasse` der maßgeblichen Version (Rechner-IDs). */
  stationVorgabe: string | null;
  klasseVorgabe: string | null;
  hinweise: string[];
}

export interface EinsatzBestaetigenBody {
  team: Array<{ employeeId: string; role: "lead" | "helper"; plannedDriveMinutes: number | null; plannedWorkMinutes: number | null }>;
  bestaetigtAmTag?: string[];
}
