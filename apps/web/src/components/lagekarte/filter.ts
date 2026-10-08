/**
 * Lagekarte: Filter als reine Funktionen (kein React, kein DOM). Der Zustand
 * lebt in der URL, siehe use-karten-filter.ts.
 *
 * URL-Schlüssel: status (kommagetrennt), wartet=1, firma (kommagetrennt,
 * "ohne" = Leads ohne Firma), zeit, wert (Euro), q. Andere Schlüssel (lead,
 * ansicht) gehören nicht zum Filter und bleiben beim Schreiben erhalten.
 */
import { STATUS_STIL } from "@/lib/lagekarte/farben";
import { KARTEN_STATUS_REIHENFOLGE, type KartenStatus, type LeadPunkt } from "@/lib/lagekarte/typen";

export type Zeitraum = "30" | "90" | "365" | "alle";

export interface KartenFilter {
  /** Standard: alle Status mit STATUS_STIL[s].standardSichtbar. */
  status: KartenStatus[];
  nurWartet: boolean;
  /** Firmen-IDs und/oder "ohne" (Leads ohne Firma); leer = alle. */
  firmen: string[];
  /** Nach angelegtAm. */
  zeitraum: Zeitraum;
  /** Euro (nicht Cent). Leads ohne Wert fallen raus, wenn gesetzt. */
  wertAbEuro: number | null;
  suche: string;
}

/** Firmen-Wert für Leads ohne Firma. */
export const FIRMA_OHNE = "ohne";

const TAG_MS = 24 * 60 * 60 * 1000;

const ZEITRAUM_TAGE: Record<Exclude<Zeitraum, "alle">, number> = { "30": 30, "90": 90, "365": 365 };

export const STANDARD_FILTER: KartenFilter = {
  status: KARTEN_STATUS_REIHENFOLGE.filter((s) => STATUS_STIL[s].standardSichtbar),
  nurWartet: false,
  firmen: [],
  zeitraum: "alle",
  wertAbEuro: null,
  suche: "",
};

/**
 * Wie viele der Filter, die die schmale Legende hinter dem Knopf „Filter“
 * zusammenfasst (Firma, Eingang, Wert), weichen vom Standard ab? Je Art 1.
 */
export function weitereFilterAktiv(f: KartenFilter): number {
  return (
    (f.firmen.length > 0 ? 1 : 0) +
    (f.zeitraum !== STANDARD_FILTER.zeitraum ? 1 : 0) +
    (f.wertAbEuro !== STANDARD_FILTER.wertAbEuro ? 1 : 0)
  );
}

/** URL-Schlüssel, die dieses Modul besitzt. */
const FILTER_SCHLUESSEL = ["status", "wartet", "firma", "zeit", "wert", "q"] as const;

function istStatus(wert: string): wert is KartenStatus {
  return (KARTEN_STATUS_REIHENFOLGE as string[]).includes(wert);
}

function istZeitraum(wert: string | null): wert is Zeitraum {
  return wert === "30" || wert === "90" || wert === "365" || wert === "alle";
}

function liste(wert: string): string[] {
  const teile = wert
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return [...new Set(teile)];
}

/** Gültige Status in fester Reihenfolge, ohne Doppelte. */
function normiereStatus(status: readonly KartenStatus[]): KartenStatus[] {
  return KARTEN_STATUS_REIHENFOLGE.filter((s) => status.includes(s));
}

function gleicheStatus(a: readonly KartenStatus[], b: readonly KartenStatus[]): boolean {
  const na = normiereStatus(a);
  const nb = normiereStatus(b);
  return na.length === nb.length && na.every((s, i) => s === nb[i]);
}

/**
 * Liest den Filter aus der URL. Unbekannte Werte werden ignoriert.
 * Sonderfall status: fehlt der Schlüssel oder ist kein Wert gültig, gilt der
 * Standard; ein ausdrücklich leerer Wert ("status=") heißt "kein Status".
 */
export function filterAusUrl(params: URLSearchParams): KartenFilter {
  let status = STANDARD_FILTER.status;
  const statusRoh = params.get("status");
  if (statusRoh !== null) {
    if (statusRoh === "") {
      status = [];
    } else {
      const gueltig = liste(statusRoh).filter(istStatus);
      if (gueltig.length > 0) status = normiereStatus(gueltig);
    }
  }

  const zeitRoh = params.get("zeit");
  const zeitraum: Zeitraum = istZeitraum(zeitRoh) ? zeitRoh : STANDARD_FILTER.zeitraum;

  const wertRoh = params.get("wert");
  const wertZahl = wertRoh === null || wertRoh.trim() === "" ? NaN : Number(wertRoh);
  const wertAbEuro = Number.isFinite(wertZahl) && wertZahl > 0 ? wertZahl : null;

  return {
    status: [...status],
    nurWartet: params.get("wartet") === "1",
    firmen: liste(params.get("firma") ?? ""),
    zeitraum,
    wertAbEuro,
    suche: (params.get("q") ?? "").trim(),
  };
}

