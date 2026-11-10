/**
 * Pflichtangaben der VPS-Vorlage (`rechnungen-und-auftragsbestaetigungen`) und
 * verständliche Fehlertexte, wenn ein Dokumentjob scheitert. Rein, ohne Datenbank.
 *
 * Die Vorlage bricht ab („skill exited with code 2. stderr tail: Kundenanschrift
 * fehlt.“), wenn `kunde.adresse` oder der Nachname fehlen. `kunde.adresse` ist die
 * Auszugsadresse des Leads (`buildDealDataForDocs`). `/api/tools/run` startet deshalb
 * keinen Job ohne diese Angaben, und die Oberfläche fragt sie vorher ab.
 */
export type DokArt = "KV" | "AB" | "RE";
export type VpsPflicht = "kundenname" | "auszug";

const DOK_KURZ: Record<DokArt, string> = { KV: "KV", AB: "AB", RE: "Rechnung" };

const PFLICHT_TEXT: Record<VpsPflicht, string> = {
  kundenname: "Kundenname fehlt",
  auszug: "Kundenanschrift fehlt",
};

function gefuellt(x: unknown): boolean {
  return typeof x === "string" && x.trim() !== "" && x.trim() !== "—";
}

/** Was im Auftrag an die Vorlage fehlt, nach dem Umschreiben des Namens durch den Server. */
export function fehlendeVpsAngaben(params: Record<string, unknown>): VpsPflicht[] {
  const kunde = (params.kunde && typeof params.kunde === "object" ? params.kunde : {}) as Record<string, unknown>;
  const fehlt: VpsPflicht[] = [];
  if (!gefuellt(kunde.nachname)) fehlt.push("kundenname");
  if (!gefuellt(kunde.adresse)) fehlt.push("auszug");
  return fehlt;
}

export function dokArtAus(x: unknown): DokArt {
  const s = String(x ?? "").toUpperCase();
  return s === "AB" || s === "RE" ? s : "KV";
}

/** „KV nicht erstellt: Kundenanschrift fehlt. Angaben ergänzen.“ */
export function angabenFehlenText(art: DokArt, fehlt: VpsPflicht[]): string {
  const gruende = fehlt.map((f) => PFLICHT_TEXT[f]).join(", ");
  return `${DOK_KURZ[art]} nicht erstellt: ${gruende}. Angaben ergänzen.`;
}

export interface JobFehler {
  /** „KV nicht erstellt: Kundenanschrift fehlt.“ */
  text: string;
  /** true: der Grund sind fehlende Angaben am Lead, der Link „Angaben ergänzen“ hilft. */
  angabenFehlen: boolean;
}

/** Bekannte Abbrüche der Vorlage, in der Sprache der Disponenten. */
const BEKANNT: Array<[RegExp, string]> = [
  [/kundenanschrift fehlt/i, "Kundenanschrift fehlt"],
  [/umzug\.von\.adresse fehlt|von[_ .-]?adresse fehlt|strecke_von fehlt/i, "Auszugsadresse fehlt"],
  [/umzug\.nach\.adresse fehlt|nach[_ .-]?adresse fehlt|strecke_nach fehlt/i, "Einzugsadresse fehlt"],
  [/(kunde\.)?nachname fehlt|kundenname fehlt/i, "Kundenname fehlt"],
  [/(umzugs)?datum fehlt/i, "Umzugsdatum fehlt"],
];

/** Letzte sinnvolle Zeile aus dem stderr-Ende des Skills. */
function letzteZeile(tail: string): string {
  const zeilen = tail
    .split(/\r?\n/)
    .map((z) => z.trim())
    .filter((z) => z && !/^traceback|^file "|^\s*\^|^during handling/i.test(z));
  const z = zeilen[zeilen.length - 1] ?? tail.trim();
  // „ValueError: Kundenanschrift fehlt.“ → „Kundenanschrift fehlt“
  return z.replace(/^[A-Za-z]*(Error|Exception):\s*/, "").replace(/[.\s]+$/, "").slice(0, 160);
}

/**
 * Fehlertext eines gescheiterten Dokumentjobs. Aus „skill exited with code 2.
 * stderr tail: Kundenanschrift fehlt.“ wird „KV nicht erstellt: Kundenanschrift fehlt.“
 * mit `angabenFehlen`. Unbekanntes bleibt lesbar erhalten, mit Präfix.
 */
export function jobFehlerText(roh: string | null | undefined, art: DokArt): JobFehler {
  const kopf = `${DOK_KURZ[art]} nicht erstellt`;
  const t = (roh ?? "").trim();
  if (!t) return { text: `${kopf}.`, angabenFehlen: false };
  if (/^\w+ nicht erstellt:/.test(t)) return { text: t, angabenFehlen: /fehlt/i.test(t) };
  for (const [muster, grund] of BEKANNT) {
    if (muster.test(t)) return { text: `${kopf}: ${grund}.`, angabenFehlen: true };
  }
  if (/^abgelaufen$/i.test(t)) return { text: `${kopf}: Der Job hat zu lange gedauert. Bitte neu erstellen.`, angabenFehlen: false };
  const skill = /skill exited with code \d+\.?\s*(?:stderr tail:\s*)?([\s\S]*)$/i.exec(t);
  if (skill) {
    const grund = letzteZeile(skill[1] ?? "");
    if (/\bfehlt\b/i.test(grund)) return { text: `${kopf}: ${grund}.`, angabenFehlen: true };
    return { text: grund ? `${kopf}: ${grund}.` : `${kopf}: Die Vorlage ist abgebrochen.`, angabenFehlen: false };
  }
  return { text: `${kopf}: ${t.replace(/[.\s]+$/, "")}.`, angabenFehlen: false };
}

/** Ziel des Links „Angaben ergänzen“: die Akte mit offenem Bereich „Kunde und Adressen“. */
export function angabenLink(dealId: string): string {
  return `/app/leads/${encodeURIComponent(dealId)}?angaben=1`;
}
