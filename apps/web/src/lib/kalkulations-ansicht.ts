/**
 * Ansichtsmodell der Kalkulationsseite (Plan 4, Task 3). Der Server baut es
 * aus der gespeicherten Version (`ansichtAus`), die Seite zeigt es nur an.
 * Reine Typen und reine Funktionen, ohne Server-Importe: die Oberfläche
 * importiert diese Datei.
 */
import type { VersionsZeile } from "@/services/kalkulation-versionen";
import type { RechnerErgebnis } from "@/services/rechner/client";
import type { RechnerAnfrage } from "@/services/rechner/eingabe";
import { kvBausteine, strasseAus, aufzaehlen, type HebelArt } from "@/services/rechner/kv-posten";
import { MARGE_MAX_PROZENT, MARGE_MIN_PROZENT } from "@/services/rechner/marge";
import { angebotsUebernahme } from "@/services/rechner/uebernahme";
import { datumKurz, euroText, tagKurz, uhrzeitKurz, volumenText } from "./anzeige";
import {
  wirksameUebersteuerungen,
  type GrundlageKey,
  type Herkunft,
  type Uebersteuerung,
  type UebersteuerungsArt,
} from "./kalkulation-versionen";
import type { ZeitpostenVorlage } from "./zeitposten";

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
  /** Schlüssel der Rechner-Kostenzeile der Hauptzeile (`art: "zeile"`); null bei Summengruppen (Material, Weitere), dort nur die Unterzeilen. */
  postenKey: string | null;
  /** Betrag und Bezeichnung der Hauptzeile selbst (nicht die Gruppensumme): das zeigt der Anpassungs-Dialog; null bei Summengruppen. */
  postenBetragCent: number | null;
  postenLabel: string | null;
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
  /** Der Wert der Übersteuerung (Zahl, Text, ja/nein oder Posten), zum Vorbelegen beim Ändern. */
  wert: number | string | boolean | { bezeichnung: string; minuten?: number; betrag?: number } | null;
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
    /** Warum der Entwurf veraltet ist: "eingabe" (Lead oder Datum geändert, Neu rechnen hilft), "rechner" (Ergebnis ohne Montage-Echo, der Rechner ist noch nicht auf dem neuen Stand), null sonst. */
    veraltetGrund: "eingabe" | "rechner" | null;
    fehler: string | null;
    tarif: string | null;
    kvDokument: { id: string; fileName: string } | null;
    /** Gesperrt, ohne KV-Dokument und die neueste gesperrte Version: nur dann kann `POST …/kv` noch ein Dokument erzeugen. */
    kvErstellbar: boolean;
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

// ─── Eingaben von `ansichtAus` ────────────────────────────────────────────────

/** Die Felder einer Zeile aus `deal_inventory_items`, die die Ansicht liest. */
export interface InventarZeile {
  name: string;
  quantity: number;
  moveFlag: boolean;
  source: "chat" | "foto" | "operator";
  photoAttachmentId: string | null;
  /** numeric aus der Datenbank (Text) */
  volumeCbmEstimate: string | number | null;
  dismantlingOwner: "company" | "customer" | "none";
  assemblyOwner: "company" | "customer" | "none";
}

/** Die Felder eines Anhangs aus `getAttachmentsForDeal`, die die Ansicht liest. */
export interface InboxAnhangZeile {
  id: string;
  mimeType: string;
  createdAt: Date | string;
  fileName?: string;
}

export interface AnsichtRest {
  alle: { version: number; status: "entwurf" | "gesperrt"; priceCents: number | null; sentAt?: Date | string | null }[];
  /** userId → Name */
  namen: Record<string, string>;
  /** `termin` als JJJJ-MM-TT (Lead), `art` als Wort („Umzug“) */
  deal: { name: string; art: string; strecke: string; termin: string | null; aktenLink: string };
  inventar: InventarZeile[];
  fotos: InboxAnhangZeile[];
  vorlagen: ZeitpostenVorlage[];
  angebot: { notes: string | null; isVariable: boolean; validUntil: string | null } | null;
  /** aus `entwurfVeraltet` (Server); bei gesperrten Versionen ignoriert */
  veraltet: boolean;
  kvDokument: { id: string; fileName: string } | null;
  jetzt: Date;
  hatPakete?: boolean;
  /** Paket-Slug → Anzeigename */
  paketNamen?: Record<string, string>;
  renderer?: "crm" | "vps";
}

// ─── Anzeige ──────────────────────────────────────────────────────────────────

const KOMMA1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const KOMMA2 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });
const KOMMA3 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
const GANZ = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

const cent = (eur: number) => Math.round(eur * 100);

/** „1.533 €“ (auf ganze Euro gerundet, nur Anzeige). */
export function euroGanzText(eur: number): string {
  return `${GANZ.format(Math.round(eur))} €`;
}

/** „19,5 h“ */
export function stundenText(h: number): string {
  return `${KOMMA1.format(h)} h`;
}

/** „20 min“, ab einer Stunde „1,5 h“. */
export function dauerText(minuten: number): string {
  return minuten < 60 ? `${GANZ.format(minuten)} min` : stundenText(minuten / 60);
}

