/**
 * Reine KI-Normalisierung des KV-Editors (Plan Aufgabe 4a, Vertrag `KvEditorKiRein`).
 *
 * Liest die Modellantwort, prüft Änderungen über `pruefeEingabe` und baut Vorschläge.
 * Kein Netz, keine Datenbank. Den Prompt und den Aufruf baut Aufgabe 4b.
 */
import { pruefeEingabe } from "@/lib/kv-editor-anwenden";
import {
  KV_ABSCHNITT_TITEL,
  KV_KI_LEER_TEXT,
  KV_KI_MAX_AENDERUNGEN,
  type KiNormalisiert,
  type KvAblehnung,
  type KvBasis,
  type KvEditorKiRein,
  type KvFeld,
  type KvWert,
} from "@/lib/kv-editor";

const ANTWORT_MAX = 2000;
const VORSCHLAG_TEXT = "Hier ist mein Vorschlag.";

type Zwischen =
  | { art: "struktur" }
  | { art: "abgelehnt"; schluessel: string; grund: KvAblehnung }
  | { art: "gleich" }
  | { art: "vorschlag"; vorschlag: KiNormalisiert["vorschlaege"][number] };

function istDatensatz(wert: unknown): wert is Record<string, unknown> {
  return typeof wert === "object" && wert !== null && !Array.isArray(wert);
}

