/**
 * Ansichtsmodell der Kalkulationsseite (Plan 4, Task 3). Der Server baut es
 * aus der gespeicherten Version (`ansichtAus`), die Seite zeigt es nur an.
 * Reine Typen und reine Funktionen, ohne Server-Importe: die Oberfläche
 * importiert diese Datei.
 */
import type { GrundlageKey, Herkunft, UebersteuerungsArt } from "./kalkulation-versionen";

export type GrundlageFeldTyp = "zahl" | "ganzzahl" | "aufzug" | "ja_nein" | "datum";

export interface GrundlageFeld {
  key: GrundlageKey;
  label: string;
  typ: GrundlageFeldTyp;
  wert: unknown;
}

export interface GrundlageAnsichtZeile {
  /** "volumen" | "beladen" | "entladen" | "halteverbot" | "kartons" | "montage" | "team" | "termin" */
  key: string;
  label: string;
  wert: string;
  herkunft: { art: Herkunft | "BOT"; text: string }[];
  warum: string | null;
  bearbeitet: { von: string; am: string; grund: string } | null;
  /** Leer = nicht direkt bearbeitbar (Montage: über Zeitposten). */
  felder: GrundlageFeld[];
}

export interface GrundlageAnsicht {
  fotos: { id: string; url: string; treffer: { name: string; volumenCbm: number | null }[] }[];
  fotosGesamt: number;
  zeilen: GrundlageAnsichtZeile[];
  adressen: { beladen: string | null; entladen: string | null };
}

export interface SelbstkostenUnterzeile {
  key: string;
  label: string;
  formel: string | null;
  /** Fertiger Anzeigewert, z. B. "15,8 h" oder "120 €" */
  wert: string;
  uebersteuert: boolean;
}

export interface SelbstkostenGruppe {
  key: string;
  label: string;
  formel: string | null;
  betragCent: number;
  uebersteuert: boolean;
  unterzeilen: SelbstkostenUnterzeile[];
}

export interface SelbstkostenAnsicht {
  gruppen: SelbstkostenGruppe[];
  zwischensummeCent: number;
  gemeinkosten: { prozent: number; betragCent: number } | null;
  versicherungCent: number | null;
  selbstkostenCent: number;
  tarifText: string | null;
}

export interface MargeAnsicht {
  vorschlagProzent: number | null;
  gewaehltProzent: number | null;
  gewaehltVon: string | null;
  gruende: { text: string; punkte: number }[];
  min: 30;
  max: 60;
  rundungEur: number;
  selbstkostenEur: number;
}

export interface PreisAnsicht {
  /** "Preis = 1.533 € ÷ (1 − 0,38)" */
  formel: string;
  /** Selbstkosten ÷ (1 − Marge/100) als Text, nur Anzeige */
  preisRohText: string | null;
  gerundetCent: number | null;
  gewinnCent: number | null;
  listenpreisCent: number | null;
  spanne: { vonCent: number; bisCent: number } | null;
}

export interface KvAnsicht {
  posten: { text: string; betragCent: number; herkunft: string }[];
  summeCent: number;
  /** true = Entwurf (aus angebotsUebernahme), false = gesperrte kvItems */
  vorschau: boolean;
  /** true bei Spanne: Summe ist die Obergrenze */
  obergrenze: boolean;
}

export interface AnpassungAnsicht {
  id: string;
  art: UebersteuerungsArt;
  key: string;
  /** "{Bezeichnung}: {Wert}" */
  text: string;
  von: string;
  am: string;
  grund: string;
}

export interface KalkulationsAnsicht {
  kopf: {
    name: string;
    strecke: string;
    termin: string | null;
    aktenLink: string;
    schritt: string;
    /** zweite Kopfzeile: "{Name}, {Art} {Strecke}, {Termin}" */
    unterzeile: string;
  };
  versionen: { version: number; status: "entwurf" | "gesperrt"; preisCent: number | null; aktiv: boolean; gesendet: string | null }[];
  version: {
    nummer: number;
    status: "entwurf" | "gesperrt";
    bearbeitbar: boolean;
    /** "v2 gesperrt · gesendet Di 04.11. 11:40" bzw. null beim Entwurf */
    gesperrtText: string | null;
    veraltet: boolean;
    fehler: string | null;
    tarif: string | null;
    kvDokument: { id: string; fileName: string } | null;
    sperrbar: boolean;
    sperrGrund: string | null;
    /** "fest" | "stunden" */
    preisModus: "fest" | "stunden";
    renderer: "crm" | "vps";
  };
  grundlage: GrundlageAnsicht;
  selbstkosten: SelbstkostenAnsicht;
  marge: MargeAnsicht;
  preis: PreisAnsicht;
  kv: KvAnsicht | null;
  kvFehler: string | null;
  pakete: { slug: string; name: string; preisCent: number | null; hinweis: string | null }[];
  /** Link aufs alte Angebotsformular (Pakete, Stunden) */
  angebotsformularLink: string;
  anpassungen: AnpassungAnsicht[];
  zeitpostenVorlagen: { id: string; bezeichnung: string; minuten: number }[];
}
