/**
 * Reine Logik des Formulars „Bearbeiten“ und des Zusammenführens (Spec 6, 7.2, 10; Plan 6a).
 *
 * Das Formular hält Werte je Schlüssel. Beim Speichern wird daraus `setzen` und
 * `zuruecksetzen` relativ zum Vorgänger (`StandAnlegenEingabe`). Preisverdacht prüft nur der
 * Server (`preisVerdacht`, Aufgabe 1); hier nur, was der Browser sicher weiß: Länge,
 * Zuständigkeit „Firma“ ohne Preis, Typ.
 */
import {
  KV_ABSCHNITT_TITEL,
  KV_ABSCHNITTE,
  KV_EDITOR_TEXT,
  KV_ZUSTAENDIG,
  type KvAbschnitt,
  type KvAblehnung,
  type KvAenderung,
  type KvBasis,
  type KvFeld,
  type KvKiAblehnung,
  type KvWert,
  type StandAnlegenEingabe,
  type Zustaendig,
} from "@/lib/kv-editor";

/** Zeile im Formular: eine Gruppe (Leistung, Möbelstück, Bild) oder lose Felder (gruppe null). */
export interface FormularZeile {
  gruppe: string | null;
  felder: KvFeld[];
}

export interface FormularAbschnitt {
  abschnitt: KvAbschnitt;
  titel: string;
  zeilen: FormularZeile[];
}

/** Felder in KV-Reihenfolge nach Abschnitt, darin nach Gruppe in der Reihenfolge des Katalogs. */
export function formularAbschnitte(basis: KvBasis): FormularAbschnitt[] {
  const out: FormularAbschnitt[] = [];
  for (const abschnitt of KV_ABSCHNITTE) {
    const felder = basis.felder.filter((f) => f.abschnitt === abschnitt);
    if (felder.length === 0) continue;
    const zeilen: FormularZeile[] = [];
    for (const f of felder) {
      const g = f.gruppe ?? null;
      const zeile = zeilen.find((z) => z.gruppe === g && g !== null);
      if (zeile) zeile.felder.push(f);
      else zeilen.push({ gruppe: g, felder: [f] });
    }
    out.push({ abschnitt, titel: KV_ABSCHNITT_TITEL[abschnitt], zeilen });
  }
  return out;
}

/** Text getrimmt wie der Server; Zuständigkeit und `zeigen` unverändert. */
export function normiert(w: KvWert): KvWert {
  return typeof w === "string" ? w.trim() : w;
}

export function gleich(a: KvWert, b: KvWert): boolean {
  return normiert(a) === normiert(b);
}

/** Aktueller Wert eines Felds im Stand (Basis plus Änderungen). */
export function standWert(f: KvFeld, werte: Readonly<Record<string, KvWert>>): KvWert {
  return f.schluessel in werte ? werte[f.schluessel] : f.basis;
}

/**
 * Formularwerte → Eingabe fürs Speichern. Gleich dem Stand: nichts; gleich der Basis bei einem
 * geänderten Feld: `zuruecksetzen`; sonst `setzen`. Texte getrimmt.
 */
export function formularEingabe(
  basis: KvBasis,
  werte: Readonly<Record<string, KvWert>>,
  eingaben: Readonly<Record<string, KvWert>>,
  vorgaengerId: string
): StandAnlegenEingabe {
  const setzen: StandAnlegenEingabe["setzen"] = [];
  const zuruecksetzen: string[] = [];
  for (const f of basis.felder) {
    if (!(f.schluessel in eingaben)) continue;
    const neu = normiert(eingaben[f.schluessel]);
    const alt = standWert(f, werte);
    if (gleich(neu, alt)) continue;
    if (gleich(neu, f.basis)) zuruecksetzen.push(f.schluessel);
    else setzen.push({ schluessel: f.schluessel, wert: neu });
  }
  return { vorgaengerId, setzen, zuruecksetzen };
}

export function anzahlAenderungen(e: Pick<StandAnlegenEingabe, "setzen" | "zuruecksetzen">): number {
  return e.setzen.length + e.zuruecksetzen.length;
}

