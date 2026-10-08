/**
 * Analyse-Dienste bekommen Seitenadressen nur ohne Abfrage und Anker.
 *
 * CRM-Adressen tragen Datensatz-IDs und Suchtexte in der Abfrage
 * (/home?lead=<uuid>&firma=<uuid>, /search?q=…). Amplitude, Plausible und GA4
 * würden sonst die volle Adresse übertragen. Gekürzt werden nur Adressen
 * dieses Ursprungs (origin), fremde Adressen (z. B. ein externer Referrer)
 * bleiben wie sie sind.
 */
import type { Types } from "@amplitude/analytics-browser";

/** Bei einer Adresse dieses Ursprungs alles ab „?“ oder „#“ abschneiden; sonst unverändert. */
export function ohneAbfrage(wert: string, origin: string): string {
  if (!origin) return wert;
  const eigene =
    wert === origin ||
    wert.startsWith(`${origin}/`) ||
    wert.startsWith(`${origin}?`) ||
    wert.startsWith(`${origin}#`);
  if (!eigene) return wert;
  const schnitt = wert.search(/[?#]/);
  return schnitt === -1 ? wert : wert.slice(0, schnitt);
}

const MAX_TIEFE = 3;

/**
 * Kopie eines Eigenschaften-Objekts, in der jede Zeichenkette mit einer
 * Adresse dieses Ursprungs gekürzt ist (auch verschachtelt, z. B. $set und
 * $setOnce bei Amplitude-Nutzereigenschaften).
 */
export function eigenschaftenOhneAbfrage<T>(wert: T, origin: string, tiefe = 0): T {
  if (typeof wert === "string") return ohneAbfrage(wert, origin) as T;
  if (tiefe >= MAX_TIEFE || wert === null || typeof wert !== "object") return wert;
  if (Array.isArray(wert)) return wert.map((w) => eigenschaftenOhneAbfrage(w, origin, tiefe + 1)) as T;
  const kopie: Record<string, unknown> = {};
  for (const [schluessel, w] of Object.entries(wert as Record<string, unknown>)) {
    kopie[schluessel] = eigenschaftenOhneAbfrage(w, origin, tiefe + 1);
  }
  return kopie as T;
}

export const AMPLITUDE_PLUGIN_NAME = "kottke-adressen-ohne-abfrage";

/**
 * Amplitude-Anreicherung: kürzt in event_properties und user_properties jede
 * Adresse dieses Ursprungs ([Amplitude] Page Location, Page URL, Previous Page
 * Location, Form Destination, Link URL, referrer usw.).
 *
 * Muss nach den eingebauten Anreicherungen laufen (page-url-enrichment setzt
 * sonst danach wieder die volle Adresse); siehe amplitude-script.tsx.
 */
export function amplitudeOhneAbfrage(holeOrigin: () => string = () => window.location.origin): Types.EnrichmentPlugin {
  return {
    name: AMPLITUDE_PLUGIN_NAME,
    type: "enrichment",
    async execute(event) {
      const origin = holeOrigin();
      if (event.event_properties) event.event_properties = eigenschaftenOhneAbfrage(event.event_properties, origin);
      if (event.user_properties) event.user_properties = eigenschaftenOhneAbfrage(event.user_properties, origin);
      return event;
    },
  };
}

/**
 * Amplitude-Vorstufe: hält jedes Ereignis an, bis `freigeben()` gerufen ist.
 * So geht kein Ereignis raus, bevor die Anreicherung oben angemeldet ist
 * (sie lässt sich erst nach init() hinter die eingebauten hängen).
 */
export function amplitudeSperre(): { plugin: Types.BeforePlugin; freigeben: () => void } {
  let freigeben = () => {};
  const offen = new Promise<void>((resolve) => {
    freigeben = resolve;
  });
  return {
    plugin: {
      name: `${AMPLITUDE_PLUGIN_NAME}-sperre`,
      type: "before",
      async execute(event) {
        await offen;
        return event;
      },
    },
    freigeben,
  };
}

/**
 * GA4 (Inline-Skript, läuft vor gtag('config')): page_location ist origin +
 * Pfad, ein Referrer dieses Ursprungs wird wie in ohneAbfrage() gekürzt,
 * ein fremder bleibt. Per gtag('set'), nicht im config-Aufruf: dort gesetzt
 * bliebe page_location nach einem Seitenwechsel im Browser auf der ersten
 * Seite stehen (gtag ignoriert spätere config- und set-Werte dafür);
 * ga4-script.tsx führt den Wert per set nach.
 *
 * Grenze: Die Seitenaufrufe aus GA4s „Browserverlauf“-Messung (Enhanced
 * Measurement) setzen page_location und page_referrer selbst aus der vollen
 * Adresse. Das lässt sich nur in der GA4-Verwaltung abstellen
 * (Datenschwärzung für Abfrageparameter oder Verlaufs-Seitenaufrufe aus).
 */
export const GA4_ADRESSEN_SKRIPT =
  "(function(){var o=location.origin,r=document.referrer||'';" +
  "if(r===o||r.indexOf(o+'/')===0||r.indexOf(o+'?')===0||r.indexOf(o+'#')===0)r=r.split(/[?#]/)[0];" +
  "var w={page_location:o+location.pathname};if(r)w.page_referrer=r;gtag('set',w);})();";

/** Plausible-Nutzlast (Felder, die eine Adresse tragen können). */
export interface PlausibleNutzlast {
  u?: string;
  r?: string | null;
  p?: Record<string, unknown>;
  [feld: string]: unknown;
}

/**
 * Für Plausibles transformRequest: Seitenadresse (u), Referrer (r) und
 * Adress-Eigenschaften (p, z. B. props.url) ohne Abfrage dieses Ursprungs.
 */
export function plausibleOhneAbfrage<T extends PlausibleNutzlast>(nutzlast: T, origin: string): T {
  const neu: T = { ...nutzlast };
  if (typeof neu.u === "string") neu.u = ohneAbfrage(neu.u, origin);
  if (typeof neu.r === "string") neu.r = ohneAbfrage(neu.r, origin);
  if (neu.p && typeof neu.p === "object") neu.p = eigenschaftenOhneAbfrage(neu.p, origin);
  return neu;
}
