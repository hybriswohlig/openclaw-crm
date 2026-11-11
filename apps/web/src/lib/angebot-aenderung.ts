/**
 * Plan 16 „Angebot ändern“: Vertrag und reine Logik. Keine Datenbank, kein KI-Aufruf.
 *
 * Änderungswünsche (aus dem Chat, aus der Eingabe des Disponenten, von Bots) werden
 * Vorschläge über ein festes Schema (`Aenderung`). Nichts wird ausgeführt: erst wenn ein
 * Mensch abhakt und „Übernehmen“ klickt, macht `uebernahmePlan` daraus Lead-Schritte
 * (Inventar, nur mit Rückfrage) und Übersteuerungen des Entwurfs. Alles, was nicht ins
 * Schema passt, wird „nicht zuordenbar“ mit dem Originaltext.
 *
 * Gespeichert wird als Ereignis-Log (`AENDERUNG_EVENT`, nur anhängen); `aenderungsStand`
 * faltet die Ereignisse eines Entwurfs zum aktuellen Stand.
 */
import { hebelAusUebersteuerungen } from "@/components/neu/kalkulation/kv-posten-logik";
import { kundenAnrede, kundenText } from "@openclaw-crm/customer-portal-core";
import { vornameFuerAnrede } from "./personen-name";
import { GROESSENKLASSEN, type Groessenklasse } from "./kalkulation-p15";
import { MONTAGE_KEY, positionSchluessel, type MontageTraeger, type MontageWert } from "./kalkulation-versionen";
import type { HebelArt } from "@/services/rechner/kv-posten";

// ─── Typen ──────────────────────────────────────────────────────────────────

export type Quelle = "chat" | "eingabe" | "bot" | "foto" | "hand";
export type VorschlagQuelle = Exclude<Quelle, "hand">;
/** Quellen, die Vorschläge ins Log schreiben (Foto-Vorschläge entstehen live aus dem Inventar). */
export type LogQuelle = Exclude<VorschlagQuelle, "foto">;
export type Wer = "wir" | "kunde" | "nicht_noetig";
export type Seite = "beladen" | "entladen";
export type Aufzug = "keiner" | "klein" | "gross";

export type Aenderung =
  | { art: "teil_hinzu"; name: string; menge: number; groesse: Groessenklasse | null }
  | { art: "teil_weg"; name: string }
  | { art: "teil_menge"; name: string; menge: number }
  | { art: "montage"; name: string; abbau: Wer | null; aufbau: Wer | null }
  | { art: "halteverbot"; seite: Seite; an: boolean }
  | { art: "etage"; seite: Seite; etage: number }
  | { art: "aufzug"; seite: Seite; aufzug: Aufzug }
  | { art: "tragweg"; seite: Seite; meter: number }
  /** Nur Hinweis: das CRM bucht nichts um. */
  | { art: "termin"; datum: string | null; text: string }
  /** Umzugskartons, die der Kunde packt. */
  | { art: "kartons"; anzahl: number }
  /** Einpackservice (das Team packt); 0 = aus. */
  | { art: "einpacken"; anzahl: number }
  | { art: "posten_hinzu"; bezeichnung: string; minuten: number | null; betrag: number | null }
  | { art: "posten_weg"; hebel: HebelArt }
  /** Nur für die Nachricht an den Kunden. */
  | { art: "hinweis"; text: string }
  /** Nicht zuordenbar: Originaltext, nichts wird übernommen. */
  | { art: "unklar"; text: string };

export type AenderungsArt = Aenderung["art"];

export const AENDERUNGS_ARTEN: readonly AenderungsArt[] = [
  "teil_hinzu",
  "teil_weg",
  "teil_menge",
  "montage",
  "halteverbot",
  "etage",
  "aufzug",
  "tragweg",
  "termin",
  "kartons",
  "einpacken",
  "posten_hinzu",
  "posten_weg",
  "hinweis",
  "unklar",
];

export type VorschlagStatus = "offen" | "uebernommen" | "verworfen";

export interface Vorschlag {
  id: string;
  quelle: VorschlagQuelle;
  aenderung: Aenderung;
  /** Originaltext (Satz aus der Nachricht oder Eingabe), höchstens 300 Zeichen. */
  zitat: string;
  status: VorschlagStatus;
  /** ISO-Zeit, zu der der Vorschlag entstand. */
  zeit: string;
  /**
   * Nur Quelle „foto“: das Teil steht schon im Lead-Inventar (Fotoerkennung nach dem Sperren der
   * maßgeblichen Version) und damit im Entwurf. `dublette`: Name eines älteren, ähnlichen Teils.
   */
  foto?: { inventarId: string; fotoUrl: string | null; mitnehmen: boolean; dublette: string | null };
}

/** Inventarzeile des Leads, wie Normalisierung und Übernahme sie brauchen. */
export interface InventarZeile {
  id: string;
  name: string;
  quantity: number;
  moveFlag: boolean;
}

// ─── Ereignis-Log ───────────────────────────────────────────────────────────

/** Stilles Ereignis je Schritt eines Änderungsvorgangs (activity_events, nur anhängen). */
export const AENDERUNG_EVENT = "angebot.aenderung" as const;