/** Prüfung im Browser vor dem Speichern (Länge, Typ, Firma nur zurück). Preis prüft der Server. */
export function lokalePruefung(basis: KvBasis, eingaben: Readonly<Record<string, KvWert>>): Record<string, KvAblehnung> {
  const out: Record<string, KvAblehnung> = {};
  for (const f of basis.felder) {
    if (!(f.schluessel in eingaben)) continue;
    const w = eingaben[f.schluessel];
    if (f.art === "text" || f.art === "langtext") {
      if (typeof w !== "string") out[f.schluessel] = "TYP";
      else if (f.max !== undefined && w.trim().length > f.max) out[f.schluessel] = "ZU_LANG";
    } else if (f.art === "zustaendig") {
      if (typeof w !== "string" || !(KV_ZUSTAENDIG as readonly string[]).includes(w)) out[f.schluessel] = "TYP";
      else if (w === "company" && !f.firmaWaehlbar && f.basis !== "company") out[f.schluessel] = "FIRMA_GESPERRT";
    } else if (typeof w !== "boolean") {
      out[f.schluessel] = "TYP";
    } else if (w && f.basis === false) {
      // `zeigen` nur ausblenden und wieder einblenden, nie ein neues Bild.
      out[f.schluessel] = "UNBEKANNT";
    }
  }
  return out;
}

/**
 * Ablehnungen (lokal oder 400 `UNGUELTIG`) als Texte aus `KV_EDITOR_TEXT`: je Feld und allgemein
 * (Schlüssel null oder nicht im Formular).
 */
export function fehlerJeFeld(
  abgelehnt: readonly { schluessel: string | null; grund: KvAblehnung | KvKiAblehnung }[],
  basis: KvBasis
): { jeFeld: Record<string, string>; allgemein: string[] } {
  const jeFeld: Record<string, string> = {};
  const allgemein: string[] = [];
  for (const a of abgelehnt) {
    const text = a.grund === "LEER" ? KV_EDITOR_TEXT.UNBEKANNT : KV_EDITOR_TEXT[a.grund];
    if (a.schluessel && basis.felder.some((f) => f.schluessel === a.schluessel)) jeFeld[a.schluessel] = text;
    else if (!allgemein.includes(text)) allgemein.push(text);
  }
  return { jeFeld, allgemein };
}

/** `daten.abgelehnt` aus 400 `UNGUELTIG`, robust gegen fehlende oder falsche Form. */
export function abgelehntAusDaten(daten: unknown): { schluessel: string | null; grund: KvAblehnung }[] {
  const liste = (daten as { abgelehnt?: unknown } | null | undefined)?.abgelehnt;
  if (!Array.isArray(liste)) return [];
  return liste.filter(
    (x): x is { schluessel: string | null; grund: KvAblehnung } =>
      !!x && typeof x === "object" && typeof (x as { grund?: unknown }).grund === "string" && (x as { grund: string }).grund in KV_EDITOR_TEXT
  );
}

export const ZUSTAENDIG_LABEL: Record<Exclude<Zustaendig, "company">, string> = {
  customer: "Kunde",
  none: "Entfällt",
};

/** „Kottke“, „Ceylan“, sonst „Wir“ (Zuständigkeit `company`). */
export function firmaName(firma: string | null): string {
  if (firma === "kottke") return "Kottke";
  if (firma === "ceylan") return "Ceylan";
  return "Wir";
}

export interface ZustaendigOption {
  wert: Zustaendig;
  label: string;
  gesperrt: boolean;
}

/** Firma nur wählbar, wo die Kalkulation sie vorsieht (Entscheidung 5); sonst ausgegraut. */
export function zustaendigOptionen(f: KvFeld, firma: string | null): ZustaendigOption[] {
  return KV_ZUSTAENDIG.map((wert) => ({
    wert,
    label: wert === "company" ? firmaName(firma) : ZUSTAENDIG_LABEL[wert],
    gesperrt: wert === "company" && !(f.firmaWaehlbar || f.basis === "company"),
  }));
}

/** Anzeige eines Werts in Vorschlag, Verlauf und Konflikt. */
export function wertText(w: KvWert | null, art: KvFeld["art"] | null, firma: string | null): string {
  if (w === null) return "fehlt";
  if (typeof w === "boolean") return w ? "im KV" : "ausgeblendet";
  if (art === "zustaendig" && (KV_ZUSTAENDIG as readonly string[]).includes(w)) {
    return w === "company" ? firmaName(firma) : ZUSTAENDIG_LABEL[w as Exclude<Zustaendig, "company">];
  }
  return w.trim() === "" ? "leer" : w;
}

