import type { FirmaBranding } from "@openclaw-crm/customer-portal-core";

/** Das Festangebot als Brief: reine Texte und Daten, ohne React. */
export type BriefZustand = "offen" | "abgelaufen" | "angenommen" | "unterschrieben";

export function briefZustand(i: { angenommen: boolean; unterschrieben: boolean; abgelaufen: boolean }): BriefZustand {
  if (i.unterschrieben) return "unterschrieben";
  if (i.angenommen) return "angenommen";
  return i.abgelaufen ? "abgelaufen" : "offen";
}

export function briefAnrede(name: string | null): string {
  const n = name?.trim();
  return n ? `Guten Tag ${n},` : "Guten Tag,";
}

export function briefEinleitung(z: BriefZustand, moveDateLabel: string | null, angenommenAmLabel: string | null): string {
  if (z === "abgelaufen") return "dieses Angebot ist abgelaufen. Schreiben Sie uns kurz, dann schicken wir Ihnen ein aktuelles.";
  if (z === "offen") {
    const termin = moveDateLabel ? ` am ${moveDateLabel}` : "";
    return `hier ist Ihr Festpreis für den Umzug${termin}. Wenn alles passt, nehmen Sie das Angebot unten an.`;
  }
  const dank = `vielen Dank, Sie haben das Angebot${angenommenAmLabel ? ` am ${angenommenAmLabel}` : ""} angenommen. Die Auftragsbestätigung folgt nach unserer Einsatzplanung.`;
  return z === "unterschrieben" ? `${dank} Ihren unterschriebenen Vertrag finden Sie unten.` : dank;
}

export function grussZeilen(b: FirmaBranding): { gruss: string; name: string | null; rolle: string | null } {
  const a = b.ansprechpartner;
  return a
    ? { gruss: "Herzliche Grüße", name: a.name, rolle: a.rolle }
    : { gruss: "Herzliche Grüße", name: `Ihr Team von ${b.displayName}`, rolle: null };
}

export type Stempel = { art: "angenommen" | "unterschrieben"; datum: string };

const stempelDatum = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" });

export function stempel(i: { signedAt: string | null; unterschriftAt: string | null }): Stempel[] {
  const out: Stempel[] = [];
  if (i.signedAt) out.push({ art: "angenommen", datum: stempelDatum(i.signedAt) });
  if (i.signedAt && i.unterschriftAt) out.push({ art: "unterschrieben", datum: stempelDatum(i.unterschriftAt) });
  return out;
}

export function strecke(
  from: string | null,
  to: string | null,
): { zeilen: { label: "Von" | "Nach"; adresse: string }[]; mitLinie: boolean } | null {
  const zeilen: { label: "Von" | "Nach"; adresse: string }[] = [];
  if (from?.trim()) zeilen.push({ label: "Von", adresse: from.trim() });
  if (to?.trim()) zeilen.push({ label: "Nach", adresse: to.trim() });
  return zeilen.length ? { zeilen, mitLinie: zeilen.length === 2 } : null;
}
