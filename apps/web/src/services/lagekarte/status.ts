import type { KartenStatus } from "@/lib/lagekarte/typen";

export type StufenKategorie =
  | "open_new"
  | "open_engaged"
  | "quoted"
  | "booked"
  | "done_unpaid"
  | "paid"
  | "lost";

const GUELTIGE_KATEGORIEN: ReadonlySet<string> = new Set<StufenKategorie>([
  "open_new",
  "open_engaged",
  "quoted",
  "booked",
  "done_unpaid",
  "paid",
  "lost",
]);

/** Titel (klein, ohne Klammerzusatz am Ende) → Kategorie. */
const TITEL_MAPPING: Record<string, StufenKategorie> = {
  "neue anfrage": "open_new",
  inquiry: "open_new",
  "in kontakt": "open_engaged",
  contacted: "open_engaged",
  "information gathered": "open_engaged",
  quoted: "quoted",
  angebot: "quoted",
  geplant: "booked",
  planned: "booked",
  durchgeführt: "done_unpaid",
  done: "done_unpaid",
  bezahlt: "paid",
  paid: "paid",
  verloren: "lost",
  lost: "lost",
};

export function stufenKategorie(
  stufe: { titel: string; kategorie: string | null } | null,
): StufenKategorie | null {
  if (!stufe) return null;
  if (stufe.kategorie && GUELTIGE_KATEGORIEN.has(stufe.kategorie)) {
    return stufe.kategorie as StufenKategorie;
  }
  const titel = stufe.titel
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*$/, "");
  return TITEL_MAPPING[titel] ?? null;
}

/**
 * Abgeleiteter Kartenstatus. Rangfolge (erste Regel gewinnt):
 * Endstufen (verloren, erledigt) vor Annahme vor Angebot vor Kontakt vor Neu.
 * Eine aktive KV-Annahme macht aus einem erledigten Job nie einen Auftrag.
 */
export function kartenStatus(e: {
  stufe: { titel: string; kategorie: string | null } | null;
  kvaAktiv: boolean;
  angebotErstellt: boolean;
}): { status: KartenStatus; hinweis: string | null; zahlungOffen: boolean } {
  const kategorie = stufenKategorie(e.stufe);
  const ergebnis = (status: KartenStatus, hinweis: string | null = null, zahlungOffen = false) => ({
    status,
    hinweis,
    zahlungOffen,
  });

  if (kategorie === "lost") {
    return ergebnis("verloren", e.kvaAktiv ? "KV-Annahme aktiv, Stufe „Verloren“" : null);
  }
  if (kategorie === "done_unpaid") return ergebnis("erledigt", null, true);
  if (kategorie === "paid") return ergebnis("erledigt");

  if (kategorie === "booked") return ergebnis("auftrag");
  if (e.kvaAktiv && (kategorie === "open_new" || kategorie === "open_engaged" || kategorie === "quoted")) {
    return ergebnis("auftrag", `KV angenommen, Stufe noch „${e.stufe?.titel ?? ""}“`);
  }
  if (e.kvaAktiv && e.stufe === null) {
    return ergebnis("auftrag", "KV angenommen, keine Stufe gesetzt");
  }

  if (kategorie === "quoted" || e.angebotErstellt) return ergebnis("angebot");
  if (kategorie === "open_engaged") return ergebnis("kontakt");
  if (kategorie === "open_new") return ergebnis("neu");
  if (e.stufe === null) return ergebnis("neu", "Import ohne Stufe");

  return ergebnis("unbekannt", `Stufe „${e.stufe.titel}“ nicht zugeordnet`);
}
