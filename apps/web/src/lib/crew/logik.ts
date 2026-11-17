/**
 * Crew-Portal: reine Regeln ohne Datenbank (Vertrag `docs/API-CONTRACT.md`,
 * Typen `./contract.ts`). Lohnschätzung, Firma, Aufgaben-Chips, Sichtbarkeit,
 * Antwort-Zustandsmaschine, Telefon in E.164. Getestet in `logik.test.ts`.
 */
import { kuerzelAus } from "@/lib/akte";
import { leistungsartVorschlag } from "@/lib/kv-vorpruefung";
import type { CrewJob, CrewMyStatus, CrewTask } from "./contract";

// ─── Lohnschätzung ───────────────────────────────────────────────────────────

/** Spanne um den Grundbetrag: Umzüge dauern eher länger als kürzer. */
export const LOHN_UNTEN = 0.9;
export const LOHN_OBEN = 1.25;

/** Auf 5 € (500 Cent) runden. */
export function round5(cents: number): number {
  return Math.round(cents / 500) * 500;
}

/**
 * Schätzung für eine Person. Ohne Arbeitsminuten keine Schätzung (null, das
 * Portal zeigt „Dauer noch offen“). Fahrt ohne Wert zählt als 0.
 */
export function lohnSchaetzung(input: {
  workMinutes: number | null;
  driveMinutes: number | null;
  rateWorkCents: number;
  rateDriveCents: number;
}): CrewJob["pay"] {
  const arbeit = input.workMinutes;
  if (arbeit === null || !Number.isFinite(arbeit) || arbeit <= 0) return null;
  const work = Math.round(arbeit);
  const drive = input.driveMinutes !== null && Number.isFinite(input.driveMinutes) && input.driveMinutes > 0 ? Math.round(input.driveMinutes) : 0;
  const basis = (work * input.rateWorkCents + drive * input.rateDriveCents) / 60;
  return {
    workMinutes: work,
    driveMinutes: drive,
    rateWorkCents: input.rateWorkCents,
    rateDriveCents: input.rateDriveCents,
    lowCents: round5(basis * LOHN_UNTEN),
    highCents: round5(basis * LOHN_OBEN),
  };
}

// ─── Leute ───────────────────────────────────────────────────────────────────

/** Gesuchte Leute aus Auftrag oder Kalkulation: ganze Zahl 1 bis 50, sonst null. */
export function personenZahl(x: unknown): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 50 ? r : null;
}

// ─── Firma und Art ───────────────────────────────────────────────────────────

/** Name der Betriebsfirma → Marke im Portal. Alles andere wird nicht gezeigt. */
export function firmaAus(name: string | null | undefined): CrewJob["company"] | null {
  if (!name) return null;
  if (/kottke/i.test(name)) return "kottke";
  if (/ceylan|rümpel|ruempel/i.test(name)) return "ruempeltuerken";
  return null;
}

/** Art des Jobs aus gespeicherter KV-Leistung und leadType (wie der Rechner). */
export function jobArtAus(input: { serviceType: string | null; leadType: string | null }): CrewJob["type"] {
  const art = leistungsartVorschlag({ gespeichert: input.serviceType, leadType: input.leadType });
  if (art === "kitchen_installation") return "kitchen";
  if (art === "clearance") return "clearance";
  if (art === "move" || art === "clearance_move") return "move";
  return "other";
}

// ─── Aufgaben-Chips ──────────────────────────────────────────────────────────

export interface AufgabenEingabe {
  art: CrewJob["type"];
  etageVon: number | null;
  etageNach: number | null;
  /** Optionstitel von `elevator_from`/`elevator_to` („Aufzug“, „Treppe“, „Erdgeschoss“, …). */
  zugangVon: string | null;
  zugangNach: string | null;
  volumenCbm: number | null;
  klavier: boolean;
  abbau: boolean;
  einpacken: boolean;
  entsorgung: boolean;
  einlagerung: boolean;
  halteverbot: boolean;
  laufwegVonM: number | null;
  laufwegNachM: number | null;
}

/** Ab diesem Laufweg (Meter) gibt es den Chip „Laufweg“. */
export const LAUFWEG_AB_M = 15;

function etageText(n: number): string {
  return n <= 0 ? "EG" : `${n}. OG`;
}

const ganz = (n: number | null): number | null => (n === null || !Number.isFinite(n) ? null : Math.round(n));

