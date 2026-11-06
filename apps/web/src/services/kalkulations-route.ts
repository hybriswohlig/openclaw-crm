/**
 * Route je Kalkulationsversion über die Google Routes API (Plan 4, Entscheidung 8):
 * Station → Beladen → (Entladen →) Station, gespeichert in `deal_calculation_routes`
 * mit `punkte_schluessel`.
 *
 * - Entwurf: weicht der Schlüssel der Version vom gespeicherten ab, neu holen und ersetzen.
 * - Gesperrte Version: Punkte nie ändern; die gespeicherte Route bleibt, nach 30 Tagen
 *   wird sie mit denselben Punkten (aus dem gespeicherten Link) neu geholt.
 * - Ohne Station oder bei ungenauer Adresse: `ungenau`, kein Abruf (Review Focus 1).
 * - Fehler speichern nichts; 403 / PERMISSION_DENIED / REQUEST_DENIED → `nicht_freigegeben`.
 * - `darfAbrufen: false` (Nur-Lesen-Schlüssel): nur gespeicherter Stand, kein Abruf.
 *
 * Der Speicher ist austauschbar (Tests ohne Datenbank).
 */
import type { RoutenTeilstrecke } from "@/db/schema/deal-calculation-routes";
import { adresseGenau } from "@/lib/adresse-genau";
import { googleMapsLink, punkteSchluessel, type RoutenPunkte, type RoutenStatus } from "@/lib/route-link";
import type { VersionsZeile } from "@/services/kalkulation-versionen";

export const ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const ROUTES_FIELD_MASK = "routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline";
export const ROUTE_GUELTIG_MS = 30 * 24 * 60 * 60 * 1000;

export interface GespeicherteRoute {
  calculationVersionId: string;
  workspaceId: string;
  punkteSchluessel: string;
  teilstrecken: RoutenTeilstrecke[];
  googleLink: string;
  berechnetAm: Date;
}

export interface RoutenSpeicher {
  lesen(ws: string, versionId: string): Promise<GespeicherteRoute | null>;
  /** Upsert je Version (ersetzt die alte Route). */
  schreiben(r: GespeicherteRoute): Promise<void>;
}

export interface RouteErgebnis {
  status: RoutenStatus;
  teilstrecken: RoutenTeilstrecke[];
  googleLink: string | null;
  stationen: number;
  gesamtKm: number | null;
  gesamtMinuten: number | null;
}

export interface RouteOptionen {
  darfAbrufen: boolean;
  speicher?: RoutenSpeicher;
  jetzt?: () => Date;
}

type RoutenVersion = Pick<VersionsZeile, "id" | "status" | "rechnerRequest" | "rechnerResult">;

/** Punkte aus der Version; null ohne Station oder bei ungenauer Adresse. */
export function punkteAusVersion(v: Pick<VersionsZeile, "rechnerRequest" | "rechnerResult">): RoutenPunkte | null {
  const station = v.rechnerResult?.mietstation?.adresse;
  const anfrage = v.rechnerRequest ?? {};
  const beladen = adresseGenau(anfrage.von_adresse);
  const entladenRoh = anfrage.nach_adresse;
  const entladen = adresseGenau(entladenRoh);
  if (typeof station !== "string" || station.trim() === "") return null;
  if (!beladen.genau || !beladen.text) return null;
  // Eine angegebene, aber ungenaue Entladeadresse ist ungenau (nicht still weglassen).
  if (entladen.text && !entladen.genau) return null;
  return { station: station.trim(), beladen: beladen.text, entladen: entladen.text };
}

/** Anzahl verglichener Stationen ("günstigste von N Stationen"). */
function stationenAus(v: Pick<VersionsZeile, "rechnerResult">): number {
  const vergleich = v.rechnerResult?.stationsVergleich;
  if (Array.isArray(vergleich) && vergleich.length > 0) return vergleich.length;
  return v.rechnerResult?.mietstation ? 1 : 0;
}

function summen(t: RoutenTeilstrecke[]): { gesamtKm: number | null; gesamtMinuten: number | null } {
  if (t.length === 0) return { gesamtKm: null, gesamtMinuten: null };
  return {
    gesamtKm: Math.round(t.reduce((s, x) => s + x.km, 0) * 10) / 10,
    gesamtMinuten: t.reduce((s, x) => s + x.minuten, 0),
  };
}

function teilstreckenNamen(p: RoutenPunkte): { von: string; nach: string; haupt: boolean }[] {
  return p.entladen
    ? [
        { von: "Station", nach: "Beladen", haupt: false },
        { von: "Beladen", nach: "Entladen", haupt: true },
        { von: "Entladen", nach: "Station", haupt: false },
      ]
    : [
        { von: "Station", nach: "Beladen", haupt: false },
        { von: "Beladen", nach: "Station", haupt: false },
      ];
}

