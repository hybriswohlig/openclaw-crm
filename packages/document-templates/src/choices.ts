import { formatEur, formatGermanDate } from "./money";
import type { AddressForm, ChoicesView, OfferChoices } from "./types";

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** 2026-11-21 → „Sa., 21.11.2026“. Andere Texte bleiben, wie sie sind. */
export function choiceDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return formatGermanDate(iso);
  const tag = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${WOCHENTAG[tag]}., ${formatGermanDate(iso)}`;
}

/** Satz unter dem Block, in der Anrede des Dokuments. [Kunde] */
export const CHOICE_NOTE: Record<AddressForm, string> = {
  sie: "Den Preis legen Sie mit Ihrer Wahl im Kundenportal fest.",
  du: "Den Preis legst du mit deiner Wahl im Kundenportal fest.",
};

/**
 * Block „Wählbare Optionen“ und die Überschrift über den Posten.
 *
 * Nur bei mehr als einer Wahl mit Preis, und nur wenn die Wahl oben im Dokument
 * genau einen dieser Preise trägt (sonst stünden zwei Wahrheiten im PDF und der
 * KV bleibt wie heute). Gedruckt werden nur Kundenpreise.
 */
export function buildChoices(input: {
  choices: OfferChoices | null | undefined;
  totalCents: number;
  addressForm: AddressForm;
}): { view: ChoicesView; offerLabel: string } | null {
  const c = input.choices;
  if (!c) return null;
  const preis = (packageSlug: string | null, date: string | null): number | null => {
    const hit = c.prices.find((p) => p.packageSlug === packageSlug && p.date === date);
    return hit && hit.priceCents !== null && Number.isFinite(hit.priceCents) ? hit.priceCents : null;
  };
  const paketName = new Map(c.packages.map((p) => [p.slug, p.name.trim() || p.slug]));
  const mitPaketen = c.packages.length > 0;
  const mitTagen = c.days.length > 0;
  if (!mitPaketen && !mitTagen) return null;

  // Nur Zellen, die es in dieser Form wirklich gibt (Paket × Tag, nur Paket, nur Tag).
  const zellen: Array<{ packageSlug: string | null; date: string | null }> = [];
  if (mitPaketen && mitTagen) {
    for (const d of c.days) for (const p of c.packages) zellen.push({ packageSlug: p.slug, date: d });
  } else if (mitPaketen) {
    for (const p of c.packages) zellen.push({ packageSlug: p.slug, date: null });
  } else {
    for (const d of c.days) zellen.push({ packageSlug: null, date: d });
  }
  if (zellen.filter((z) => preis(z.packageSlug, z.date) !== null).length <= 1) return null;

  const cur = c.current ?? null;
  if (!cur) return null;
  const curInForm = zellen.some((z) => z.packageSlug === cur.packageSlug && z.date === cur.date);
  if (!curInForm || preis(cur.packageSlug, cur.date) !== input.totalCents) return null;
  const istAktuell = (packageSlug: string | null, date: string | null) =>
    packageSlug === cur.packageSlug && date === cur.date;
  const zelle = (packageSlug: string | null, date: string | null) => {
    const cents = preis(packageSlug, date);
    return { label: cents === null ? "" : formatEur(cents), current: istAktuell(packageSlug, date) };
  };

  let view: ChoicesView;
  let offerLabel: string;
  const note = CHOICE_NOTE[input.addressForm];
  if (mitPaketen && mitTagen) {
    view = {
      layout: "table",
      header: ["Termin", ...c.packages.map((p) => paketName.get(p.slug) ?? p.slug)],
      rows: c.days
        .map((d) => ({ label: choiceDayLabel(d), cells: c.packages.map((p) => zelle(p.slug, d)) }))
        .filter((row) => row.cells.some((cell) => cell.label)),
      note,
    };
    offerLabel = `Preis für ${paketName.get(cur.packageSlug ?? "") ?? ""} am ${choiceDayLabel(cur.date ?? "")}`;
  } else if (mitPaketen) {
    view = {
      layout: "list",
      header: ["Paket", "Preis"],
      rows: c.packages
        .map((p) => ({ label: paketName.get(p.slug) ?? p.slug, cells: [zelle(p.slug, null)] }))
        .filter((row) => row.cells[0].label),
      note,
    };
    offerLabel = `Preis für ${paketName.get(cur.packageSlug ?? "") ?? ""}`;
  } else {
    view = {
      layout: "list",
      header: ["Termin", "Preis"],
      rows: c.days
        .map((d) => ({ label: choiceDayLabel(d), cells: [zelle(null, d)] }))
        .filter((row) => row.cells[0].label),
      note,
    };
    offerLabel = `Preis am ${choiceDayLabel(cur.date ?? "")}`;
  }
  return { view, offerLabel };
}