/** Chips „Was zu tun ist“. Schlüssel aus `CREW_TASK_KEYS`, Text immer deutsch. */
export function aufgabenAus(e: AufgabenEingabe): CrewTask[] {
  const out: CrewTask[] = [];
  const von = ganz(e.etageVon);
  const nach = ganz(e.etageNach);
  const mitZiel = e.art === "move";
  if (von !== null) out.push({ key: "floor_from", value: Math.max(0, von), label: mitZiel ? `Abholung: ${etageText(von)}` : etageText(von) });
  if (mitZiel && nach !== null) out.push({ key: "floor_to", value: Math.max(0, nach), label: `Ziel: ${etageText(nach)}` });
  const zugaenge = [e.zugangVon, ...(mitZiel ? [e.zugangNach] : [])].map((z) => z?.trim().toLowerCase() ?? "");
  if (zugaenge.some((z) => z === "aufzug")) out.push({ key: "lift", value: null, label: "Aufzug" });
  if (zugaenge.some((z) => z === "treppe")) out.push({ key: "no_lift", value: null, label: "Kein Aufzug" });
  if (e.volumenCbm !== null && Number.isFinite(e.volumenCbm) && e.volumenCbm > 0) {
    const v = Math.round(e.volumenCbm * 10) / 10;
    out.push({ key: "volume", value: v, label: `${v.toLocaleString("de-DE")} m³` });
  }
  if (e.klavier) out.push({ key: "piano", value: null, label: "Klavier" });
  if (e.art === "kitchen") {
    if (e.abbau) out.push({ key: "kitchen_dismantle", value: null, label: "Küche abbauen" });
    out.push({ key: "kitchen_assemble", value: null, label: "Küche aufbauen" });
  } else if (e.abbau) {
    out.push({ key: "dismantling", value: null, label: "Möbel abbauen" });
  }
  if (e.art === "clearance") out.push({ key: "clearance_household", value: null, label: "Entrümpelung" });
  if (e.einpacken) out.push({ key: "packing", value: null, label: "Einpacken" });
  if (e.entsorgung) out.push({ key: "disposal", value: null, label: "Entsorgung" });
  if (e.einlagerung) out.push({ key: "storage", value: null, label: "Einlagerung" });
  if (e.halteverbot) out.push({ key: "halteverbot", value: null, label: "Halteverbot" });
  const weg = Math.max(ganz(e.laufwegVonM) ?? 0, mitZiel ? (ganz(e.laufwegNachM) ?? 0) : 0);
  if (weg >= LAUFWEG_AB_M) out.push({ key: "long_walk", value: weg, label: `${weg} m Laufweg` });
  return out;
}

// ─── Sichtbarkeit (Regeln A und B) ───────────────────────────────────────────

export function tagPlus(tag: string, n: number): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
}

export interface SichtEingabe {
  geloescht: boolean;
  stufeKategorie: string | null;
  /** Termin (Berliner Tag) oder null. */
  datum: string | null;
  /** Heute in Europe/Berlin. */
  heute: string;
  workerCount: number | null;
  /** Auftrag `crew_ausschreiben`; null = kein Wert = ja. */
  ausschreiben: boolean | null;
  firma: CrewJob["company"] | null;
  /** In `deal_employees` oder mit Antwort. */
  meins: boolean;
}

/** Stufen, in denen ein Job auch für Beteiligte verschwindet (abgesagt). */
const WEG_FUER_ALLE: ReadonlySet<string> = new Set(["lost", "kein_lead"]);

/**
 * Noch nicht gebucht, aber schon zeigen (Inhaber 17.11.): Angebot raus oder im
 * Gespräch. So sehen wir früh, wer Zeit hätte. Neue Anfragen bleiben draußen.
 */
export const UNSICHERE_STUFEN: ReadonlySet<string> = new Set(["quoted", "open_engaged"]);

/** Gebucht oder schon gelaufen. */
const FESTE_STUFEN: ReadonlySet<string> = new Set(["booked", "done_unpaid", "paid"]);

/** Fest = gebucht oder später; alles andere (auch zurückgestufte eigene Jobs) gilt als „noch nicht fix“. */
export function istFix(stufeKategorie: string | null): boolean {
  return FESTE_STUFEN.has(stufeKategorie ?? "");
}