/** 0 → „EG“, 0,5 → „Hochparterre“, 2 → „2. OG“, -1 → „1. UG“. */
export function etageText(etage: number): string {
  if (etage === 0) return "EG";
  if (etage === 0.5) return "Hochparterre";
  return etage < 0 ? `${KOMMA1.format(-etage)}. UG` : `${KOMMA1.format(etage)}. OG`;
}

export const AUFZUG_TEXT: Record<string, string> = { keiner: "kein Aufzug", klein: "kleiner Aufzug", gross: "großer Aufzug" };

/** „04.11. 10:48“ in Berlin. */
export function zeitpunktText(wert: Date | string): string {
  const iso = typeof wert === "string" ? wert : wert.toISOString();
  return `${datumKurz(iso)} ${uhrzeitKurz(iso)}`;
}

function personenText(n: number): string {
  return n === 1 ? "1 Person" : `${GANZ.format(n)} Personen`;
}

function zahl(w: unknown): number | null {
  if (typeof w === "number") return Number.isFinite(w) ? w : null;
  if (typeof w === "string" && w.trim() !== "") {
    const n = Number(w.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function text(w: unknown): string | null {
  return typeof w === "string" && w.trim() !== "" ? w : null;
}

function vorname(name: string | undefined): string | null {
  const erster = (name ?? "").trim().split(/\s+/)[0];
  return erster ? erster : null;
}

/** Name für „von“: Agent „Bot“, Mensch Vorname. */
function autorName(autor: Uebersteuerung["autor"], namen: Record<string, string>): string {
  if (autor.quelle === "agent") return "Bot";
  return (autor.userId ? vorname(namen[autor.userId]) : null) ?? "Unbekannt";
}

type HerkunftEintrag = GrundlageAnsichtZeile["herkunft"][number];

function herkunftEintrag(art: Herkunft, u: Uebersteuerung | undefined, namen: Record<string, string>): HerkunftEintrag {
  if (art !== "MANUELL" || !u) return { art, text: art };
  if (u.autor.quelle === "agent") return { art: "BOT", text: "BOT" };
  const name = u.autor.userId ? vorname(namen[u.autor.userId]) : null;
  return { art: "MANUELL", text: name ? name.toLocaleUpperCase("de-DE") : "MANUELL" };
}

/** „Kunde“, „Standard“, „Dario“, „Bot“ (für Sätze wie „Tragweg 25 m (Kunde)“). */
function herkunftWort(h: HerkunftEintrag): string {
  const t = h.text.toLocaleLowerCase("de-DE");
  return t.charAt(0).toLocaleUpperCase("de-DE") + t.slice(1);
}

function eindeutig(xs: HerkunftEintrag[]): HerkunftEintrag[] {
  const gesehen = new Set<string>();
  return xs.filter((h) => {
    const k = `${h.art}\u0000${h.text}`;
    if (gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
}

const normName = (s: string) => s.trim().toLocaleLowerCase("de-DE");

// ─── Grundlage ────────────────────────────────────────────────────────────────

const FOTOS_MAX = 14;

const GRUNDLAGE_LABEL: Record<GrundlageKey, string> = {
  volumen: "Volumen",
  "beladen.etage": "Etage beim Beladen",
  "beladen.aufzug": "Aufzug beim Beladen",
  "beladen.tragweg": "Tragweg beim Beladen",
  "entladen.etage": "Etage beim Entladen",
  "entladen.aufzug": "Aufzug beim Entladen",
  "entladen.tragweg": "Tragweg beim Entladen",
  "halteverbot.beladen": "Halteverbot beim Beladen",
  "halteverbot.entladen": "Halteverbot beim Entladen",
  kartons: "Kartons",
  team: "Team",
  termin: "Termin",
};

/** Anzeigewert eines Grundlage-Feldes („2. OG“, „kein Aufzug“, „25 m“, „ja“). */
function grundlageWertText(key: GrundlageKey, wert: unknown): string {
  if (wert === null || wert === undefined) return "offen";
  switch (key) {
    case "volumen": {
      const n = zahl(wert);
      return n === null ? String(wert) : volumenText(n);
    }
    case "beladen.etage":
    case "entladen.etage": {
      const n = zahl(wert);
      return n === null ? String(wert) : etageText(n);
    }
    case "beladen.aufzug":
    case "entladen.aufzug":
      return AUFZUG_TEXT[String(wert)] ?? String(wert);
    case "beladen.tragweg":
    case "entladen.tragweg": {
      const n = zahl(wert);
      return n === null ? String(wert) : `${KOMMA1.format(n)} m`;
    }
    case "halteverbot.beladen":
    case "halteverbot.entladen":
      return wert === true ? "ja" : "nein";
    case "kartons": {
      const n = zahl(wert);
      return n === null ? String(wert) : `${GANZ.format(n)} Stück`;
    }
    case "team": {
      const n = zahl(wert);
      return n === null ? String(wert) : personenText(n);
    }
    case "termin":
      return typeof wert === "string" && /^\d{4}-\d{2}-\d{2}$/.test(wert) ? tagKurz(wert) : String(wert);
  }
}

interface GrundlageKontext {
  wert: (key: GrundlageKey) => string | number | boolean | null;
  herkunft: (key: GrundlageKey) => HerkunftEintrag;
  bearbeitet: (keys: GrundlageKey[]) => GrundlageAnsichtZeile["bearbeitet"];
}

function grundlageKontext(v: VersionsZeile, namen: Record<string, string>): GrundlageKontext {
  const inputs = new Map((v.inputs ?? []).map((z) => [z.key, z]));
  const eingaben = new Map<string, Uebersteuerung>();
  for (const u of wirksameUebersteuerungen(v.overrides ?? [])) {
    if (u.art === "eingabe" && typeof u.wert !== "object") eingaben.set(u.key, u);
  }
  return {
    // Eine wirksame Übersteuerung gewinnt, auch wenn die letzte Rechnung sie noch nicht kennt.
    wert: (key) => {
      const u = eingaben.get(key);
      if (u) return u.wert as string | number | boolean;
      return inputs.get(key)?.wert ?? null;
    },
    herkunft: (key) => {
      const u = eingaben.get(key);
      if (u) return herkunftEintrag("MANUELL", u, namen);
      return herkunftEintrag(inputs.get(key)?.herkunft ?? "STANDARD", undefined, namen);
    },
    bearbeitet: (keys) => {
      const letzte = keys
        .map((k) => eingaben.get(k))
        .filter((u): u is Uebersteuerung => !!u)
        .sort((a, b) => b.zeit.localeCompare(a.zeit))[0];
      return letzte ? { von: autorName(letzte.autor, namen), am: zeitpunktText(letzte.zeit), grund: letzte.grund } : null;
    },
  };
}

function feld(key: GrundlageKey, label: string, typ: GrundlageFeldTyp, k: GrundlageKontext): GrundlageFeld {
  return { key, label, typ, wert: k.wert(key) };
}

function seitenZeile(
  seite: "beladen" | "entladen",
  adresse: string | null,
  k: GrundlageKontext
): GrundlageAnsichtZeile {
  const etageKey = `${seite}.etage` as GrundlageKey;
  const aufzugKey = `${seite}.aufzug` as GrundlageKey;
  const tragwegKey = `${seite}.tragweg` as GrundlageKey;
  const etage = zahl(k.wert(etageKey));
  const aufzug = text(k.wert(aufzugKey));
  const teile = [etage !== null ? etageText(etage) : null, aufzug ? AUFZUG_TEXT[aufzug] ?? aufzug : null].filter(
    (t): t is string => t !== null
  );
  const tragweg = zahl(k.wert(tragwegKey));
  const tragwegHerkunft = k.herkunft(tragwegKey);
  const herkunft = [k.herkunft(etageKey), k.herkunft(aufzugKey)];
  if (tragwegHerkunft.art === "MANUELL" || tragwegHerkunft.art === "BOT") herkunft.push(tragwegHerkunft);
  const strasse = strasseAus(adresse);
  return {
    key: seite,
    label: `${seite === "beladen" ? "Beladen" : "Entladen"}${strasse ? ` · ${strasse}` : ""}`,
    wert: teile.length > 0 ? teile.join(", ") : "keine Angaben",
    herkunft: eindeutig(herkunft),
    warum: tragweg === null ? "Tragweg Standard des Rechners" : `Tragweg ${KOMMA1.format(tragweg)} m (${herkunftWort(tragwegHerkunft)})`,
    bearbeitet: k.bearbeitet([etageKey, aufzugKey, tragwegKey]),
    felder: [
      feld(etageKey, "Etage", "zahl", k),
      feld(aufzugKey, "Aufzug", "aufzug", k),
      feld(tragwegKey, "Tragweg in m", "zahl", k),
    ],
  };
}

function grundlageAnsicht(v: VersionsZeile, rest: AnsichtRest): GrundlageAnsicht {
  const k = grundlageKontext(v, rest.namen);
  const e = v.rechnerResult;
  const anfrage = v.rechnerRequest ?? {};
  const mitnehmen = rest.inventar.filter((i) => i.moveFlag && i.quantity > 0);

  // Volumen: Herkunft aus dem Inventar (Foto, Chat), sonst aus der Grundlage.
  const volumenHerkunft = ((): HerkunftEintrag[] => {
    const h = k.herkunft("volumen");
    if (h.art === "MANUELL" || h.art === "BOT") return [h];
    const quellen = new Set(mitnehmen.map((i) => i.source));
    const aus: HerkunftEintrag[] = [];
    if (quellen.has("foto")) aus.push({ art: "FOTO", text: "FOTO" });
    if (quellen.has("chat")) aus.push({ art: "CHAT", text: "CHAT" });
    if (aus.length === 0 && quellen.has("operator")) aus.push({ art: "MANUELL", text: "MANUELL" });
    return aus.length > 0 ? aus : [h];
  })();
  const teile = mitnehmen.reduce((s, i) => s + i.quantity, 0);
  const volumen = zahl(k.wert("volumen"));

  const hvBeladen = k.wert("halteverbot.beladen") === true;
  const hvEntladen = k.wert("halteverbot.entladen") === true;
  const kartons = zahl(k.wert("kartons"));

  // Montage: zerlegte Positionen des Rechners; Eigentümer im Inventar = von Hand festgelegt.
  const positionen = e?.positionen ?? [];
  const zerlegt = [...new Set(positionen.filter((p) => p.zerlegt).map((p) => p.name.trim()).filter(Boolean))];
  const firmaBaut = new Set(
    mitnehmen.filter((i) => i.dismantlingOwner === "company" || i.assemblyOwner === "company").map((i) => normName(i.name))
  );
  const eigentuemer = mitnehmen.some((i) => i.dismantlingOwner !== "none" || i.assemblyOwner !== "none");
  const ohneKatalog = positionen.filter((p) => p.ungeprueft && (p.zerlegt || firmaBaut.has(normName(p.name)))).length;

  const team = zahl(k.wert("team"));
  const option = e?.fahrzeugoptionen?.find((o) => o.id === e.empfehlungOptionId) ?? null;
  const termin = text(k.wert("termin"));

  const zeilen: GrundlageAnsichtZeile[] = [
    {
      key: "volumen",
      label: "Volumen",
      wert: volumen === null ? "offen" : volumenText(volumen),
      herkunft: volumenHerkunft,
      warum: teile > 0 ? `${GANZ.format(teile)} ${teile === 1 ? "Teil" : "Teile"} erkannt` : null,
      bearbeitet: k.bearbeitet(["volumen"]),
      felder: [feld("volumen", "Volumen in m³", "zahl", k)],
    },
    seitenZeile("beladen", text(anfrage.von_adresse), k),
    seitenZeile("entladen", text(anfrage.nach_adresse), k),
    {
      key: "halteverbot",
      label: "Halteverbot",
      wert: hvBeladen && hvEntladen ? "beidseitig" : hvBeladen ? "beim Beladen" : hvEntladen ? "beim Entladen" : "keins",
      herkunft: eindeutig(
        hvBeladen || hvEntladen
          ? [hvBeladen ? k.herkunft("halteverbot.beladen") : null, hvEntladen ? k.herkunft("halteverbot.entladen") : null].filter(
              (h): h is HerkunftEintrag => h !== null
            )
          : [k.herkunft("halteverbot.beladen"), k.herkunft("halteverbot.entladen")]
      ),
      warum: null,
      bearbeitet: k.bearbeitet(["halteverbot.beladen", "halteverbot.entladen"]),
      felder: [
        feld("halteverbot.beladen", "beim Beladen", "ja_nein", k),
        feld("halteverbot.entladen", "beim Entladen", "ja_nein", k),
      ],
    },
    {
      key: "kartons",
      label: "Kartons",
      wert: kartons !== null && kartons > 0 ? `${GANZ.format(kartons)} Stück` : "keine",
      herkunft: [k.herkunft("kartons")],
      warum: null,
      bearbeitet: k.bearbeitet(["kartons"]),
      felder: [feld("kartons", "Kartons", "ganzzahl", k)],
    },
    {
      key: "montage",
      label: "Montage",
      wert: zerlegt.length > 0 ? aufzaehlen(zerlegt) : "keine",
      herkunft: [eigentuemer ? { art: "MANUELL", text: "MANUELL" } : { art: "REGEL", text: "REGEL" }],
      warum:
        ohneKatalog > 0
          ? `${ohneKatalog} ${ohneKatalog === 1 ? "Position" : "Positionen"} ohne Katalogzeit, bitte Zeitposten anlegen`
          : null,
      bearbeitet: null,
      felder: [],
    },
    {
      key: "team",
      label: "Team",
      wert: team === null ? "offen" : personenText(team),
      herkunft: [k.herkunft("team")],
      warum: option ? `${option.name} · ${option.fahrten} ${option.fahrten === 1 ? "Tour" : "Touren"}` : null,
      bearbeitet: k.bearbeitet(["team"]),
      felder: [feld("team", "Team", "ganzzahl", k)],
    },
    {
      key: "termin",
      label: "Termin",
      wert: termin ? grundlageWertText("termin", termin) : "offen",
      herkunft: [k.herkunft("termin")],
      warum: null,
      bearbeitet: k.bearbeitet(["termin"]),
      felder: [feld("termin", "Termin", "datum", k)],
    },
  ];

  const zeit = (d: Date | string) => (typeof d === "string" ? new Date(d) : d).getTime();
  const bilder = rest.fotos
    .filter((f) => typeof f.mimeType === "string" && f.mimeType.toLowerCase().startsWith("image/"))
    .sort((a, b) => zeit(b.createdAt) - zeit(a.createdAt));
  const fotos = bilder.slice(0, FOTOS_MAX).map((f) => ({
    id: f.id,
    url: `/api/v1/inbox/attachments/${f.id}/content`,
    treffer: rest.inventar
      .filter((i) => i.photoAttachmentId === f.id)
      .map((i) => ({ name: i.name, volumenCbm: zahl(i.volumeCbmEstimate) })),
  }));

  return {
    fotos,
    fotosGesamt: bilder.length,
    zeilen,
    adressen: { beladen: text(anfrage.von_adresse), entladen: text(anfrage.nach_adresse) },
  };
}

// ─── Selbstkosten ─────────────────────────────────────────────────────────────

type Posten = NonNullable<NonNullable<RechnerErgebnis["kosten"]>["posten"]>[number];

function formelVon(p: Posten): string | null {
  if (p.formel) return p.formel;
  if (p.menge === null || p.einheit === null || p.satz === null) return null;
  return `${KOMMA2.format(p.menge)} ${p.einheit} × ${KOMMA2.format(p.satz)} €`;
}

function selbstkostenAnsicht(v: VersionsZeile, namen: Record<string, string>): SelbstkostenAnsicht {
  const e = v.rechnerResult;
  const alle = e?.kosten?.posten ?? [];
  const markiert = new Map((v.costLines ?? []).map((c) => [c.key, c.uebersteuert]));
  const zeilen = alle.map((p, i) => {
    const key = p.key ?? `zeile.${i}`;
    return { p, key, uebersteuert: p.quelle === "uebersteuert" || markiert.get(key) === true };
  });
  type Z = (typeof zeilen)[number];

  const gruppeVon = (key: string): string => {
    if (key === "personal.arbeit") return "arbeit";
    if (key === "personal.fahrt") return "fahrt";
    if (key.startsWith("fahrzeug.")) return `fahrzeug.${key.split(".")[1]}`;
    if (key.startsWith("halteverbot")) return "halteverbot";
    if (key.startsWith("material.") || key.startsWith("material_frei.")) return "material";
    if (key.startsWith("anfahrtsgeld")) return "anfahrt";
    if (key.startsWith("entsorgung")) return "entsorgung";
    if (key.startsWith("gemeinkosten")) return "gemeinkosten";
    if (key.startsWith("versicherung")) return "versicherung";
    return "weitere";
  };
  const buckets = new Map<string, Z[]>();
  for (const z of zeilen) {
    const g = gruppeVon(z.key);
    buckets.set(g, [...(buckets.get(g) ?? []), z]);
  }
  const summeCent = (zs: Z[]) => zs.reduce((s, z) => s + cent(z.p.betrag), 0);
  const unterzeile = (z: Z, label = z.p.bezeichnung): SelbstkostenUnterzeile => ({
    key: z.key,
    label,
    formel: formelVon(z.p),
    wert: euroText(cent(z.p.betrag)),
    uebersteuert: z.uebersteuert,
  });

  const LABEL: Record<string, string> = {
    arbeit: "Arbeit",
    fahrt: "Fahrt",
    halteverbot: "Halteverbot",
    material: "Material",
    anfahrt: "Anfahrt",
    entsorgung: "Entsorgung",
    weitere: "Weitere Kosten",
  };

  /** Hauptzeile = erste Zeile, weitere Zeilen darunter. */
  const einfach = (key: string, zs: Z[], extra: SelbstkostenUnterzeile[] = []): SelbstkostenGruppe => ({
    key,
    postenKey: zs[0].key,
    postenBetragCent: cent(zs[0].p.betrag),
    postenLabel: zs[0].p.bezeichnung,
    label: LABEL[key],
    formel: formelVon(zs[0].p),
    betragCent: summeCent(zs),
    uebersteuert: zs.some((z) => z.uebersteuert),
    unterzeilen: [...zs.slice(1).map((z) => unterzeile(z)), ...extra],
  });
  /** Summe, jede Zeile darunter. */
  const sammel = (key: string, zs: Z[]): SelbstkostenGruppe => ({
    key,
    postenKey: null,
    postenBetragCent: null,
    postenLabel: null,
    label: LABEL[key],
    formel: null,
    betragCent: summeCent(zs),
    uebersteuert: zs.some((z) => z.uebersteuert),
    unterzeilen: zs.map((z) => unterzeile(z)),
  });

  const arbeitUnterzeilen = (): SelbstkostenUnterzeile[] => {
    const aus: SelbstkostenUnterzeile[] = [];
    const u = (key: string, label: string, wert: string, uebersteuert = false) =>
      aus.push({ key, label, formel: null, wert, uebersteuert });
    const ps = e?.kosten?.personalStunden;
    if (ps) {
      u("arbeit.laden", "Laden, Tragen, Montage", stundenText(ps.arbeitPm / 60));
      if (ps.fahrerPm > 0) u("arbeit.uebergabe", "Fahrzeugübergabe", stundenText(ps.fahrerPm / 60));
      u("arbeit.puffer", `Puffer ${KOMMA1.format(ps.pufferProzent)} %`, `+${stundenText(((ps.arbeitPm + ps.fahrerPm) / 60) * (ps.pufferProzent / 100))}`);
      const team = e?.team?.groesse ?? null;
      u(
        "arbeit.personenstunden",
        `= ${KOMMA1.format(ps.personenH)} Personenstunden`,
        team && team > 0 ? `${KOMMA1.format(ps.personenH / team)} h je Person` : stundenText(ps.personenH)
      );
    }
    for (const z of wirksameUebersteuerungen(v.overrides ?? [])) {
      if (z.art !== "zeitposten" || !z.wert || typeof z.wert !== "object") continue;
      u(`zeitposten.${z.key}`, `${z.wert.bezeichnung} · ${autorName(z.autor, namen)}`, `+${GANZ.format(z.wert.minuten ?? 0)} min`, true);
    }
    return aus;
  };

  const gruppen: SelbstkostenGruppe[] = [];
  const arbeit = buckets.get("arbeit");
  if (arbeit) gruppen.push(einfach("arbeit", arbeit, arbeitUnterzeilen()));
  const fahrt = buckets.get("fahrt");
  if (fahrt) gruppen.push(einfach("fahrt", fahrt));
  for (const [key, zs] of buckets) {
    if (!key.startsWith("fahrzeug.")) continue;
    const haupt = zs.find((z) => /\.(miete|tagespauschale)$/.test(z.key)) ?? zs[0];
    const name = haupt.p.bezeichnung.split(":")[0].trim() || "Fahrzeug";
    const ohneName = (b: string) => (b.startsWith(`${name}:`) ? b.slice(name.length + 1).trim() : b);
    gruppen.push({
      key,
      postenKey: haupt.key,
      postenBetragCent: cent(haupt.p.betrag),
      postenLabel: haupt.p.bezeichnung,
      label: name,
      formel: formelVon(haupt.p),
      betragCent: summeCent(zs),
      uebersteuert: zs.some((z) => z.uebersteuert),
      unterzeilen: zs.filter((z) => z !== haupt).map((z) => unterzeile(z, ohneName(z.p.bezeichnung))),
    });
  }
  for (const key of ["halteverbot", "material", "anfahrt", "entsorgung", "weitere"]) {
    const zs = buckets.get(key);
    if (!zs) continue;
    gruppen.push(key === "material" || key === "weitere" ? sammel(key, zs) : einfach(key, zs));
  }

  const zwischensummeCent = gruppen.reduce((s, g) => s + g.betragCent, 0);
  const gk = buckets.get("gemeinkosten");
  const gkCent = gk ? summeCent(gk) : null;
  const vers = buckets.get("versicherung");
  const tarif = v.tariff ?? e?.tarif ?? null;
  return {
    gruppen,
    zwischensummeCent,
    gemeinkosten:
      gkCent === null ? null : { prozent: zwischensummeCent > 0 ? Math.round((gkCent / zwischensummeCent) * 100) : 0, betragCent: gkCent },
    versicherungCent: vers ? summeCent(vers) : null,
    selbstkostenCent: cent(e?.kosten?.selbstkosten ?? 0),
    tarifText: tarif ? `Tarif v${tarif.version} · Sätze aus Einstellungen` : null,
  };
}

// ─── Marge und Preis ──────────────────────────────────────────────────────────

function margeAnsicht(v: VersionsZeile, namen: Record<string, string>): MargeAnsicht {
  const e = v.rechnerResult;
  const p = e?.preis;
  const vorschlag = p?.margeVorschlag ?? e?.margeVorschlag ?? null;
  const ueber = wirksameUebersteuerungen(v.overrides ?? []).filter((u) => u.art === "marge").at(-1);
  const gewaehlt =
    ueber && typeof ueber.wert === "number"
      ? ueber.wert
      : p?.margeWirksamProzent ?? e?.schaetzung?.margeProzent ?? v.margin?.vorschlagProzent ?? vorschlag?.prozent ?? null;
  return {
    vorschlagProzent: v.margin?.vorschlagProzent ?? vorschlag?.prozent ?? null,
    gewaehltProzent: gewaehlt,
    gewaehltVon: ueber ? autorName(ueber.autor, namen) : null,
    gruende: v.margin?.gruende?.length ? v.margin.gruende : vorschlag?.gruende ?? [],
    min: MARGE_MIN_PROZENT,
    max: MARGE_MAX_PROZENT,
    rundungEur: p?.rundungEur ?? 10,
    selbstkostenEur: p?.selbstkosten ?? e?.schaetzung?.selbstkostenBis ?? e?.kosten?.selbstkosten ?? 0,
  };
}

function preisAnsicht(v: VersionsZeile, marge: MargeAnsicht): PreisAnsicht {
  const e = v.rechnerResult;
  const m = marge.gewaehltProzent;
  const selbst = marge.selbstkostenEur;
  const festpreis = e?.preis?.festpreis;
  const gerundetCent = typeof festpreis === "number" && Number.isFinite(festpreis) ? cent(festpreis) : null;
  const s = e?.schaetzung;
  return {
    formel:
      m === null
        ? `Preis = ${euroGanzText(selbst)} ÷ (1 − Marge)`
        : `Preis = ${euroGanzText(selbst)} ÷ (1 − ${KOMMA3.format(m / 100)})`,
    // Nur Anzeige: der Rechner rundet und prüft, das CRM rechnet keinen Preis.
    preisRohText: m !== null && m < 100 && selbst > 0 ? euroGanzText(selbst / (1 - m / 100)) : null,
    gerundetCent,
    gewinnCent: gerundetCent === null ? null : gerundetCent - cent(selbst),
    listenpreisCent: typeof e?.preis?.listenpreis === "number" ? cent(e.preis.listenpreis) : null,
    spanne: s && s.festpreisVon != null && s.festpreisBis != null ? { vonCent: cent(s.festpreisVon), bisCent: cent(s.festpreisBis) } : null,
  };
}

// ─── KV ───────────────────────────────────────────────────────────────────────

const HEBEL_TEXT: Record<HebelArt, string> = { montage: "Montage", halteverbot: "Halteverbot", einpacken: "Einpacken", kueche: "Küche" };

function hebelAusText(beschreibung: string): HebelArt | null {
  if (/^(Demontage|Montage)/.test(beschreibung)) return "montage";
  if (/^Halteverbot/.test(beschreibung)) return "halteverbot";
  if (/^Einpack/.test(beschreibung)) return "einpacken";
  if (/^Küche/.test(beschreibung)) return "kueche";
  return null;
}

/** Herkunft je KV-Posten: der erste ist der Kern, die übrigen sind Hebel (wie `kvBausteine`). */
function postenHerkunft(items: { description: string }[], e: RechnerErgebnis | null, anfrage: RechnerAnfrage | null): string[] {
  const arten = new Map<string, HebelArt>();
  const basis = e?.schaetzung ? e.schaetzung.festpreisBis : e?.preis?.festpreis;
  if (e && anfrage && typeof basis === "number" && basis > 0) {
    const kv = kvBausteine({ festpreis: basis, ergebnis: e, anfrage });
    kv.posten.slice(1).forEach((p, i) => {
      const art = kv.hebel[i]?.art;
      if (art) arten.set(p.description, art);
    });
  }
  return items.map((it, i) => {
    if (i === 0) return items.length > 1 ? "Rest nach den Hebeln" : "Gesamtpreis";
    const art = arten.get(it.description) ?? hebelAusText(it.description);
    return art ? HEBEL_TEXT[art] : "Weitere Leistung";
  });
}

function kvAnsicht(v: VersionsZeile, rest: AnsichtRest): { kv: KvAnsicht | null; kvFehler: string | null } {
  const e = v.rechnerResult;
  const posten = (items: { description: string; quantity: number; unitRate: number }[], vorschau: boolean): KvAnsicht => {
    const herkunft = postenHerkunft(items, e, v.rechnerRequest);
    const liste = items.map((it, i) => ({
      text: it.description,
      betragCent: Math.round(it.unitRate * 100) * it.quantity,
      herkunft: herkunft[i],
    }));
    return { posten: liste, summeCent: liste.reduce((s, p) => s + p.betragCent, 0), vorschau, obergrenze: !!e?.schaetzung };
  };

  if (v.status === "gesperrt") {
    return { kv: v.kvItems.length > 0 ? posten(v.kvItems, false) : null, kvFehler: null };
  }
  if (!e || !v.rechnerRequest) return { kv: null, kvFehler: "Noch keine Kalkulation vorhanden." };
  const u = angebotsUebernahme({ result: e, request: v.rechnerRequest }, rest.angebot, {
    bestaetigtSpanne: true,
    uebernommenVon: "mensch",
    jetzt: rest.jetzt,
  });
  if (!u.ok) return { kv: null, kvFehler: u.fehler };
  return {
    kv: posten(
      u.eingabe.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitRate: Number(li.unitRate) })),
      true
    ),
    kvFehler: null,
  };
}

// ─── Anpassungen ──────────────────────────────────────────────────────────────

function anpassungText(u: Uebersteuerung, v: VersionsZeile): string {
  switch (u.art) {
    case "eingabe": {
      const key = u.key as GrundlageKey;
      const label = GRUNDLAGE_LABEL[key] ?? u.key;
      return `${label}: ${GRUNDLAGE_LABEL[key] ? grundlageWertText(key, u.wert) : String(u.wert)}`;
    }
    case "zeile": {
      const posten = v.rechnerResult?.kosten?.posten;
      const imErgebnis = posten?.find((x) => x.key === u.key) ?? null;
      const p = imErgebnis ?? v.costLines.find((c) => c.key === u.key) ?? null;
      const wert = zahl(u.wert);
      const text = `${p?.bezeichnung ?? u.key}: ${wert === null ? String(u.wert) : euroText(cent(wert))}`;
      // Fahrzeugzeilen tragen die Mietstation im Schlüssel: wählt der Rechner eine andere
      // Station, trifft die Anpassung keine Zeile mehr und wirkt nicht.
      return posten && !imErgebnis ? `${text} (wirkt nicht, die Zeile gibt es nach dem Neurechnen nicht mehr)` : text;
    }
    case "marge":
      return `Marge: ${KOMMA1.format(zahl(u.wert) ?? 0)} %`;
    case "satz":
      return `Stundensatz ${u.key === "fahrt" ? "Fahrt" : "Arbeit"}: ${KOMMA2.format(zahl(u.wert) ?? 0)} €/h`;
    case "zeitposten": {
      const w = u.wert && typeof u.wert === "object" ? u.wert : null;
      return `${w?.bezeichnung ?? u.key}: +${dauerText(w?.minuten ?? 0)} Arbeit`;
    }
    case "material_frei": {
      const w = u.wert && typeof u.wert === "object" ? u.wert : null;
      return `${w?.bezeichnung ?? u.key}: ${euroText(cent(w?.betrag ?? 0))}`;
    }
  }
}

// ─── Ansicht ──────────────────────────────────────────────────────────────────

export const SPERRGRUND = {
  pakete: "Sperren mit Paketpreisen kommt später. Bis dahin den Preis über die Paketpreise pflegen.",
  stunden: "Sperren mit Stunden-KV kommt später. Bis dahin das Angebot über das Angebotsformular pflegen.",
  fehler: "Der Rechner hat einen Fehler gemeldet. Bitte neu rechnen.",
  ohneErgebnis: "Noch keine Kalkulation vorhanden. Bitte neu rechnen.",
  veraltet: "Die Kalkulation ist nicht mehr aktuell. Bitte zuerst neu rechnen.",
  rechner: "Der Rechner ist noch nicht auf dem neuen Stand. Sperren geht nach dem Rechner-Update.",
} as const;

/**
 * Ansichtsmodell einer Version aus dem gespeicherten Rechner-Ergebnis. Rechnet
 * keinen Preis: Festpreis, Selbstkosten und KV-Posten kommen aus dem Ergebnis
 * bzw. aus `angebotsUebernahme` (wie beim Sperren); nur der ungerundete Preis
 * der Formel ist eine Anzeige-Rechnung.
 */
export function ansichtAus(v: VersionsZeile, rest: AnsichtRest): KalkulationsAnsicht {
  const gesperrt = v.status === "gesperrt";
  const grundlage = grundlageAnsicht(v, rest);
  const selbstkosten = selbstkostenAnsicht(v, rest.namen);
  const marge = margeAnsicht(v, rest.namen);
  const preis = preisAnsicht(v, marge);
  const { kv, kvFehler } = kvAnsicht(v, rest);
  const veraltet = !gesperrt && rest.veraltet;
  // Ohne Montage-Echo im Ergebnis (Entscheidung 10) hilft kein Neu rechnen, solange der alte Rechner läuft.
  const veraltetGrund: "eingabe" | "rechner" | null = !veraltet
    ? null
    : v.rechnerResult && v.rechnerResult.montageJePosition !== true
      ? "rechner"
      : "eingabe";
  const stunden = v.pricingMode === "stunden" || rest.angebot?.isVariable === true;
  const neuesteGesperrt = rest.alle
    .filter((x) => x.status === "gesperrt")
    .reduce<number | null>((m, x) => (m === null || x.version > m ? x.version : m), null);
  const kvErstellbar = gesperrt && rest.kvDokument === null && neuesteGesperrt === v.version;

  const sperrGrund = gesperrt
    ? `v${v.version} ist gesperrt. Änderungen landen in einem neuen Entwurf.`
    : rest.hatPakete
      ? SPERRGRUND.pakete
      : stunden
        ? SPERRGRUND.stunden
        : v.error !== null
          ? SPERRGRUND.fehler
          : !v.rechnerResult
            ? SPERRGRUND.ohneErgebnis
            : veraltet
              ? veraltetGrund === "rechner"
                ? SPERRGRUND.rechner
                : SPERRGRUND.veraltet
              : kvFehler;

  const zeitpunkt = (d: Date | string) => {
    const iso = typeof d === "string" ? d : d.toISOString();
    return `${tagKurz(iso)} ${uhrzeitKurz(iso)}`;
  };
  const terminIso = text(grundlage.zeilen.find((z) => z.key === "termin")?.felder[0]?.wert) ?? rest.deal.termin;
  const termin = terminIso && /^\d{4}-\d{2}-\d{2}$/.test(terminIso) ? tagKurz(terminIso) : null;
  const tarif = v.tariff ?? v.rechnerResult?.tarif ?? null;

  return {
    kopf: {
      name: rest.deal.name,
      strecke: rest.deal.strecke,
      termin,
      aktenLink: rest.deal.aktenLink,
      schritt: "Schritt 3 von 11",
      unterzeile: [rest.deal.name, [rest.deal.art, rest.deal.strecke].filter(Boolean).join(" "), termin]
        .filter((t): t is string => !!t)
        .join(", "),
    },
    versionen: [...rest.alle]
      .sort((a, b) => a.version - b.version)
      .map((x) => ({
        version: x.version,
        status: x.status,
        preisCent: x.priceCents,
        aktiv: x.version === v.version,
        gesendet: x.sentAt ? zeitpunkt(x.sentAt) : null,
      })),
    version: {
      nummer: v.version,
      status: v.status,
      bearbeitbar: !gesperrt,
      gesperrtText: gesperrt
        ? `v${v.version} gesperrt · ${v.sentAt ? `gesendet ${zeitpunkt(v.sentAt)}` : "noch nicht gesendet"}`
        : null,
      veraltet,
      veraltetGrund,
      fehler: v.error,
      tarif: tarif ? `Tarif v${tarif.version}` : null,
      kvDokument: rest.kvDokument,
      kvErstellbar,
      sperrbar: sperrGrund === null,
      sperrGrund,
      preisModus: stunden ? "stunden" : "fest",
      renderer: rest.renderer ?? "crm",
    },
    grundlage,
    selbstkosten,
    marge,
    preis,
    kv,
    kvFehler,
    pakete: (v.packagePrices ?? []).map((p) => ({
      slug: p.slug,
      name: rest.paketNamen?.[p.slug] ?? p.slug,
      preisCent: typeof p.festpreis === "number" ? cent(p.festpreis) : null,
      hinweis: typeof p.festpreis === "number" ? null : "Nicht kalkulierbar.",
    })),
    angebotsformularLink: `/objects/deals/${v.dealRecordId}?tab=quotation`,
    anpassungen: wirksameUebersteuerungen(v.overrides ?? []).map((u) => ({
      id: u.id,
      art: u.art,
      key: u.key,
      text: anpassungText(u, v),
      wert: u.wert,
      von: autorName(u.autor, rest.namen),
      am: zeitpunktText(u.zeit),
      grund: u.grund,
    })),
    zeitpostenVorlagen: rest.vorlagen.map((z) => ({ id: z.id, bezeichnung: z.bezeichnung, minuten: z.minuten })),
  };
}
