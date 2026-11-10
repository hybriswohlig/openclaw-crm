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
import { einsatzOrte, einsatzWege } from "@/db/schema";
import {
  adresseSchluessel,
  cacheGueltig,
  minutenAusKm,
  ortSchluessel,
  type Anfahrt,
  type EinsatzPerson,
  type Punkt,
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

// ─── Kartenpunkte je Ort (12c) ───────────────────────────────────────────────

/** Ein Ort, der einen Kartenpunkt braucht. An Google geht nur `text`, nie ein Name. */
export interface OrtAnfrage {
  schluessel: string;
  text: string;
  plz: string | null;
}

export interface OrtZeile {
  ortSchluessel: string;
  lat: number;
  lng: number;
  berechnetAm: Date;
}

export interface OrteSpeicher {
  lesen(ws: string, schluessel: string[]): Promise<OrtZeile[]>;
  schreiben(ws: string, zeilen: Array<Omit<OrtZeile, "berechnetAm">>): Promise<void>;
}

export const dbOrteSpeicher: OrteSpeicher = {
  async lesen(ws, schluessel) {
    if (schluessel.length === 0) return [];
    const rows = await db
      .select()
      .from(einsatzOrte)
      .where(and(eq(einsatzOrte.workspaceId, ws), inArray(einsatzOrte.ortSchluessel, schluessel)));
    return rows.map((r) => ({
      ortSchluessel: r.ortSchluessel,
      lat: r.lat,
      lng: r.lng,
      berechnetAm: r.berechnetAm,
    }));
  },
  async schreiben(ws, zeilen) {
    if (zeilen.length === 0) return;
    await db
      .insert(einsatzOrte)
      .values(zeilen.map((z) => ({ workspaceId: ws, ortSchluessel: z.ortSchluessel, lat: z.lat, lng: z.lng })))
      .onConflictDoUpdate({
        target: [einsatzOrte.workspaceId, einsatzOrte.ortSchluessel],
        set: { lat: sql`excluded.lat`, lng: sql`excluded.lng`, berechnetAm: sql`now()` },
      });
  },
};

/** Höchstens so viele Geocoding-Aufrufe je `ortPunkte`. Der Rest wartet auf den nächsten Aufruf. */
export const ORTE_JE_AUFRUF = 25;

export const GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";

/** Ein nicht gefundener Ort (`ZERO_RESULTS`) wird nach so vielen Tagen erneut gefragt. */
export const FEHLVERSUCH_GUELTIG_TAGE = 7;
const FEHLVERSUCH_GUELTIG_MS = FEHLVERSUCH_GUELTIG_TAGE * 24 * 60 * 60 * 1000;

type GeoAntwort = {
  status?: string;
  results?: Array<{ geometry?: { location?: { lat?: unknown; lng?: unknown } } }>;
};

/**
 * Mittelpunkte je Ortsschlüssel. Gültiger Cache ohne Google; fehlende oder
 * abgelaufene höchstens `ORTE_JE_AUFRUF` mal neu. Ohne Schlüssel, bei
 * `REQUEST_DENIED`, `OVER_QUERY_LIMIT`, HTTP- oder Netzfehler: sofort aufhören,
 * abgelaufene Punkte behalten, nichts werfen. `ZERO_RESULTS`: dieser Ort ohne
 * Punkt, danach weiter. Punkt ist [Längengrad, Breitengrad].
 */
export async function ortPunkte(
  ws: string,
  orte: OrtAnfrage[],
  o: {
    jetzt?: Date;
    speicher?: OrteSpeicher;
    abruf?: (url: string) => Promise<Response>;
    schluessel?: string | null;
  } = {},
): Promise<{ punkte: Map<string, Punkt>; ohne: string[] }> {
  const jetzt = o.jetzt ?? new Date();
  const speicher = o.speicher ?? dbOrteSpeicher;
  // Ein hängender Google-Aufruf darf die Karte nicht aufhalten: 8 s je Ort, dann wie Netzfehler.
  const abruf = o.abruf ?? ((url: string) => fetch(url, { signal: AbortSignal.timeout(8_000) }));
  const schluessel = o.schluessel === undefined ? process.env.GOOGLE_MAPS_API_KEY || null : o.schluessel;

  const einzig: OrtAnfrage[] = [];
  const gesehen = new Set<string>();
  for (const ort of orte) {
    if (gesehen.has(ort.schluessel)) continue;
    gesehen.add(ort.schluessel);
    einzig.push(ort);
  }

  const cache = new Map<string, OrtZeile>();
  if (einzig.length > 0) {
    try {
      for (const z of await speicher.lesen(ws, einzig.map((e) => e.schluessel))) cache.set(z.ortSchluessel, z);
    } catch {
      // Ohne Cache weiter wie mit leerem Cache.
    }
  }

  const punkte = new Map<string, Punkt>();
  const neu: Array<Omit<OrtZeile, "berechnetAm">> = [];
  let aufrufe = 0;
  let abbruch = false;

  const treffer = (z: OrtZeile | undefined) => !!z && Number.isFinite(z.lat) && Number.isFinite(z.lng);
  const altBehalten = (ort: OrtAnfrage) => {
    const alt = cache.get(ort.schluessel);
    if (alt && treffer(alt)) punkte.set(ort.schluessel, [alt.lng, alt.lat]);
  };

  // Review M1: gültiger Treffer (30 Tage) oder frischer Fehlversuch (7 Tage) kommen ohne Google aus.
  // Zu fragen sind zuerst nie gefragte Orte, dann abgelaufene Treffer, zuletzt abgelaufene Fehlversuche:
  // nicht auffindbare Orte blockieren die übrigen nie dauerhaft.
  const fragen: OrtAnfrage[][] = [[], [], []];
  for (const ort of einzig) {
    const alt = cache.get(ort.schluessel);
    if (!alt) {
      fragen[0]!.push(ort);
      continue;
    }
    if (treffer(alt)) {
      if (cacheGueltig(alt.berechnetAm, jetzt)) punkte.set(ort.schluessel, [alt.lng, alt.lat]);
      else fragen[1]!.push(ort);
      continue;
    }
    if (jetzt.getTime() - alt.berechnetAm.getTime() >= FEHLVERSUCH_GUELTIG_MS) fragen[2]!.push(ort);
  }

  for (const ort of fragen.flat()) {
    if (!schluessel || abbruch || aufrufe >= ORTE_JE_AUFRUF) {
      altBehalten(ort);
      continue;
    }
    aufrufe += 1;
    const url =
      `${GEOCODING_URL}?address=${encodeURIComponent(`${ort.text}, Deutschland`)}` +
      `&components=${encodeURIComponent(ort.plz ? `country:DE|postal_code:${ort.plz}` : "country:DE")}` +
      `&language=de&key=${schluessel}`;
    let daten: GeoAntwort | null = null;
    try {
      const res = await abruf(url);
      if (!res.ok) {
        abbruch = true;
        altBehalten(ort);
        continue;
      }
      daten = (await res.json()) as GeoAntwort;
    } catch {
      abbruch = true;
      altBehalten(ort);
      continue;
    }
    const status = daten?.status;
    if (status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT") {
      abbruch = true;
      altBehalten(ort);
      continue;
    }
    const loc = status === "OK" ? daten?.results?.[0]?.geometry?.location : undefined;
    if (typeof loc?.lat === "number" && typeof loc.lng === "number" && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
      punkte.set(ort.schluessel, [loc.lng, loc.lat]);
      neu.push({ ortSchluessel: ort.schluessel, lat: loc.lat, lng: loc.lng });
    } else if (status === "ZERO_RESULTS" || status === "OK" || status === "INVALID_REQUEST") {
      // Google kennt den Ort nicht: als Fehlversuch merken (NaN statt Koordinate, keine Migration nötig).
      neu.push({ ortSchluessel: ort.schluessel, lat: Number.NaN, lng: Number.NaN });
    } else {
      // UNKNOWN_ERROR und Unbekanntes: vorübergehend, nichts merken, alten Punkt behalten.
      altBehalten(ort);
    }
  }

  if (neu.length > 0) await speicher.schreiben(ws, neu).catch(() => undefined);
  return { punkte, ohne: einzig.filter((ort) => !punkte.has(ort.schluessel)).map((ort) => ort.schluessel) };
}