/**
 * A (offener Job): gebucht, Termin ab heute, Anzahl ≥ 1, ausgeschrieben,
 * Kottke oder Rümpeltürken. B (mein Job): eingeteilt oder geantwortet, Termin
 * ab gestern. Beides nie für gelöschte Deals; B nicht für verlorene Deals
 * (sonst stünde ein abgesagter Job als „bestätigt“ im Portal).
 */
export function sichtbarkeit(e: SichtEingabe): { a: boolean; b: boolean } {
  if (e.geloescht || e.datum === null || e.firma === null) return { a: false, b: false };
  // Fest gebucht braucht die Zahl der Leute; unsichere Jobs zeigen wir ohne (kein Platzzähler).
  const gebucht = e.stufeKategorie === "booked" && e.workerCount !== null && e.workerCount >= 1;
  const unsicher = UNSICHERE_STUFEN.has(e.stufeKategorie ?? "");
  const a = (gebucht || unsicher) && e.datum >= e.heute && e.ausschreiben !== false;
  const b = e.meins && e.datum >= tagPlus(e.heute, -1) && !WEG_FUER_ALLE.has(e.stufeKategorie ?? "");
  return { a, b };
}

// ─── Status und Antwort ──────────────────────────────────────────────────────

export type GespeicherteAntwort = "ja" | "vielleicht" | "nein" | "warteliste";
export type PortalAntwort = "ja" | "vielleicht" | "nein" | null;

/** `deal_employees` ist die Wahrheit für „bestätigt“; sonst die gespeicherte Antwort. */
export function meinStatus(input: { zugeteilt: boolean; antwort: GespeicherteAntwort | null }): CrewMyStatus {
  if (input.zugeteilt) return "bestaetigt";
  return input.antwort ?? "offen";
}

export type AntwortEntscheidung =
  | { art: "fehler"; code: "BEREITS_BESTAETIGT" }
  | { art: "loeschen" }
  | { art: "speichern"; answer: GespeicherteAntwort };

/**
 * Zustandsmaschine einer Antwort (in der Transaktion mit frisch gelesenem
 * `zugeteilt` und `voll`): Eingeteilte ändern nichts mehr (409), null nimmt
 * die Antwort zurück, „ja“ auf einen vollen Job wird „warteliste“.
 */
export function antwortEntscheiden(input: { antwort: PortalAntwort; zugeteilt: boolean; voll: boolean }): AntwortEntscheidung {
  if (input.zugeteilt) return { art: "fehler", code: "BEREITS_BESTAETIGT" };
  if (input.antwort === null) return { art: "loeschen" };
  if (input.antwort === "ja" && input.voll) return { art: "speichern", answer: "warteliste" };
  return { art: "speichern", answer: input.antwort };
}

/** Voll = bestätigte Personen ≥ `worker_count`. Ohne Anzahl nie voll. */
export function istVoll(bestaetigt: number, workerCount: number | null): boolean {
  return workerCount !== null && workerCount >= 1 && bestaetigt >= workerCount;
}

/**
 * Konflikt am Tag: ein anderer Job, der sich mit diesem Tag überschneidet und
 * bei dem ich „ja“ gesagt habe oder eingeteilt bin.
 */
export function konflikteAmTag(jobs: ReadonlyArray<Pick<CrewJob, "id" | "date" | "dateEnd" | "my">>): Map<string, boolean> {
  const zaehlt = jobs.filter((j) => j.my.status === "ja" || j.my.status === "bestaetigt");
  const out = new Map<string, boolean>();
  for (const j of jobs) {
    const bis = j.dateEnd ?? j.date;
    out.set(
      j.id,
      zaehlt.some((k) => k.id !== j.id && k.date <= bis && (k.dateEnd ?? k.date) >= j.date),
    );
  }
  return out;
}

// ─── Person ──────────────────────────────────────────────────────────────────

/** Ruhige, gut lesbare Avatar-Farben (hex ohne #), stabil je ID. */
const FARBEN = ["c2410c", "0f766e", "1d4ed8", "7c3aed", "be123c", "15803d", "a16207", "0e7490", "9333ea", "b45309"] as const;

export function farbeAus(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FARBEN[h % FARBEN.length]!;
}

export function vornameAus(name: string): string {
  return name.trim().split(/\s+/)[0] || "Team";
}

export function initialenAus(name: string): string {
  return kuerzelAus(name).slice(0, 3) || "?";
}

export { istCrewLocale, telefonE164 } from "./telefon";
