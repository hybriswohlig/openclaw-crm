/**
 * Reine Anzeige-Logik des KV-Editors (Spec 10, 11; Plan Aufgabe 6a): Abzeichen,
 * Zustand der PDF-Fläche, Verlaufszeilen, Pushen und Fehlermeldungen. Keine
 * Netzaufrufe, kein DOM; Zeiten in Europe/Berlin, Texte du, ohne Gedankenstriche.
 */
import { berlinTag, euroText, tagKurz, uhrzeitKurz } from "@/lib/anzeige";
import {
  feldDefFuer,
  KV_ABSCHNITT_TITEL,
  KV_EDITOR_FEHLER,
  KV_EDITOR_TEXT,
  KV_PDF_NICHT_PRUEFBAR_TEXT,
  KV_PREIS_ABWEICHUNG_TEXT,
  type KvEditorAnsicht,
  type KvEditorFehler,
  type KvFeld,
  type KvKonflikt,
  type KvStandKopf,
} from "@/lib/kv-editor";

export type Ton = "jade" | "blau" | "gold" | "rose" | "grau";

/** Abzeichen eines Stands: Aktuell, Entwurf, Wird gedruckt, Fehler, Preisprüfung fehlgeschlagen. */
export function standAbzeichen(s: KvStandKopf): { text: string; ton: Ton } {
  if (s.status === "druckt") return { text: "Wird gedruckt", ton: "grau" };
  if (s.status === "fehler") {
    return preisFehlgeschlagen(s) ? { text: "Preisprüfung fehlgeschlagen", ton: "rose" } : { text: "Fehler", ton: "rose" };
  }
  if (s.aktuell) return { text: "Aktuell", ton: "jade" };
  // War schon einmal der KV des Deals (gepusht oder aus der Kalkulation abgelegt).
  if (s.gepushtAm || s.dealDocumentId) return { text: "Früher aktuell", ton: "grau" };
  return { text: "Entwurf", ton: "blau" };
}

function preisFehlgeschlagen(s: KvStandKopf): boolean {
  return s.pruefung?.preis === "abweichung" || s.pruefung?.preis === "nicht_lesbar";
}

export type PdfAnsicht =
  | { art: "pdf" }
  | { art: "druckt"; text: string }
  | { art: "fehler"; titel: string; text: string; details: string[] };

/**
 * Was die Mitte zeigt. `druckt`: Platzhalter; `fehler`: roter Kasten mit „Neu drucken“
 * (legt einen neuen Stand an, Spec 11). Preisprüfung mit Beträgen, die fehlen oder fremd sind.
 */
export function pdfAnsicht(s: KvStandKopf): PdfAnsicht {
  if (s.status === "druckt") {
    return {
      art: "druckt",
      text: s.renderer === "vps" ? "Der KV wird gedruckt und danach auf den Preis geprüft. Das dauert meist ein bis zwei Minuten." : "Der KV wird gedruckt.",
    };
  }
  if (s.status === "fertig") return { art: "pdf" };
  const p = s.pruefung;
  if (p?.preis === "abweichung") {
    const details: string[] = [];
    if (p.fehlt.length > 0) details.push(`Fehlt im Druck: ${p.fehlt.map(euroText).join(", ")}`);
    if (p.fremd.length > 0) details.push(`Steht zusätzlich im Druck: ${p.fremd.map(euroText).join(", ")}`);
    return { art: "fehler", titel: "Preisprüfung fehlgeschlagen", text: s.fehler ?? KV_PREIS_ABWEICHUNG_TEXT, details };
  }
  if (p?.preis === "nicht_lesbar") {
    return { art: "fehler", titel: "Preisprüfung fehlgeschlagen", text: s.fehler ?? KV_PDF_NICHT_PRUEFBAR_TEXT, details: [] };
  }
  return { art: "fehler", titel: "Druck fehlgeschlagen", text: s.fehler ?? "Der Druck hat nicht geklappt.", details: [] };
}

/** „14:12“ am selben Berliner Tag, sonst „Di 17.11., 14:12“. */
export function zeitText(iso: string, jetzt: Date): string {
  const uhr = uhrzeitKurz(iso);
  return berlinTag(iso) === berlinTag(jetzt.toISOString()) ? uhr : `${tagKurz(iso)}, ${uhr}`;
}

function anzahl(n: number, eins: string, viele: string): string {
  return n === 1 ? `1 ${eins}` : `${n} ${viele}`;
}

/** Offene Konflikte eines Stands (gelber Streifen). */
export function offeneKonflikte(s: KvStandKopf): KvKonflikt[] {
  return s.offen.filter((k) => k.status === "offen");
}

/**
 * Zeilen eines Stands im Verlauf (Spec 10), etwa „14:12 · Dario“, „KI im Auftrag von Dario“,
 * „aus Kalkulation v3, 4 übernommen, 1 offen“, „Aktuell seit 13:50, gepusht von Nuri“.
 */
