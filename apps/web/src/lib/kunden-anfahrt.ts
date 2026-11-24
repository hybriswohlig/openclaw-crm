/**
 * Kunden-Anfahrt: immer ab Firmensitz bzw. eigenem Depot der Gesellschaft,
 * nie ab der Mietstation. Die Fahrt zur Mietstation bleibt eine interne
 * Kostenposition (Rechner, `rechnerHinweis`) und erscheint hier nicht.
 */

export interface KundenAnfahrt {
  km: number;
  minuten: number;
  quelle: "berechnet" | "manuell";
}

const KM = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

/** Briefkopf-Sitz. Mietstationen (Sixt) sind keine Firmensitze. */
export function firmensitzAdresse(firma: string | null | undefined): string | null {
  const f = (firma ?? "").toLowerCase();
  if (!f) return null;
  if (f.includes("ceylan")) return "Kapellenberg 13, 72218 Wildberg";
  if (f.includes("kottke")) return "Marktstr. 8, 72218 Wildberg";
  return null;
}

function zahl(wert: unknown): number | null {
  const n = typeof wert === "number" ? wert : typeof wert === "string" && wert.trim() !== "" ? Number(wert) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Nur die Strecke ab dem Sitz. Mietstation und die Gesamtfahrzeit des Rechners
 * (Abholung plus Rückgabe) werden ignoriert, auch wenn sie mitgegeben werden.
 */
export function kundenAnfahrt(input: {
  abSitz?: { km?: number | null; minuten?: number | null; quelle?: "berechnet" | "manuell" | null } | null;
  mietstation?: unknown;
  fahrtMinGesamt?: number | null;
}): KundenAnfahrt | null {
  void input.mietstation;
  void input.fahrtMinGesamt;
  const km = zahl(input.abSitz?.km);
  const minuten = zahl(input.abSitz?.minuten);
  if (km === null || minuten === null) return null;
  if (km < 0 || minuten < 0) return null;
  if (km === 0 && minuten === 0) return null;
  return {
    km: Math.round(km * 10) / 10,
    minuten: Math.round(minuten),
    quelle: input.abSitz?.quelle === "manuell" ? "manuell" : "berechnet",
  };
}

/**
 * Sichtbarer Text. Ohne Kilometer (alter Stand nur mit Minuten, oft die
 * Mietstation) kein Text: eine nackte Zahl ohne Einheit soll nicht erscheinen.
 */
export function anfahrtKundenText(a: { anfahrtKm?: number | null; anfahrtMinuten?: number | null } | null | undefined): string | null {
  const km = zahl(a?.anfahrtKm);
  if (km === null || km < 0) return null;
  const kmText = KM.format(km);
  const minuten = zahl(a?.anfahrtMinuten);
  if (minuten !== null && minuten >= 0) return `ca. ${kmText} km (ca. ${Math.round(minuten)} Min.)`;
  return `ca. ${kmText} km`;
}

/** Ganzer Satz fürs Portal, z. B. „Anfahrt ca. 15 km (ca. 20 Min.)“. */
export function anfahrtKundenSatz(a: { anfahrtKm?: number | null; anfahrtMinuten?: number | null } | null | undefined): string | null {
  const text = anfahrtKundenText(a);
  return text ? `Anfahrt ${text}` : null;
}