/**
 * Schreibt den Filter in eine URL. Standardwerte entfallen, fremde Parameter
 * aus `basis` bleiben erhalten (basis wird nicht verändert).
 */
export function filterZuUrl(f: KartenFilter, basis?: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(basis);
  for (const schluessel of FILTER_SCHLUESSEL) params.delete(schluessel);

  if (!gleicheStatus(f.status, STANDARD_FILTER.status)) params.set("status", normiereStatus(f.status).join(","));
  if (f.nurWartet) params.set("wartet", "1");
  if (f.firmen.length > 0) params.set("firma", [...new Set(f.firmen)].join(","));
  if (f.zeitraum !== STANDARD_FILTER.zeitraum) params.set("zeit", f.zeitraum);
  if (f.wertAbEuro !== null && Number.isFinite(f.wertAbEuro) && f.wertAbEuro > 0) params.set("wert", String(f.wertAbEuro));
  const suche = f.suche.trim();
  if (suche) params.set("q", suche);
  return params;
}

function passtZurSuche(lead: LeadPunkt, nadel: string): boolean {
  const felder = [lead.name, lead.nummer, lead.ort?.ortsname, lead.ort?.plz];
  return felder.some((feld) => feld != null && feld.toLowerCase().includes(nadel));
}

/** Alle Kriterien außer Status. */
function passtOhneStatus(lead: LeadPunkt, f: KartenFilter, grenzeMs: number | null, nadel: string, centMin: number | null): boolean {
  if (f.nurWartet && lead.wartet === null) return false;
  if (f.firmen.length > 0 && !f.firmen.includes(lead.firmaId ?? FIRMA_OHNE)) return false;
  if (grenzeMs !== null && !(Date.parse(lead.angelegtAm) >= grenzeMs)) return false;
  if (centMin !== null && (lead.wert === null || lead.wert.cent < centMin)) return false;
  if (nadel && !passtZurSuche(lead, nadel)) return false;
  return true;
}

function vorbereiten(f: KartenFilter, jetzt: Date) {
  const grenzeMs = f.zeitraum === "alle" ? null : jetzt.getTime() - ZEITRAUM_TAGE[f.zeitraum] * TAG_MS;
  const nadel = f.suche.trim().toLowerCase();
  const centMin = f.wertAbEuro === null ? null : Math.round(f.wertAbEuro * 100);
  return { grenzeMs, nadel, centMin };
}

export function filtereLeads(leads: LeadPunkt[], f: KartenFilter, jetzt: Date): LeadPunkt[] {
  const { grenzeMs, nadel, centMin } = vorbereiten(f, jetzt);
  return leads.filter((lead) => f.status.includes(lead.status) && passtOhneStatus(lead, f, grenzeMs, nadel, centMin));
}

/** Zahlen je Status bei sonst gleichem Filter (der Status-Filter selbst wird ignoriert). */
export function zaehleStatus(leads: LeadPunkt[], f: KartenFilter, jetzt: Date): Record<KartenStatus, number> {
  const { grenzeMs, nadel, centMin } = vorbereiten(f, jetzt);
  const zahlen = Object.fromEntries(KARTEN_STATUS_REIHENFOLGE.map((s) => [s, 0])) as Record<KartenStatus, number>;
  for (const lead of leads) {
    if (passtOhneStatus(lead, f, grenzeMs, nadel, centMin)) zahlen[lead.status] += 1;
  }
  return zahlen;
}

/**
 * Sucht die Auswahl in der UNGEFILTERTEN Liste, damit sie nach Polling und
 * Filterwechsel stabil bleibt. imFilter sagt, ob sie auch im Filter liegt.
 */
export function behalteAuswahl(
  auswahlId: string | null,
  alle: LeadPunkt[],
  gefiltert: LeadPunkt[],
): { lead: LeadPunkt | null; imFilter: boolean } {
  if (auswahlId === null) return { lead: null, imFilter: false };
  const lead = alle.find((l) => l.id === auswahlId) ?? null;
  if (lead === null) return { lead: null, imFilter: false };
  return { lead, imFilter: gefiltert.some((l) => l.id === auswahlId) };
}