export function verlaufZeilen(s: KvStandKopf, jetzt: Date): string[] {
  const zeilen: string[] = [];
  const wann = zeitText(s.erstelltAm, jetzt);
  const wer = s.erstelltVon?.name ?? null;
  zeilen.push(wer && s.quelle !== "ki" ? `${wann} · ${wer}` : wann);
  const kalk = s.kalkulationVersion !== null ? `aus Kalkulation v${s.kalkulationVersion}` : "aus der Kalkulation";
  switch (s.quelle) {
    case "ki":
      zeilen.push(`KI im Auftrag von ${wer ?? "unbekannt"}`);
      break;
    case "ausgang":
      zeilen.push(s.grundlageRekonstruiert ? "Ausgangs-KV, entstand vor dem Editor" : "Ausgangs-KV");
      break;
    case "neu":
      zeilen.push(kalk);
      break;
    case "mitgewandert": {
      const offen = offeneKonflikte(s).length;
      zeilen.push(`${kalk}, ${s.aenderungen.length} übernommen${offen > 0 ? `, ${offen} offen` : ""}`);
      break;
    }
    case "hand":
      break;
  }
  if (s.quelle === "hand" || s.quelle === "ki") {
    zeilen.push(s.aenderungen.length === 0 ? "ohne Änderungen" : anzahl(s.aenderungen.length, "Änderung", "Änderungen"));
  }
  if (s.aktuell) {
    zeilen.push(s.gepushtAm ? `Aktuell seit ${zeitText(s.gepushtAm, jetzt)}, gepusht von ${s.gepushtVon?.name ?? "unbekannt"}` : "Aktuell");
  } else if (s.gepushtAm) {
    zeilen.push(`Gepusht ${zeitText(s.gepushtAm, jetzt)} von ${s.gepushtVon?.name ?? "unbekannt"}`);
  }
  return zeilen;
}

/** Pushen zeigen: fertiger, noch nie gepushter Entwurf, bei VPS nur mit bestandener Preisprüfung. */
export function pushbar(s: KvStandKopf): boolean {
  if (s.status !== "fertig" || s.aktuell || s.gepushtAm !== null) return false;
  return s.pruefung === null || s.pruefung.preis === "ok";
}

export type PushModus = "einfach" | "annahme_admin" | "annahme_gesperrt";

/** Ohne Annahme einfache Rückfrage; mit Annahme nur ein Admin (Spec 10, Plan 16). */
export function pushModus(a: Pick<KvEditorAnsicht, "annahme">): PushModus {
  if (!a.annahme.aktiv) return "einfach";
  return a.annahme.aufhebenErlaubt ? "annahme_admin" : "annahme_gesperrt";
}

function istFehlerCode(c: string | null): c is KvEditorFehler {
  return c !== null && (KV_EDITOR_FEHLER as readonly string[]).includes(c);
}

/**
 * Meldung zu einem Fehler der Routen (`{ error: { code, message, daten } }`). Bekannte Codes
 * nehmen den Text aus `KV_EDITOR_TEXT`, ergänzt um die Zusatzdaten; sonst die Meldung des Servers.
 */
export function fehlerText(code: string | null, message: string, daten?: unknown): string {
  if (!istFehlerCode(code)) return message;
  const d = (daten ?? {}) as Record<string, unknown>;
  if (code === "ANGABEN_FEHLEN" && typeof d.text === "string" && d.text.trim()) return d.text;
  if (code === "AKTUELL_GEAENDERT" && typeof d.aktuellStandNummer === "number") {
    const von = typeof d.gepushtVon === "string" && d.gepushtVon ? `${d.gepushtVon} hat` : "Jemand hat";
    return `${von} inzwischen Stand ${d.aktuellStandNummer} gepusht.`;
  }
  if (code === "KALKULATION_NEU" && typeof d.kalkulationVersion === "number") {
    return `Die Kalkulation ist inzwischen bei v${d.kalkulationVersion}. Übertrag deine Änderungen auf den neuen KV.`;
  }
  return KV_EDITOR_TEXT[code];
}

/** Beschriftung eines Felds für Verlauf, Vorschlag und Konflikt: „Transport, Notiz“. */
export function feldTitel(f: Pick<KvFeld, "gruppe" | "label">): string {
  return f.gruppe ? `${f.gruppe}, ${f.label}` : f.label;
}

/**
 * Feldtitel zu einem Schlüssel: aus dem Katalog, sonst aus der festen Felderliste (bei Zeilen wie
 * Umzugsgut mit Abschnitt, „Umzugsgut, Notiz“, weil die Zeile fehlt), sonst der Schlüssel.
 */
export function schluesselTitel(schluessel: string, felder: readonly KvFeld[], renderer: KvStandKopf["renderer"]): string {
  const f = felder.find((x) => x.schluessel === schluessel);
  if (f) return feldTitel(f);
  const d = feldDefFuer(renderer, schluessel);
  if (!d) return schluessel;
  return d.ziel && "platzhalter" in d.ziel ? `${KV_ABSCHNITT_TITEL[d.abschnitt]}, ${d.label}` : d.label;
}

/** Text eines Konflikts im gelben Streifen (Spec 7.6 Schritt 5). */
export function konfliktText(k: KvKonflikt): string {
  switch (k.art) {
    case "basis_geaendert":
      return "Im neuen KV steht hier inzwischen etwas anderes.";
    case "ziel_fehlt":
      return "Diese Zeile gibt es im neuen KV nicht mehr.";
    case "nicht_erlaubt":
      return "Im Preis nicht mehr enthalten. Über die Kalkulation ändern.";
  }
}