export type AenderungsPayload =
  | { typ: "start"; entwurfVersion: number; basisVersion: number | null }
  | {
      typ: "vorschlaege";
      entwurfVersion: number;
      quelle: VorschlagQuelle;
      /** true: offene Vorschläge derselben Quelle fallen weg (neue Auswertung ersetzt die alte). */
      ersetzen: boolean;
      vorschlaege: Vorschlag[];
      /** Stand der Eingabe (Nachrichtenstand bzw. Verlauf), für den KI-Cache. */
      stand?: string | null;
    }
  | { typ: "eingabe"; entwurfVersion: number; text: string }
  | { typ: "uebernommen"; entwurfVersion: number; ids: string[] }
  | { typ: "verworfen"; entwurfVersion: number; ids: string[] };

export interface AenderungsEreignis {
  zeit: string;
  payload: AenderungsPayload;
}

export interface AenderungsStand {
  entwurfVersion: number | null;
  basisVersion: number | null;
  gestartet: boolean;
  vorschlaege: Vorschlag[];
  /** Eingaben des Disponenten, älteste zuerst. */
  verlauf: { text: string; zeit: string }[];
  /** Stand der zuletzt ausgewerteten Nachrichten bzw. des Verlaufs (KI nur bei neuem Stand). */
  chatStand: string | null;
  eingabeStand: string | null;
}

/** Ist der Wert ein Payload dieses Logs? (Ereignisse kommen als jsonb.) */
export function istAenderungsPayload(p: unknown): p is AenderungsPayload {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.typ === "string" &&
    ["start", "vorschlaege", "eingabe", "uebernommen", "verworfen"].includes(o.typ) &&
    typeof o.entwurfVersion === "number"
  );
}

/**
 * Stand des Vorgangs zum Entwurf `entwurfVersion`: Faltung der Ereignisse (älteste zuerst).
 * Ereignisse anderer Entwürfe zählen nicht (ein gesperrter Entwurf beendet seinen Vorgang).
 */
export function aenderungsStand(
  ereignisse: readonly AenderungsEreignis[],
  entwurfVersion: number | null,
  /** Vorschläge, die nicht im Log stehen, sondern live entstehen (neue Foto-Teile); Status kommt aus dem Log. */
  live: readonly Vorschlag[] = []
): AenderungsStand {
  const stand: AenderungsStand = {
    entwurfVersion,
    basisVersion: null,
    gestartet: false,
    vorschlaege: live.map((v) => ({ ...v, status: "offen" as const })),
    verlauf: [],
    chatStand: null,
    eingabeStand: null,
  };
  if (entwurfVersion === null) return stand;
  for (const e of ereignisse) {
    const p = e.payload;
    if (!istAenderungsPayload(p) || p.entwurfVersion !== entwurfVersion) continue;
    switch (p.typ) {
      case "start":
        stand.gestartet = true;
        stand.basisVersion ??= p.basisVersion;
        break;
      case "vorschlaege": {
        stand.gestartet = true;
        if (p.ersetzen) stand.vorschlaege = stand.vorschlaege.filter((v) => !(v.status === "offen" && v.quelle === p.quelle));
        const erledigt = stand.vorschlaege.filter((v) => v.status !== "offen" || v.quelle !== p.quelle);
        for (const v of p.vorschlaege) {
          // Schon übernommen, verworfen oder offen vorhanden: nicht noch einmal vorschlagen.
          if (stand.vorschlaege.some((x) => x.id === v.id)) continue;
          if (erledigt.some((x) => gleicheAenderung(x.aenderung, v.aenderung) && x.status !== "offen")) continue;
          if (stand.vorschlaege.some((x) => x.status === "offen" && gleicheAenderung(x.aenderung, v.aenderung))) continue;
          stand.vorschlaege.push({ ...v, status: "offen" });
        }
        if (p.quelle === "chat" && p.stand) stand.chatStand = p.stand;
        if (p.quelle === "eingabe" && p.stand) stand.eingabeStand = p.stand;
        break;
      }
      case "eingabe":
        stand.gestartet = true;
        stand.verlauf.push({ text: p.text, zeit: e.zeit });
        break;
      case "uebernommen":
      case "verworfen": {
        const ids = new Set(p.ids);
        const status: VorschlagStatus = p.typ;
        stand.vorschlaege = stand.vorschlaege.map((v) => (ids.has(v.id) && v.status === "offen" ? { ...v, status } : v));
        break;
      }
    }
  }
  return stand;
}

const klein = (t: string) => t.replace(/\s+/g, " ").trim().toLocaleLowerCase("de-DE");

/**
 * Fachlicher Schlüssel einer Änderung (Review I2): Art und Name normalisiert, ohne Größe und
 * Zitat. „Fahrrad dazu“ ist dieselbe Änderung, ob die KI eine Größe mitliefert oder nicht.
 */
export function aenderungsSchluessel(a: Aenderung): string {
  switch (a.art) {
    case "teil_hinzu":
    case "teil_weg":
      return `${a.art}:${positionSchluessel(a.name)}`;
    case "teil_menge":
      return `${a.art}:${positionSchluessel(a.name)}:${a.menge}`;
    case "montage":
      return `${a.art}:${positionSchluessel(a.name)}:${a.abbau ?? "-"}:${a.aufbau ?? "-"}`;
    case "halteverbot":
      return `${a.art}:${a.seite}:${a.an}`;
    case "etage":
      return `${a.art}:${a.seite}:${a.etage}`;
    case "aufzug":
      return `${a.art}:${a.seite}:${a.aufzug}`;
    case "tragweg":
      return `${a.art}:${a.seite}:${a.meter}`;
    case "kartons":
    case "einpacken":
      return `${a.art}:${a.anzahl}`;
    case "posten_hinzu":
      return `${a.art}:${klein(a.bezeichnung)}`;
    case "posten_weg":
      return `${a.art}:${a.hebel}`;
    case "termin":
      return `${a.art}:${a.datum ?? klein(a.text)}`;
    case "hinweis":
    case "unklar":
      return `${a.art}:${klein(a.text)}`;
  }
}

