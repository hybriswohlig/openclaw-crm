/**
 * Formularzustand für „Kunde und Adressen“ (Akte) und das Fenster „Es fehlen
 * noch Angaben“ (vor KV/AB/RE). Rein: Entwurf aus den gespeicherten Daten,
 * Vorschläge aus dem Chat einsetzen, Änderungen für PUT …/kunde bilden.
 */
import type { AdressTeile, DealKunde, KundeEingabe, KundeVorschlag } from "./deal-kunde";
import type { PflichtFeld } from "./kv-vorpruefung";

export type KundeFeld = "name" | "telefon" | "email" | "auszug" | "einzug" | "datum";

export interface KundeEntwurf {
  name: string;
  telefon: string;
  email: string;
  auszug: AdressTeile;
  einzug: AdressTeile;
  /** Einzug noch offen (Inhaber 10.11.): ersetzt den Einzug, gilt als erfüllt. */
  einzugOffen: boolean;
  datum: string;
}

export const ALLE_FELDER: KundeFeld[] = ["name", "telefon", "email", "auszug", "einzug", "datum"];

const LEER: AdressTeile = { strasse: "", plz: "", ort: "" };

export function entwurfAus(k: DealKunde | null): KundeEntwurf {
  return {
    name: k?.name ?? "",
    telefon: k?.telefon ?? "",
    email: k?.email ?? "",
    auszug: { ...(k?.auszug ?? LEER) },
    einzug: { ...(k?.einzug ?? LEER) },
    einzugOffen: k?.einzugOffen ?? false,
    datum: k?.datum ?? "",
  };
}

/** Pflichtfeld der Vorprüfung → Formularfeld. */
export function feldAusPflicht(p: PflichtFeld): KundeFeld {
  return p === "kundenname" ? "name" : p;
}

const adresseLeer = (a: AdressTeile) => !a.strasse.trim() && !a.plz.trim() && !a.ort.trim();
const adresseGleich = (a: AdressTeile, b: AdressTeile) =>
  a.strasse.trim() === b.strasse.trim() && a.plz.trim() === b.plz.trim() && a.ort.trim() === b.ort.trim();

/** Ist das Feld im Entwurf leer? Eine Adresse braucht mindestens PLZ und Ort. */
export function feldLeer(e: KundeEntwurf, f: KundeFeld): boolean {
  // Einzug (Entscheidung 10.11.): „noch offen“ oder PLZ und/oder Ort; die Kundenanschrift braucht PLZ und Ort.
  if (f === "einzug") return !e.einzugOffen && !e.einzug.ort.trim() && !e.einzug.plz.trim();
  if (f === "auszug") return !e[f].plz.trim() || !e[f].ort.trim();
  return !e[f].trim();
}

/**
 * Vorschläge aus dem Chat in den Entwurf: jeder Vorschlag ersetzt den Wert des
 * Felds (nur zum Prüfen, gespeichert wird erst nach Klick). `gesetzt` nennt die
 * Felder, die sich dadurch geändert haben. Eine Adresse ohne Straße behält eine
 * schon eingetragene Straße nicht, wenn PLZ oder Ort wechseln.
 */
export function vorschlagEinsetzen(
  e: KundeEntwurf,
  v: KundeVorschlag,
  felder: readonly KundeFeld[] = ALLE_FELDER
): { entwurf: KundeEntwurf; gesetzt: KundeFeld[] } {
  const neu: KundeEntwurf = { ...e, auszug: { ...e.auszug }, einzug: { ...e.einzug } };
  const gesetzt: KundeFeld[] = [];
  const darf = (f: KundeFeld) => felder.includes(f);
  for (const f of ["name", "telefon", "email"] as const) {
    const w = v[f];
    if (darf(f) && w && w !== e[f]) {
      neu[f] = w;
      gesetzt.push(f);
    }
  }
  for (const f of ["auszug", "einzug"] as const) {
    const w = v[f];
    if (!darf(f) || !w) continue;
    const gleichePlz = w.plz === e[f].plz;
    const ziel: AdressTeile = {
      strasse: w.strasse || (gleichePlz ? e[f].strasse : ""),
      plz: w.plz,
      ort: w.ort,
      ...(gleichePlz && e[f].zusatz ? { zusatz: e[f].zusatz } : {}),
    };
    if (!adresseGleich(ziel, e[f]) || (f === "einzug" && e.einzugOffen)) {
      neu[f] = ziel;
      if (f === "einzug") neu.einzugOffen = false;
      gesetzt.push(f);
    }
  }
  return { entwurf: neu, gesetzt };
}

/**
 * Body für PUT …/kunde: nur geänderte, ausgefüllte Felder aus `felder`.
 * Geleerte Felder werden nicht gesendet (der Dienst leert nichts).
 */
export function aenderungen(
  e: KundeEntwurf,
  gespeichert: DealKunde | null,
  felder: readonly KundeFeld[] = ALLE_FELDER
): KundeEingabe {
  const alt = entwurfAus(gespeichert);
  const out: KundeEingabe = {};
  if (felder.includes("einzug") && e.einzugOffen !== alt.einzugOffen) out.einzugOffen = e.einzugOffen;
  for (const f of felder) {
    if (f === "einzug" && e.einzugOffen) continue;
    if (f === "auszug" || f === "einzug") {
      if (!adresseLeer(e[f]) && !adresseGleich(e[f], alt[f])) {
        // Zusatz („3. OG“) aus dem gespeicherten Stand mitschicken, damit er erhalten bleibt.
        const zusatz = e[f].zusatz?.trim();
        out[f] = { strasse: e[f].strasse.trim(), plz: e[f].plz.trim(), ort: e[f].ort.trim(), ...(zusatz ? { zusatz } : {}) };
      }
      continue;
    }
    const w = e[f].trim();
    if (w && w !== alt[f].trim()) out[f] = w;
  }
  return out;
}

/** Text unter dem Knopf „Aus dem Chat übernehmen“ nach dem Lesen. */
export function vorschlagHinweis(v: KundeVorschlag, gesetzt: readonly KundeFeld[]): string {
  if (gesetzt.length === 0) return v.hinweis ?? "Im Chat steht nichts Neues zu Name, Adresse oder E-Mail.";
  const quelle =
    v.quelle === "erkennung"
      ? "aus den Nachrichten erkannt, nur PLZ und Ort"
      : v.quelle === "ki_gespeichert"
        ? "aus der letzten KI-Analyse"
        : "aus dem Chat";
  const text = `${gesetzt.length === 1 ? "Ein Feld" : `${gesetzt.length} Felder`} ${quelle} eingesetzt. Bitte prüfen, gespeichert wird erst mit „Speichern“.`;
  return v.hinweis ? `${text} ${v.hinweis}` : text;
}