/** Erstes `{` bis letztes `}`. Ein ```json-Zaun wird vorher abgestreift. */
function datensatzAusText(text: string): Record<string, unknown> | null {
  const zaun = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const quelle = zaun ? zaun[1] : text;
  const start = quelle.indexOf("{");
  const ende = quelle.lastIndexOf("}");
  if (start < 0 || ende <= start) return null;
  try {
    const parsed: unknown = JSON.parse(quelle.slice(start, ende + 1));
    return istDatensatz(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function kommasAufraeumen(text: string): string {
  let aus = text;
  let vorher = "";
  while (aus !== vorher) {
    vorher = aus;
    aus = aus.replace(/ +,/g, ",").replace(/,{2,}/g, ",");
  }
  return aus.replace(/,+$/g, "");
}

/** Ersetzt Gedankenstriche (U+2014, U+2013). Bindestriche in Wörtern bleiben. */
export function ohneGedankenstrich(text: string): string {
  const aus = text
    .replace(/(^|\n)[\u2014\u2013][^\S\n]+/g, "$1- ")
    .replace(/(?<=\d)[\u2014\u2013](?=\d)/g, "-")
    .replace(/[^\S\n]+[\u2014\u2013][^\S\n]+/g, ", ")
    .replace(/[\u2014\u2013]/g, ", ");
  return kommasAufraeumen(aus);
}

function katalogZelle(text: string): string {
  return text.replace(/\|/g, "/").replace(/\r?\n/g, " ");
}

function werteVon(feld: KvFeld): string {
  if (feld.art === "zustaendig") return feld.firmaWaehlbar ? "company, customer, none" : "customer, none";
  if (feld.art === "zeigen") return "true, false";
  return "Text";
}

/** Kopfzeile, dann je Feld des Katalogs eine Zeile für den Prompt. */
export function katalogZeilen(basis: KvBasis, aktuell: Record<string, KvWert>): string[] {
  const zeilen = ["schluessel | Abschnitt | Gruppe | Label | Art | Werte | max | aktuell"];
  for (const feld of basis.felder) {
    zeilen.push(
      [
        feld.schluessel,
        KV_ABSCHNITT_TITEL[feld.abschnitt],
        katalogZelle(feld.gruppe ?? ""),
        katalogZelle(feld.label),
        feld.art,
        werteVon(feld),
        feld.max ?? "",
        JSON.stringify(aktuell[feld.schluessel] ?? feld.basis),
      ].join(" | ")
    );
  }
  return zeilen;
}

function bewerte(
  basis: KvBasis,
  felder: Map<string, KvFeld>,
  aktuell: Record<string, KvWert>,
  schluessel: string,
  wert: unknown
): Zwischen {
  const pruef = pruefeEingabe(basis, [{ schluessel, wert }]);
  const abgelehnt = pruef.abgelehnt[0];
  if (abgelehnt) return { art: "abgelehnt", schluessel, grund: abgelehnt.grund };
  const ok = pruef.ok[0];
  if (!ok) return { art: "abgelehnt", schluessel, grund: "UNBEKANNT" };
  const feld = felder.get(schluessel);
  const vorher = feld ? (aktuell[schluessel] ?? feld.basis) : ok.vorher;
  if (ok.wert === vorher) return { art: "gleich" };
  return { art: "vorschlag", vorschlag: { schluessel, wert: ok.wert, vorher } };
}

function unlesbar(text: string): KiNormalisiert {
  const getrimmt = text.trim();
  const antwort = getrimmt !== "" && !getrimmt.startsWith("{") ? ohneGedankenstrich(getrimmt) : KV_KI_LEER_TEXT;
  return { antwort, vorschlaege: [], abgelehnt: [{ schluessel: null, grund: "LEER" }] };
}

/** Macht aus der rohen Modellantwort Vorschläge, Ablehnungen und den Antworttext. */
export function kiAntwortNormalisieren(roh: unknown, basis: KvBasis, aktuell: Record<string, KvWert>): KiNormalisiert {
  const objekt = typeof roh === "string" ? datensatzAusText(roh.trim()) : istDatensatz(roh) ? roh : null;
  if (!objekt) return unlesbar(typeof roh === "string" ? roh : "");

  const eintraege = Array.isArray(objekt.aenderungen) ? objekt.aenderungen.slice(0, KV_KI_MAX_AENDERUNGEN) : [];
  const felder = new Map(basis.felder.map((feld) => [feld.schluessel, feld]));
  const reihe = new Map(basis.felder.map((feld, index) => [feld.schluessel, index]));
  const stellen = new Map<string, number>();
  const slots: Zwischen[] = [];

  for (const eintrag of eintraege) {
    if (!istDatensatz(eintrag) || typeof eintrag.schluessel !== "string") {
      slots.push({ art: "struktur" });
      continue;
    }
    const wert = typeof eintrag.wert === "string" ? ohneGedankenstrich(eintrag.wert) : eintrag.wert;
    const ergebnis = bewerte(basis, felder, aktuell, eintrag.schluessel, wert);
    const vorherige = stellen.get(eintrag.schluessel);
    if (vorherige === undefined) {
      stellen.set(eintrag.schluessel, slots.length);
      slots.push(ergebnis);
    } else {
      slots[vorherige] = ergebnis;
    }
  }

  const abgelehnt: KiNormalisiert["abgelehnt"] = [];
  const vorschlaege: KiNormalisiert["vorschlaege"] = [];
  let gleichWeg = 0;
  for (const slot of slots) {
    if (slot.art === "struktur") abgelehnt.push({ schluessel: null, grund: "UNBEKANNT" });
    else if (slot.art === "abgelehnt") abgelehnt.push({ schluessel: slot.schluessel, grund: slot.grund });
    else if (slot.art === "gleich") gleichWeg += 1;
    else vorschlaege.push(slot.vorschlag);
  }
  vorschlaege.sort((a, b) => (reihe.get(a.schluessel) ?? 0) - (reihe.get(b.schluessel) ?? 0));

  const rohAntwort = objekt.antwort;
  let antwort =
    typeof rohAntwort === "string" && rohAntwort.trim() !== ""
      ? ohneGedankenstrich(rohAntwort.trim()).slice(0, ANTWORT_MAX)
      : vorschlaege.length > 0
        ? VORSCHLAG_TEXT
        : KV_KI_LEER_TEXT;

  if (eintraege.length > 0 && vorschlaege.length === 0 && gleichWeg === 0) {
    abgelehnt.push({ schluessel: null, grund: "LEER" });
    if (!antwort.includes(KV_KI_LEER_TEXT)) antwort = `${antwort}\n\n${KV_KI_LEER_TEXT}`;
  }

  return { antwort, vorschlaege, abgelehnt };
}

const _vertrag: KvEditorKiRein = { kiAntwortNormalisieren, ohneGedankenstrich, katalogZeilen };
void _vertrag;