/** Dieselbe Änderung im fachlichen Sinn (siehe `aenderungsSchluessel`)? */
export function gleicheAenderung(a: Aenderung, b: Aenderung): boolean {
  return aenderungsSchluessel(a) === aenderungsSchluessel(b);
}

// ─── Normalisierung (festes Schema) ─────────────────────────────────────────

const TEXT_MAX = 200;
const ZITAT_MAX = 300;
export const VORSCHLAEGE_MAX = 40;

function text(w: unknown, max = TEXT_MAX): string | null {
  if (typeof w !== "string") return null;
  const t = w.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function zahl(w: unknown): number | null {
  if (typeof w === "number") return Number.isFinite(w) ? w : null;
  if (typeof w === "string" && w.trim() !== "") {
    const n = Number(w.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ganz(w: unknown, min: number, max: number): number | null {
  const n = zahl(w);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function seiteAus(w: unknown): Seite | null {
  const s = typeof w === "string" ? w.trim().toLowerCase() : "";
  if (["beladen", "auszug", "von", "abholung", "alt"].includes(s)) return "beladen";
  if (["entladen", "einzug", "nach", "ziel", "neu"].includes(s)) return "entladen";
  return null;
}

function werAus(w: unknown): Wer | null | undefined {
  if (w === null || w === undefined || w === "") return null;
  const s = typeof w === "string" ? w.trim().toLowerCase().replace(/\s+/g, "_") : "";
  if (["wir", "company", "firma", "team"].includes(s)) return "wir";
  if (["kunde", "customer", "selbst"].includes(s)) return "kunde";
  if (["nicht_noetig", "nicht_nötig", "none", "keiner", "entfaellt", "entfällt"].includes(s)) return "nicht_noetig";
  return undefined;
}

const HEBEL: readonly HebelArt[] = ["montage", "halteverbot", "einpacken", "kueche"];

function istDatum(w: unknown): w is string {
  if (typeof w !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(w)) return false;
  const [j, m, t] = w.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

/**
 * Inventarzeile zum Namen: genau gleich (ohne Groß/Klein, Leerzeichen), sonst genau eine
 * Zeile, deren Name den gesuchten enthält oder umgekehrt („Schrank“ → „Kleiderschrank“).
 * Mehrere oder keine: null.
 */
export function inventarTreffer(name: string, inventar: readonly InventarZeile[]): InventarZeile | null {
  const k = positionSchluessel(name);
  if (!k) return null;
  const genau = inventar.filter((z) => positionSchluessel(z.name) === k);
  if (genau.length >= 1) return genau[0];
  const teil = inventar.filter((z) => {
    const zk = positionSchluessel(z.name);
    return zk.includes(k) || k.includes(zk);
  });
  return teil.length === 1 ? teil[0] : null;
}

function unklar(textRoh: string): Aenderung {
  return { art: "unklar", text: textRoh.slice(0, TEXT_MAX) || "Nicht zuordenbar" };
}

/**
 * Eine rohe Änderung (KI, Bot) gegen das feste Schema prüfen. Namen bestehender Teile
 * werden auf den Namen im Inventar gesetzt; `neueNamen` sind Teile, die im selben Satz
 * dazukommen (für Abbau/Aufbau an einem neuen Teil). Unpassendes wird „unklar“ mit
 * Originaltext; nichts wird geraten.
 */
export function normalisiereAenderung(
  roh: unknown,
  inventar: readonly InventarZeile[],
  neueNamen: ReadonlySet<string> = new Set(),
  originalText = ""
): Aenderung {
  const o = roh && typeof roh === "object" && !Array.isArray(roh) ? (roh as Record<string, unknown>) : {};
  const art = typeof o.art === "string" ? o.art.trim() : "";
  const original = text(o.zitat, ZITAT_MAX) ?? text(o.text, ZITAT_MAX) ?? originalText;
  const bestehend = (n: unknown): string | null => {
    const t = text(n);
    if (!t) return null;
    const z = inventarTreffer(t, inventar);
    if (z) return z.name;
    return neueNamen.has(positionSchluessel(t)) ? t : null;
  };
  switch (art) {
    case "teil_hinzu": {
      const name = text(o.name, 80);
      const menge = o.menge === undefined || o.menge === null ? 1 : ganz(o.menge, 1, 200);
      if (!name || menge === null) return unklar(original);
      const g = typeof o.groesse === "string" ? o.groesse.toLowerCase().replace(/ß/g, "ss") : null;
      return { art, name, menge, groesse: g && (GROESSENKLASSEN as readonly string[]).includes(g) ? (g as Groessenklasse) : null };
    }
    case "teil_weg": {
      const name = bestehend(o.name);
      if (!name || !inventarTreffer(name, inventar)) return unklar(original);
      return { art, name };
    }
    case "teil_menge": {
      const name = bestehend(o.name);
      const menge = ganz(o.menge, 1, 200);
      if (!name || !inventarTreffer(name, inventar) || menge === null) return unklar(original);
      return { art, name, menge };
    }
    case "montage": {
      const name = bestehend(o.name);
      const abbau = werAus(o.abbau);
      const aufbau = werAus(o.aufbau);
      if (!name || abbau === undefined || aufbau === undefined || (abbau === null && aufbau === null)) return unklar(original);
      return { art, name, abbau, aufbau };
    }
    case "halteverbot": {
      const seite = seiteAus(o.seite);
      if (!seite || typeof o.an !== "boolean") return unklar(original);
      return { art, seite, an: o.an };
    }
    case "etage": {
      const seite = seiteAus(o.seite);
      const n = zahl(o.etage);
      if (!seite || n === null || n < -5 || n > 60 || Math.abs(n * 10 - Math.round(n * 10)) > 1e-9) return unklar(original);
      return { art, seite, etage: n };
    }
    case "aufzug": {
      const seite = seiteAus(o.seite);
      const a = typeof o.aufzug === "string" ? o.aufzug.trim().toLowerCase().replace(/ß/g, "ss") : "";
      if (!seite || !["keiner", "klein", "gross"].includes(a)) return unklar(original);
      return { art, seite, aufzug: a as Aufzug };
    }
    case "tragweg": {
      const seite = seiteAus(o.seite);
      const n = zahl(o.meter);
      if (!seite || n === null || n < 0 || n > 500) return unklar(original);
      return { art, seite, meter: Math.round(n) };
    }
    case "termin": {
      const t = text(o.text) ?? original;
      const datum = istDatum(o.datum) ? o.datum : null;
      if (!t && !datum) return unklar(original);
      return { art, datum, text: t || "Terminwunsch" };
    }
    case "kartons": {
      const n = ganz(o.anzahl, 0, 2000);
      return n === null ? unklar(original) : { art, anzahl: n };
    }
    case "einpacken": {
      const n = ganz(o.anzahl, 0, 2000);
      return n === null ? unklar(original) : { art, anzahl: n };
    }
    case "posten_hinzu": {
      const bezeichnung = text(o.bezeichnung, 80);
      const minuten = o.minuten === undefined || o.minuten === null ? null : ganz(o.minuten, 1, 600);
      const betragRoh = o.betrag === undefined || o.betrag === null ? null : zahl(o.betrag);
      const betrag = betragRoh !== null && betragRoh >= 0 && betragRoh <= 10_000 ? Math.round(betragRoh * 100) / 100 : null;
      // Genau eins von beiden: Zeit (Zeitposten) oder Betrag (Material).
      if (!bezeichnung || (minuten === null) === (betrag === null)) return unklar(original);
      if ((o.minuten !== undefined && o.minuten !== null && minuten === null) || (o.betrag !== undefined && o.betrag !== null && betrag === null)) {
        return unklar(original);
      }
      return { art, bezeichnung, minuten, betrag };
    }
    case "posten_weg": {
      const h = typeof o.hebel === "string" ? o.hebel.trim().toLowerCase() : "";
      return (HEBEL as readonly string[]).includes(h) ? { art, hebel: h as HebelArt } : unklar(original);
    }
    case "hinweis": {
      const t = text(o.text, 300);
      return t ? { art, text: t } : unklar(original);
    }
    default:
      return unklar(text(o.text, ZITAT_MAX) ?? original);
  }
}

/**
 * Rohe Liste (KI, Bot) → Vorschläge. Höchstens `VORSCHLAEGE_MAX`; Teile, die in der
 * Liste dazukommen, dürfen in derselben Liste Abbau/Aufbau bekommen.
 */
export function normalisiereVorschlaege(
  roh: unknown,
  opts: { inventar: readonly InventarZeile[]; quelle: VorschlagQuelle; zeit: string; id?: () => string; originalText?: string }
): Vorschlag[] {
  const liste = Array.isArray(roh) ? roh.slice(0, VORSCHLAEGE_MAX) : [];
  const neu = new Set<string>();
  for (const r of liste) {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    if (o.art === "teil_hinzu" && typeof o.name === "string") neu.add(positionSchluessel(o.name));
  }
  const id = opts.id ?? (() => globalThis.crypto.randomUUID());
  return liste.map((r) => {
    const o = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
    const aenderung = normalisiereAenderung(r, opts.inventar, neu, opts.originalText ?? "");
    return {
      id: id(),
      quelle: opts.quelle,
      aenderung,
      zitat: text(o.zitat, ZITAT_MAX) ?? (aenderung.art === "unklar" ? aenderung.text : opts.originalText?.slice(0, ZITAT_MAX) ?? ""),
      status: "offen" as const,
      zeit: opts.zeit,
    };
  });
}

// ─── Übernahme ──────────────────────────────────────────────────────────────

export type LeadSchritt =
  | { art: "hinzu"; name: string; menge: number; groesse: Groessenklasse | null }
  | { art: "menge"; id: string; name: string; menge: number }
  /** „Kommt nicht mit“: moveFlag aus (die Zeile bleibt als „bleibt da“ sichtbar). */
  | { art: "weg"; id: string; name: string }
  /** Foto-Teil, das „bleibt da“ steht, wieder mitnehmen. */
  | { art: "wieder"; id: string; name: string };

/** Übersteuerung, wie `POST …/overrides` und `aenderungenAnwenden` sie erwarten. */
export interface AenderungsUebersteuerung {
  art: "eingabe" | "montage" | "zeitposten" | "material_frei";
  key: string;
  wert: unknown;
  grund: string;
  herkunft: VorschlagQuelle;
}

export interface UebernahmePlan {
  lead: LeadSchritt[];
  uebersteuerungen: AenderungsUebersteuerung[];
  /** Termin und Hinweise: nur für die Nachricht an den Kunden. */
  hinweise: string[];
  /** IDs, die übernommen werden (ohne „unklar“). */
  ids: string[];
  /** „unklar“: bleiben offen, nichts übernommen. */
  uebersprungen: string[];
}

const TRAEGER: Record<Wer, MontageTraeger> = { wir: "company", kunde: "customer", nicht_noetig: "none" };

/** Grund der Übersteuerung: Herkunft und Originaltext (gekürzt). */
export function aenderungsGrund(v: Pick<Vorschlag, "quelle" | "zitat">): string {
  const wo = v.quelle === "chat" ? "aus dem Chat" : v.quelle === "bot" ? "vom Bot" : v.quelle === "foto" ? "aus neuen Fotos" : "Eingabe";
  const z = v.zitat.trim().slice(0, 160);
  return z ? `Kundenänderung ${wo}: „${z}“` : `Kundenänderung ${wo}`;
}

/**
 * Abgehakte Vorschläge → Lead-Schritte (Inventar) und Übersteuerungen des Entwurfs.
 * `montageJetzt`: was die Kalkulation je Möbel gerade annimmt (Schlüssel `positionSchluessel`),
 * damit eine Änderung nur einer Seite die andere nicht still verändert. Alle Abbau/Aufbau-
 * Änderungen gehen in eine Übersteuerung `montage` (der Dienst führt sie mit der wirksamen zusammen).
 */
export function uebernahmePlan(
  vorschlaege: readonly Vorschlag[],
  opts: { inventar: readonly InventarZeile[]; montageJetzt: Readonly<Record<string, { abbau: Wer; aufbau: Wer }>> }
): UebernahmePlan {
  const plan: UebernahmePlan = { lead: [], uebersteuerungen: [], hinweise: [], ids: [], uebersprungen: [] };
  const montage: MontageWert["positionen"] = {};
  let montageGrund: { grund: string; herkunft: VorschlagQuelle } | null = null;
  const eingabe = (v: Vorschlag, key: string, wert: unknown) =>
    plan.uebersteuerungen.push({ art: "eingabe", key, wert, grund: aenderungsGrund(v), herkunft: v.quelle });

  for (const v of vorschlaege) {
    const a = v.aenderung;
    if (a.art === "unklar") {
      plan.uebersprungen.push(v.id);
      continue;
    }
    plan.ids.push(v.id);
    switch (a.art) {
      case "teil_hinzu":
        // Foto-Teile stehen schon im Lead: nichts anlegen, höchstens wieder mitnehmen.
        if (v.foto) {
          if (!v.foto.mitnehmen) plan.lead.push({ art: "wieder", id: v.foto.inventarId, name: a.name });
        } else {
          plan.lead.push({ art: "hinzu", name: a.name, menge: a.menge, groesse: a.groesse });
        }
        break;
      case "teil_weg": {
        const z = inventarTreffer(a.name, opts.inventar);
        if (z) plan.lead.push({ art: "weg", id: z.id, name: z.name });
        break;
      }
      case "teil_menge": {
        const z = inventarTreffer(a.name, opts.inventar);
        if (z) plan.lead.push({ art: "menge", id: z.id, name: z.name, menge: a.menge });
        break;
      }
      case "montage": {
        const z = inventarTreffer(a.name, opts.inventar);
        const key = positionSchluessel(z?.name ?? a.name);
        const jetzt = opts.montageJetzt[key] ?? { abbau: "nicht_noetig" as Wer, aufbau: "nicht_noetig" as Wer };
        // Review 3: ein zweiter Vorschlag zum selben Möbel ändert nur seine Seite; die andere bleibt,
        // wie ein früherer Vorschlag sie gesetzt hat, sonst wie die Kalkulation sie annimmt.
        const vorher = montage[key];
        montage[key] = {
          abbau: a.abbau ? TRAEGER[a.abbau] : vorher?.abbau ?? TRAEGER[jetzt.abbau],
          aufbau: a.aufbau ? TRAEGER[a.aufbau] : vorher?.aufbau ?? TRAEGER[jetzt.aufbau],
        };
        montageGrund ??= { grund: aenderungsGrund(v), herkunft: v.quelle };
        break;
      }
      case "halteverbot":
        eingabe(v, `halteverbot.${a.seite}`, a.an);
        break;
      case "etage":
        eingabe(v, `${a.seite}.etage`, a.etage);
        break;
      case "aufzug":
        eingabe(v, `${a.seite}.aufzug`, a.aufzug);
        break;
      case "tragweg":
        eingabe(v, `${a.seite}.tragweg`, a.meter);
        break;
      case "kartons":
        eingabe(v, "umzugskartons", a.anzahl);
        break;
      case "einpacken":
        eingabe(v, "einpacken", a.anzahl);
        break;
      case "posten_hinzu": {
        // Review I2: Schlüssel aus der Bezeichnung, damit derselbe Posten nie zweimal zählt (ersetzt statt addiert).
        const key = `aenderung.${klein(a.bezeichnung).replace(/[^a-z0-9äöüß]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "posten"}`;
        if (a.minuten !== null) {
          plan.uebersteuerungen.push({ art: "zeitposten", key, wert: { bezeichnung: a.bezeichnung, minuten: a.minuten }, grund: aenderungsGrund(v), herkunft: v.quelle });
        } else {
          plan.uebersteuerungen.push({ art: "material_frei", key, wert: { bezeichnung: a.bezeichnung, betrag: a.betrag }, grund: aenderungsGrund(v), herkunft: v.quelle });
        }
        break;
      }
      case "posten_weg":
        for (const u of hebelAusUebersteuerungen(a.hebel, aenderungsGrund(v))) {
          plan.uebersteuerungen.push({ art: "eingabe", key: u.key, wert: u.wert, grund: u.grund, herkunft: v.quelle });
        }
        break;
      case "termin":
        plan.hinweise.push(`Termin (nur Hinweis): ${a.datum ? datumText(a.datum) : a.text}`);
        break;
      case "hinweis":
        plan.hinweise.push(a.text);
        break;
    }
  }
  if (Object.keys(montage).length > 0 && montageGrund) {
    plan.uebersteuerungen.push({ art: "montage", key: MONTAGE_KEY, wert: { positionen: montage }, grund: montageGrund.grund, herkunft: montageGrund.herkunft });
  }
  return plan;
}

/** Schlüssel der Vergleichszeilen, die eine Änderung betrifft (für die Herkunft je Zeile). */
export function herkunftSchluessel(a: Aenderung): string[] {
  switch (a.art) {
    case "teil_hinzu":
    case "teil_weg":
    case "teil_menge":
      return [`teil:${positionSchluessel(a.name)}`];
    case "montage":
      return [`montage:${positionSchluessel(a.name)}`];
    case "halteverbot":
      return [`eingabe:halteverbot.${a.seite}`];
    case "etage":
    case "aufzug":
    case "tragweg":
      return [`eingabe:${a.seite}.${a.art}`];
    case "kartons":
      return ["eingabe:umzugskartons"];
    case "einpacken":
      return ["eingabe:einpacken"];
    case "posten_hinzu":
      return [`posten:${a.bezeichnung.trim().toLocaleLowerCase("de-DE")}`];
    case "posten_weg":
      return a.hebel === "halteverbot"
        ? ["eingabe:halteverbot.beladen", "eingabe:halteverbot.entladen", "hebel:halteverbot"]
        : a.hebel === "einpacken"
          ? ["eingabe:einpacken", "hebel:einpacken"]
          : [`hebel:${a.hebel}`];
    case "termin":
    case "hinweis":
    case "unklar":
      return [];
  }
}

/**
 * Was die Kundennachricht aufzählt (Review I5): übernommene Vorschläge; offene Foto-Teile nur, wenn
 * sie mitkommen und keine mögliche Dublette sind. „Bleibt da“ und Dubletten nie als „kommt dazu“.
 */
export function fuerKundennachricht(vorschlaege: readonly Vorschlag[]): Vorschlag[] {
  return vorschlaege.filter(
    (v) => v.status === "uebernommen" || (v.quelle === "foto" && v.status === "offen" && v.foto?.mitnehmen === true && !v.foto.dublette)
  );
}

/** Herkunft je Vergleichsschlüssel aus den übernommenen Vorschlägen (die letzte gilt). */
export function herkunftAus(vorschlaege: readonly Vorschlag[]): (schluessel: string) => Quelle {
  const m = new Map<string, Quelle>();
  for (const v of vorschlaege) {
    // Foto-Teile stecken schon im Entwurf (Lead-Inventar): Herkunft „Foto“, solange offen und mitgenommen (Review I5).
    const wirkt = v.status === "uebernommen" || (v.quelle === "foto" && v.status === "offen" && v.foto?.mitnehmen === true);
    if (!wirkt) continue;
    for (const k of herkunftSchluessel(v.aenderung)) m.set(k, v.quelle);
  }
  return (k) => m.get(k) ?? "hand";
}

// ─── Texte ──────────────────────────────────────────────────────────────────

const SEITE_INTERN: Record<Seite, string> = { beladen: "Auszug", entladen: "Einzug" };
const WER_INTERN: Record<Wer, string> = { wir: "wir", kunde: "Kunde", nicht_noetig: "nicht nötig" };
const AUFZUG_TEXT: Record<Aufzug, string> = { keiner: "kein Aufzug", klein: "kleiner Aufzug", gross: "großer Aufzug" };
const HEBEL_INTERN: Record<HebelArt, string> = {
  montage: "Montage raus",
  halteverbot: "Halteverbot raus (beide Seiten)",
  einpacken: "Einpackservice raus",
  kueche: "Küche raus",
};
const K = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

function etageText(n: number): string {
  if (n === 0) return "Erdgeschoss";
  if (n === 0.5) return "Hochparterre";
  if (n < 0) return `${K.format(Math.abs(n))}. Untergeschoss`;
  return `${K.format(n)}. Stock`;
}

function datumText(d: string): string {
  const [j, m, t] = d.split("-");
  return `${t}.${m}.${j}`;
}

/** Zeile der Vorschlagsliste (intern, kurz). */
export function aenderungText(a: Aenderung): string {
  switch (a.art) {
    case "teil_hinzu":
      return `Dazu: ${a.menge > 1 ? `${a.menge} × ` : ""}${a.name}${a.groesse ? ` (${a.groesse})` : ""}`;
    case "teil_weg":
      return `Kommt nicht mit: ${a.name}`;
    case "teil_menge":
      return `Menge ${a.name}: ${a.menge}`;
    case "montage": {
      const teile = [a.abbau ? `Abbau ${WER_INTERN[a.abbau]}` : null, a.aufbau ? `Aufbau ${WER_INTERN[a.aufbau]}` : null].filter(Boolean);
      return `${a.name}: ${teile.join(", ")}`;
    }
    case "halteverbot":
      return `Halteverbot ${SEITE_INTERN[a.seite]}: ${a.an ? "an" : "aus"}`;
    case "etage":
      return `Etage ${SEITE_INTERN[a.seite]}: ${etageText(a.etage)}`;
    case "aufzug":
      return `Aufzug ${SEITE_INTERN[a.seite]}: ${AUFZUG_TEXT[a.aufzug]}`;
    case "tragweg":
      return `Trageweg ${SEITE_INTERN[a.seite]}: ${a.meter} m`;
    case "termin":
      return `Termin (nur Hinweis): ${a.datum ? datumText(a.datum) : a.text}`;
    case "kartons":
      return `Umzugskartons: ${a.anzahl}`;
    case "einpacken":
      return a.anzahl === 0 ? "Einpackservice: aus" : `Einpackservice: ${a.anzahl} Kartons`;
    case "posten_hinzu":
      return `Posten dazu: ${a.bezeichnung} (${a.minuten !== null ? `${a.minuten} min` : `${K.format(a.betrag ?? 0)} €`})`;
    case "posten_weg":
      return `Posten: ${HEBEL_INTERN[a.hebel]}`;
    case "hinweis":
      return `Hinweis an den Kunden: ${a.text}`;
    case "unklar":
      return `Nicht zuordenbar: ${a.text}`;
  }
}

/** Ändert die Änderung die Lead-Daten (Inventar)? Dann fragt „Übernehmen“ nach. */
export function aendertLead(a: Aenderung): boolean {
  return a.art === "teil_hinzu" || a.art === "teil_weg" || a.art === "teil_menge";
}

// ─── Kundentexte je Firma (Kottke duzt, alle anderen siezen, wie das Portal) ─────────────

/** Firma des Deals für die Kundentexte: Slug oder Name (für `kundenText`) und Anzeigename (Gruß). */
export interface KundenFirma {
  slug: string | null;
  name: string | null;
}

const SEITE_KUNDE: Record<Seite, string> = { beladen: "am Auszug", entladen: "am Einzug" };
const HEBEL_KUNDE: Record<HebelArt, string> = {
  montage: "Die Montage entfällt",
  halteverbot: "Die Halteverbotszone entfällt",
  einpacken: "Der Einpackservice entfällt",
  kueche: "Die Küchenmontage entfällt",
};

function werKunde(w: Wer, firma: KundenFirma): string {
  if (w === "wir") return "übernehmen wir";
  if (w === "nicht_noetig") return "entfällt";
  return kundenText(firma.slug, "übernehmen Sie selbst", "übernimmst du selbst");
}

/** Termin-Hinweis (nur notiert, nie umgebucht). */
export function terminKundenText(a: { datum: string | null; text: string }, firma: KundenFirma): string {
  if (!a.datum) return kundenText(firma.slug, `Zum Termin haben wir notiert: ${a.text}`, `Zum Termin haben wir notiert: ${a.text}`);
  return kundenText(
    firma.slug,
    `Ihren Terminwunsch (${datumText(a.datum)}) haben wir notiert; den Termin bestätigen wir Ihnen gesondert.`,
    `Deinen Terminwunsch (${datumText(a.datum)}) haben wir notiert; den Termin bestätigen wir dir gesondert.`
  );
}

/** Eine Zeile der Kundennachricht (ohne Gedankenstrich); null = nicht aufzählen. */
export function aenderungKundenText(a: Aenderung, firma: KundenFirma = { slug: null, name: null }): string | null {
  switch (a.art) {
    case "teil_hinzu":
      return a.menge > 1 ? `${a.menge} × ${a.name} kommen dazu` : `${a.name} kommt dazu`;
    case "teil_weg":
      return `${a.name} kommt nicht mit`;
    case "teil_menge":
      return `${a.name}: jetzt ${a.menge} Stück`;
    case "montage": {
      if (a.abbau && a.aufbau && a.abbau === a.aufbau) return `${a.name}: Abbau und Aufbau ${werKunde(a.abbau, firma)}`;
      const teile = [a.abbau ? `Abbau ${werKunde(a.abbau, firma)}` : null, a.aufbau ? `Aufbau ${werKunde(a.aufbau, firma)}` : null].filter(Boolean);
      return `${a.name}: ${teile.join(", ")}`;
    }
    case "halteverbot":
      return `Halteverbotszone ${SEITE_KUNDE[a.seite]} ${a.an ? "kommt dazu" : "entfällt"}`;
    case "etage":
      return `Etage ${SEITE_KUNDE[a.seite]}: ${etageText(a.etage)}`;
    case "aufzug":
      return `${a.seite === "beladen" ? "Am Auszug" : "Am Einzug"}: ${AUFZUG_TEXT[a.aufzug]}`;
    case "tragweg":
      return `Trageweg ${SEITE_KUNDE[a.seite]}: etwa ${a.meter} m`;
    case "kartons":
      return `Umzugskartons: jetzt ${a.anzahl}`;
    case "einpacken":
      return a.anzahl === 0 ? "Der Einpackservice entfällt" : `Einpackservice für ${a.anzahl} Kartons`;
    case "posten_hinzu":
      return `${a.bezeichnung} kommt dazu`;
    case "posten_weg":
      return HEBEL_KUNDE[a.hebel];
    case "termin":
    case "hinweis":
    case "unklar":
      return null;
  }
}

const EURO = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** „1.290 €“, mit Cent nur wenn nötig. */
export function euroText(cent: number): string {
  return EURO.format(cent / 100).replace(/\u00a0/g, " ");
}

/** Was die Preiszeile sagt: Festpreis, je Paket bzw. Tag, oder Stunden. */
export type PreisAngabe =
  | { art: "fest"; altCent: number | null; neuCent: number | null }
  | { art: "liste"; zeilen: { label: string; altCent: number | null; neuCent: number | null }[] }
  | { art: "stunden"; satzCent: number; stunden: number; summeCent: number | null };

function bisher(alt: number | null, neu: number): string {
  return alt !== null && alt !== neu ? ` (bisher ${euroText(alt)})` : "";
}

/** Preiszeile(n) der Nachricht. */
export function preisZeilen(p: PreisAngabe, firma: KundenFirma): string[] {
  if (p.art === "fest") {
    if (p.neuCent === null) return [];
    return [p.altCent !== null && p.altCent !== p.neuCent ? `Der neue Preis beträgt ${euroText(p.neuCent)}${bisher(p.altCent, p.neuCent)}.` : `Der Preis beträgt ${euroText(p.neuCent)}.`];
  }
  if (p.art === "liste") {
    const z = p.zeilen.filter((x) => x.neuCent !== null);
    if (z.length === 0) return [];
    return ["Die neuen Preise:", ...z.map((x) => `• ${x.label}: ${euroText(x.neuCent!)}${bisher(x.altCent, x.neuCent!)}`)];
  }
  const summe = p.summeCent !== null ? kundenText(firma.slug, `, voraussichtlich etwa ${euroText(p.summeCent)}`, `, voraussichtlich etwa ${euroText(p.summeCent)}`) : "";
  return [`Abgerechnet wird nach Aufwand: ${euroText(p.satzCent)} je Stunde, geschätzt ${K.format(p.stunden)} Stunden${summe}.`];
}

/** Anrede wie in den Kundentexten: Sie mit vollem Namen, du mit Vornamen. */
export function kundenAnredeZeile(name: string | null, firma: KundenFirma): string {
  const n = name?.trim() || null;
  if (kundenAnrede(firma.slug) === "du") {
    const vorname = vornameFuerAnrede(n);
    return vorname ? `Hallo ${vorname},` : "Hallo,";
  }
  return n ? `Guten Tag ${n},` : "Guten Tag,";
}

/**
 * Entwurf der Nachricht an den Kunden (Kottke du, sonst Sie; keine Gedankenstriche): Änderungen
 * kurz aufgezählt, neuer Preis statt alter, Link aufs Angebot. Wird nie automatisch verschickt.
 */
export function kundenNachricht(p: {
  firma: KundenFirma;
  name: string | null;
  aenderungen: readonly Aenderung[];
  preis: PreisAngabe;
  link: string | null;
  neuAnnehmen: boolean;
}): string {
  const f = p.firma;
  const t = (sie: string, du: string) => kundenText(f.slug, sie, du);
  const zeilen = p.aenderungen.map((a) => aenderungKundenText(a, f)).filter((x): x is string => !!x);
  const hinweise = p.aenderungen.flatMap((a) => (a.art === "hinweis" ? [a.text] : a.art === "termin" ? [terminKundenText(a, f)] : []));
  const teile: string[] = [kundenAnredeZeile(p.name, f), ""];
  const angepasst = t("wir haben Ihr Angebot wie besprochen angepasst", "wir haben dein Angebot wie besprochen angepasst");
  teile.push(zeilen.length > 0 ? `${angepasst}:` : `${angepasst}.`);
  for (const z of zeilen) teile.push(`• ${z}`);
  teile.push("");
  teile.push(...preisZeilen(p.preis, f));
  for (const h of hinweise) teile.push(h);
  if (p.link) {
    teile.push(
      p.neuAnnehmen
        ? t(`Das aktualisierte Angebot finden Sie hier, bitte nehmen Sie es dort erneut an: ${p.link}`, `Das aktualisierte Angebot findest du hier, bitte nimm es dort erneut an: ${p.link}`)
        : t(`Das aktualisierte Angebot finden Sie hier: ${p.link}`, `Das aktualisierte Angebot findest du hier: ${p.link}`)
    );
  } else if (p.neuAnnehmen) {
    teile.push(t("Bitte nehmen Sie das aktualisierte Angebot erneut an.", "Bitte nimm das aktualisierte Angebot erneut an."));
  }
  teile.push("", "Herzliche Grüße");
  if (f.name) teile.push(t(`Ihr Team von ${f.name}`, `Dein Team von ${f.name}`));
  // Sicherheitsnetz: nie Gedankenstriche im Kundentext.
  return teile.join("\n").replace(/\s[\u2013\u2014]\s/g, ", ").replace(/[\u2013\u2014]/g, "-");
}
