/**
 * Anfahrt und Abfahrt je Person (Plan 12a, Entscheidung 11, I3).
 *
 * Gespeichert werden nur Kilometer je Ort und Adresse (`einsatz_wege`, ohne
 * Personen, ohne Minuten). Verkehrsminuten kommen frisch aus Google, wenn der
 * Umzugstag noch bevorsteht (Abfahrt 07:00 Berlin), und liegen 15 Minuten im
 * Speicher je Deal und Tag; sonst werden sie aus den Kilometern geschätzt. An
 * Google geht nur „PLZ Ort, Deutschland“, nie ein Name. Fehlender Schlüssel
 * oder Google-Fehler: Kilometer aus dem Cache (auch älter) oder null, kein Fehler.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { einsatzWege } from "@/db/schema";
import {
  adresseSchluessel,
  cacheGueltig,
  minutenAusKm,
  ortSchluessel,
  type Anfahrt,
  type EinsatzPerson,
} from "@/lib/einsatz";
import { matrixVonOrten, type MatrixZelle } from "./drive-time";

export interface WegZeile {
  ortSchluessel: string;
  adresseSchluessel: string;
  km: number;
  berechnetAm: Date;
}

export interface WegeSpeicher {
  lesen(ws: string, orte: string[], adressen: string[]): Promise<WegZeile[]>;
  schreiben(ws: string, zeilen: Array<Omit<WegZeile, "berechnetAm">>): Promise<void>;
}

export const dbWegeSpeicher: WegeSpeicher = {
  async lesen(ws, orte, adressen) {
    if (orte.length === 0 || adressen.length === 0) return [];
    const rows = await db
      .select()
      .from(einsatzWege)
      .where(
        and(
          eq(einsatzWege.workspaceId, ws),
          inArray(einsatzWege.ortSchluessel, orte),
          inArray(einsatzWege.adresseSchluessel, adressen),
        ),
      );
    return rows.map((r) => ({
      ortSchluessel: r.ortSchluessel,
      adresseSchluessel: r.adresseSchluessel,
      km: Number(r.km),
      berechnetAm: r.berechnetAm,
    }));
  },
  async schreiben(ws, zeilen) {
    if (zeilen.length === 0) return;
    await db
      .insert(einsatzWege)
      .values(zeilen.map((z) => ({ workspaceId: ws, ortSchluessel: z.ortSchluessel, adresseSchluessel: z.adresseSchluessel, km: z.km.toFixed(1) })))
      .onConflictDoUpdate({
        target: [einsatzWege.workspaceId, einsatzWege.ortSchluessel, einsatzWege.adresseSchluessel],
        set: { km: sql`excluded.km`, berechnetAm: sql`now()` },
      });
  },
};

/** Verkehrsminuten je Ort (Anfahrt zur Beladeadresse), 15 Minuten im Speicher. */
const MINUTEN_GUELTIG_MS = 15 * 60 * 1000;
const minutenSpeicher = new Map<string, { am: number; minuten: Map<string, number> }>();

export function __leereMinutenSpeicher(): void {
  minutenSpeicher.clear();
}

/** Unix-Sekunden für `tag` um `hh:mm` in Europe/Berlin (Sommer- und Winterzeit). */
export function berlinZeitpunkt(tag: string, uhr = "07:00"): number {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  const [h, min] = uhr.split(":").map(Number) as [number, number];
  const alsUtc = Date.UTC(j, m - 1, d, h, min);
  // Versatz Berlins zu UTC an diesem Zeitpunkt.
  const teile = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(alsUtc));
  const wert = (t: string) => Number(teile.find((p) => p.type === t)?.value);
  const berlinAlsUtc = Date.UTC(wert("year"), wert("month") - 1, wert("day"), wert("hour"), wert("minute"));
  return Math.round((alsUtc - (berlinAlsUtc - alsUtc)) / 1000);
}

export interface AnfahrtOptionen {
  /** Speicher je Deal und Tag; ohne Deal kein Minuten-Speicher. */
  dealId?: string | null;
  /** „Fahrzeiten aktualisieren“: Minuten-Speicher überspringen. */
  frisch?: boolean;
  jetzt?: Date;
  speicher?: WegeSpeicher;
  matrix?: typeof matrixVonOrten;
}