class RoutenFehler extends Error {
  constructor(readonly status: "fehler" | "nicht_freigegeben", message: string) {
    super(message);
  }
}

/** Sekunden aus "1234s" (Duration der Routes API). */
function sekunden(d: unknown): number {
  if (typeof d === "number") return d;
  if (typeof d === "string") {
    const n = Number.parseFloat(d.replace(/s$/, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function holeRoute(p: RoutenPunkte, apiKey: string): Promise<RoutenTeilstrecke[]> {
  const body = {
    origin: { address: p.station },
    destination: { address: p.station },
    intermediates: [{ address: p.beladen }, ...(p.entladen ? [{ address: p.entladen }] : [])],
    travelMode: "DRIVE",
  };
  let res: Response;
  try {
    res = await fetch(ROUTES_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": ROUTES_FIELD_MASK },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new RoutenFehler("fehler", `Routes API nicht erreichbar: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => null)) as {
    error?: { status?: string; message?: string };
    routes?: { legs?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[] }[];
  } | null;
  const googleStatus = json?.error?.status;
  if (res.status === 403 || googleStatus === "PERMISSION_DENIED" || googleStatus === "REQUEST_DENIED") {
    throw new RoutenFehler("nicht_freigegeben", json?.error?.message ?? `HTTP ${res.status}`);
  }
  if (!res.ok) throw new RoutenFehler("fehler", json?.error?.message ?? `HTTP ${res.status}`);
  const legs = json?.routes?.[0]?.legs ?? [];
  const namen = teilstreckenNamen(p);
  if (legs.length !== namen.length) throw new RoutenFehler("fehler", `Routes API: ${legs.length} statt ${namen.length} Teilstrecken`);
  return legs.map((leg, i) => ({
    ...namen[i],
    km: Math.round((leg.distanceMeters ?? 0) / 100) / 10,
    minuten: Math.round(sekunden(leg.duration) / 60),
    polyline: leg.polyline?.encodedPolyline ?? "",
  }));
}

export function routesSchluessel(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || null;
}

export async function routeFuer(ws: string, version: RoutenVersion, opts: RouteOptionen): Promise<RouteErgebnis> {
  const speicher = opts.speicher ?? (await standardSpeicher());
  const jetzt = (opts.jetzt ?? (() => new Date()))();
  const stationen = stationenAus(version);
  const gespeichert = await speicher.lesen(ws, version.id);
  const ausGespeichert = (r: GespeicherteRoute): RouteErgebnis => ({
    status: "ok",
    teilstrecken: r.teilstrecken,
    googleLink: r.googleLink,
    stationen,
    ...summen(r.teilstrecken),
  });
  const ohneRoute = (status: RoutenStatus, googleLink: string | null): RouteErgebnis => ({
    status,
    teilstrecken: [],
    googleLink,
    stationen,
    gesamtKm: null,
    gesamtMinuten: null,
  });

  // Punkte immer aus dem Schnappschuss der Version: bei einer gesperrten Version ist
  // er eingefroren, also bleiben ihre Punkte, auch wenn sich der Lead später ändert;
  // eine vor dem Sperren gespeicherte Route anderer Punkte passt nicht und wird ersetzt.
  const punkte = punkteAusVersion(version);
  if (!punkte) return ohneRoute("ungenau", null);
  const schluessel = punkteSchluessel(punkte);
  const link = googleMapsLink(punkte);

  const passend = gespeichert && gespeichert.punkteSchluessel === schluessel ? gespeichert : null;
  if (passend && jetzt.getTime() - passend.berechnetAm.getTime() < ROUTE_GUELTIG_MS) return ausGespeichert(passend);
  // Abgelaufen (älter als 30 Tage) wird nie mehr gezeigt, auch nicht für Nur-Lesen oder ohne Schlüssel.
  if (!opts.darfAbrufen) return ohneRoute("nicht_geladen", link);
  const apiKey = routesSchluessel();
  if (!apiKey) return ohneRoute("ohne_schluessel", link);

  let teilstrecken: RoutenTeilstrecke[];
  try {
    teilstrecken = await holeRoute(punkte, apiKey);
  } catch (e) {
    const status = e instanceof RoutenFehler ? e.status : "fehler";
    console.error("[kalkulations-route]", version.id, (e as Error).message);
    return ohneRoute(status, link);
  }
  const neu: GespeicherteRoute = {
    calculationVersionId: version.id,
    workspaceId: ws,
    punkteSchluessel: schluessel,
    teilstrecken,
    googleLink: link,
    berechnetAm: jetzt,
  };
  await speicher.schreiben(neu);
  return ausGespeichert(neu);
}

async function standardSpeicher(): Promise<RoutenSpeicher> {
  return (await import("@/services/kalkulations-route-speicher")).dbRoutenSpeicher();
}