/** Zeichenzähler „120 / 500“, null ohne Grenze. */
export function zeichenRest(f: KvFeld, w: KvWert): string | null {
  if (f.max === undefined || typeof w !== "string") return null;
  return `${w.trim().length} / ${f.max}`;
}

// ─── Liste → Eingabe (Als neuen Entwurf verwenden, Zusammenführen) ───────────

function wertIn(liste: readonly KvAenderung[], schluessel: string, basisWert: KvWert): KvWert {
  const a = liste.find((x) => x.schluessel === schluessel);
  return a ? a.wert : basisWert;
}

/**
 * Eingabe, die aus dem Stand `vorgaenger` (Liste `vorher`) die Werte `ziel` macht. Für „Als neuen
 * Entwurf verwenden“ (Liste eines älteren Stands auf den neuesten) und das Zusammenführen.
 */
export function eingabeZuWerten(
  basis: KvBasis,
  vorher: readonly KvAenderung[],
  ziel: Readonly<Record<string, KvWert>>,
  vorgaengerId: string
): StandAnlegenEingabe {
  const werte: Record<string, KvWert> = {};
  for (const a of vorher) werte[a.schluessel] = a.wert;
  return formularEingabe(basis, werte, ziel, vorgaengerId);
}

/** Werte eines Stands aus Basis und Liste (nur Felder im Katalog). */
export function werteAusListe(basis: KvBasis, liste: readonly KvAenderung[]): Record<string, KvWert> {
  const out: Record<string, KvWert> = {};
  for (const f of basis.felder) out[f.schluessel] = wertIn(liste, f.schluessel, f.basis);
  return out;
}

export interface MergeKonflikt {
  schluessel: string;
  feld: KvFeld;
  gemeinsam: KvWert;
  meins: KvWert;
  deren: KvWert;
}

export interface MergeErgebnis {
  /** Werte nach dem automatischen Teil (ohne Konflikte: dort der Wert von „deren“). */
  werte: Record<string, KvWert>;
  /** Felder, die nur ich geändert habe (gehen automatisch mit). */
  meineUebernommen: string[];
  konflikte: MergeKonflikt[];
}

/**
 * Dreiwege auf Werten (Spec 10, 409 `STAND_VERALTET`; Grok 9): nur eine Seite geändert → bleibt,
 * beide gleich → eins, beide verschieden → Konflikt, je Feld wählen (keine Automatik).
 * `gemeinsam`: Liste meines Vorgängers; `meins`: meine Formularwerte; `deren`: Liste des neuesten Stands.
 */
export function dreiwege(
  basis: KvBasis,
  gemeinsam: readonly KvAenderung[],
  meins: Readonly<Record<string, KvWert>>,
  deren: readonly KvAenderung[]
): MergeErgebnis {
  const werte: Record<string, KvWert> = {};
  const meineUebernommen: string[] = [];
  const konflikte: MergeKonflikt[] = [];
  for (const f of basis.felder) {
    const k = f.schluessel;
    const g = wertIn(gemeinsam, k, f.basis);
    const d = wertIn(deren, k, f.basis);
    const m = k in meins ? normiert(meins[k]) : g;
    if (gleich(m, d) || gleich(m, g)) {
      werte[k] = d;
    } else if (gleich(d, g)) {
      werte[k] = m;
      meineUebernommen.push(k);
    } else {
      werte[k] = d;
      konflikte.push({ schluessel: k, feld: f, gemeinsam: g, meins: m, deren: d });
    }
  }
  return { werte, meineUebernommen, konflikte };
}

/** Ergebnis des Zusammenführens mit der Wahl je Konflikt → Eingabe auf den neuesten Stand. */
export function mergeEingabe(
  basis: KvBasis,
  e: MergeErgebnis,
  wahl: Readonly<Record<string, "meins" | "deren">>,
  neuester: { id: string; aenderungen: readonly KvAenderung[] }
): StandAnlegenEingabe {
  const ziel: Record<string, KvWert> = { ...e.werte };
  for (const k of e.konflikte) if (wahl[k.schluessel] === "meins") ziel[k.schluessel] = k.meins;
  return eingabeZuWerten(basis, neuester.aenderungen, ziel, neuester.id);
}

/** Alle Konflikte entschieden? */
export function mergeVollstaendig(e: MergeErgebnis, wahl: Readonly<Record<string, "meins" | "deren">>): boolean {
  return e.konflikte.every((k) => wahl[k.schluessel] === "meins" || wahl[k.schluessel] === "deren");
}