export async function anfahrtenLaden(
  ws: string,
  e: { personen: EinsatzPerson[]; beladen: string; entladen: string | null; tag: string | null },
  o: AnfahrtOptionen = {},
): Promise<Anfahrt[]> {
  const jetzt = o.jetzt ?? new Date();
  const speicher = o.speicher ?? dbWegeSpeicher;
  const matrix = o.matrix ?? matrixVonOrten;

  const orte = new Map<string, string>();
  for (const p of e.personen) {
    const k = ortSchluessel(p.plz, p.wohnort);
    if (k && !orte.has(k)) orte.set(k, `${p.plz!.trim()} ${p.wohnort!.trim()}, Deutschland`);
  }
  const beladenKey = adresseSchluessel(e.beladen);
  const entladenKey = e.entladen && e.entladen.trim() !== "" ? adresseSchluessel(e.entladen) : null;
  const zielKeys = entladenKey && entladenKey !== beladenKey ? [beladenKey, entladenKey] : [beladenKey];
  const zielTexte = zielKeys.length === 2 ? [e.beladen, e.entladen!] : [e.beladen];
  const ortKeys = [...orte.keys()];

  const km = new Map<string, { km: number; gueltig: boolean }>();
  const kmKey = (ort: string, adr: string) => `${ort}\u0000${adr}`;
  if (ortKeys.length > 0 && beladenKey !== "") {
    try {
      for (const z of await speicher.lesen(ws, ortKeys, zielKeys)) {
        km.set(kmKey(z.ortSchluessel, z.adresseSchluessel), { km: z.km, gueltig: cacheGueltig(z.berechnetAm, jetzt) });
      }
    } catch {
      // Ohne Cache weiter wie mit leerem Cache.
    }
  }

  const abfahrt = e.tag ? berlinZeitpunkt(e.tag) : null;
  const zukunft = abfahrt !== null && abfahrt * 1000 > jetzt.getTime();
  const speicherKey = o.dealId && e.tag ? `${ws}|${o.dealId}|${e.tag}|${beladenKey}` : null;
  const imSpeicher = speicherKey && !o.frisch ? minutenSpeicher.get(speicherKey) : undefined;
  let minuten: Map<string, number> | null =
    imSpeicher && jetzt.getTime() - imSpeicher.am < MINUTEN_GUELTIG_MS ? imSpeicher.minuten : null;

  const fehlend = ortKeys.filter((ort) => zielKeys.some((adr) => !km.get(kmKey(ort, adr))?.gueltig));
  const brauchtMinuten = zukunft && minuten === null;
  const abfragen = beladenKey === "" ? [] : brauchtMinuten ? ortKeys : fehlend;

  if (abfragen.length > 0) {
    try {
      const zellen: MatrixZelle[][] = await matrix(
        abfragen.map((k) => orte.get(k)!),
        zielTexte,
        zukunft ? abfahrt : null,
      );
      const neu: Array<Omit<WegZeile, "berechnetAm">> = [];
      const frischeMinuten = new Map<string, number>();
      abfragen.forEach((ort, i) => {
        zielKeys.forEach((adr, j) => {
          const z = zellen[i]?.[j];
          if (!z) return;
          const wert = Math.round(z.meter / 100) / 10;
          km.set(kmKey(ort, adr), { km: wert, gueltig: true });
          neu.push({ ortSchluessel: ort, adresseSchluessel: adr, km: wert });
          if (j === 0 && zukunft) frischeMinuten.set(ort, Math.max(1, Math.round(z.sekunden / 60)));
        });
      });
      await speicher.schreiben(ws, neu).catch(() => undefined);
      if (zukunft) {
        minuten = frischeMinuten;
        if (speicherKey) minutenSpeicher.set(speicherKey, { am: jetzt.getTime(), minuten: frischeMinuten });
      }
    } catch {
      // Kein Schlüssel oder Google-Fehler: Kilometer aus dem Cache, Minuten geschätzt.
    }
  }

  return e.personen.map((p): Anfahrt => {
    const ort = ortSchluessel(p.plz, p.wohnort);
    if (!ort || beladenKey === "") return { employeeId: p.id, anKm: null, abKm: null, anMin: null, abMin: null, anMinQuelle: null };
    const anKm = km.get(kmKey(ort, beladenKey))?.km ?? null;
    const abKm = zielKeys.length === 2 ? km.get(kmKey(ort, zielKeys[1]!))?.km ?? null : anKm;
    const verkehr = zukunft ? minuten?.get(ort) : undefined;
    const anMin = verkehr ?? (anKm === null ? null : minutenAusKm(anKm));
    return {
      employeeId: p.id,
      anKm,
      abKm,
      anMin,
      abMin: abKm === null ? null : minutenAusKm(abKm),
      anMinQuelle: anMin === null ? null : verkehr !== undefined ? "verkehr" : "geschaetzt",
    };
  });
}
