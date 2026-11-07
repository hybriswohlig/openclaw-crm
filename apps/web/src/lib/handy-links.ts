/**
 * Plan 10 „Handy und alte Links“: Vertrag (Ziel `apps/web/src/lib/handy-links.ts`).
 *
 * Rein: keine Datenbank, kein Netz, keine Importe. Die Middleware (Edge) importiert
 * diese Datei, deshalb darf sie nichts aus `services/` oder `lib/deal-source` ziehen.
 */

// ─── Weiche und Spiegel-Cookie ───────────────────────────────────────────────

export type UiVersion = "alt" | "neu";

/** Spiegel von `user_settings.ui_version` für die Middleware. Wahrheit bleibt die Datenbank. */
export const UI_COOKIE = "crm_ui";
export const UI_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** `?alt=1` erzwingt die alte Seite (Notausgang, Rückweg aus der Weiche, Team zuweisen). */
export const ALT_PARAM = "alt";
/** Neutrale Weiche: wertet `ui_version` aus und leitet weiter. */
export const WEICHE_PFAD = "/weiter";

export type WeiterZiel =
  | { art: "gespraech"; id: string }
  | { art: "deal"; id: string }
  | { art: "inbox" };

const ID_MUSTER = /^[A-Za-z0-9_-]{1,64}$/;

/** Kennung von Deal oder Gespräch, wie sie in Pfaden und Abfragen vorkommen darf. */
export function istId(v: string | null | undefined): v is string {
  return typeof v === "string" && ID_MUSTER.test(v);
}

export function uiCookieWert(v: string | null | undefined): UiVersion | null {
  return v === "alt" || v === "neu" ? v : null;
}

/** Link, den Push, Service Worker, Lagekarte und iCal ab Plan 10 bauen. */
export function weiterLink(z: WeiterZiel): string {
  if (z.art === "gespraech") return `${WEICHE_PFAD}?conv=${encodeURIComponent(z.id)}`;
  if (z.art === "deal") return `${WEICHE_PFAD}?deal=${encodeURIComponent(z.id)}`;
  return WEICHE_PFAD;
}

/** Ziel aus der Abfrage der Weiche. `conv` vor `deal`; ungültige Kennung zählt als fehlend. */
export function weiterZielAus(params: URLSearchParams): WeiterZiel {
  const conv = params.get("conv");
  if (istId(conv)) return { art: "gespraech", id: conv };
  const deal = params.get("deal");
  if (istId(deal)) return { art: "deal", id: deal };
  return { art: "inbox" };
}

/**
 * Ziel in der neuen Oberfläche. Ein Gespräch mit Deal öffnet den Deal-Eintrag
 * (`deal:<id>`), sonst den Gesprächs-Eintrag; Schlüssel wie `lib/inbox-neu.ts`.
 */
export function neuesZiel(z: WeiterZiel, gespraechDealId: string | null): string {
  if (z.art === "deal") return `/app/leads/${encodeURIComponent(z.id)}`;
  if (z.art === "gespraech") {
    const key = istId(gespraechDealId) ? `deal:${gespraechDealId}` : `gespraech:${z.id}`;
    return `/app/inbox?e=${encodeURIComponent(key)}`;
  }
  return "/app/inbox";
}

/** Ziel in der alten Oberfläche, immer mit `alt=1`, damit die Middleware nie zurückleitet. */
export function altesZiel(z: WeiterZiel): string {
  if (z.art === "deal") return `/objects/deals/${encodeURIComponent(z.id)}?${ALT_PARAM}=1`;
  if (z.art === "gespraech") return `/inbox?conv=${encodeURIComponent(z.id)}&${ALT_PARAM}=1`;
  return "/inbox";
}

/** Hängt `alt=1` an einen Pfad der alten Oberfläche (idempotent). */
export function mitAlt(url: string): string {
  const [pfad, abfrage = ""] = url.split("?", 2);
  const params = new URLSearchParams(abfrage);
  params.set(ALT_PARAM, "1");
  return `${pfad}?${params.toString()}`;
}

/**
 * Regel der Middleware (Plan 10, nur zwei Ziele; Plan 14 erweitert sie):
 * - nur bei Cookie `crm_ui=neu`;
 * - `/objects/deals/<id>` ohne jede Abfrage (mit `tab`, `alt` oder anderem bleibt es alt);
 * - `/inbox` mit gültigem `conv` und ohne `alt` und ohne `compose`.
 * Ergebnis ist immer ein Weichen-Link, nie direkt `/app/...`: die Weiche prüft
 * die Datenbank und setzt den Cookie neu.
 */
export function altUmleitung(
  pathname: string,
  params: URLSearchParams,
  uiCookie: string | null | undefined
): string | null {
  if (uiCookieWert(uiCookie) !== "neu") return null;
  const deal = /^\/objects\/deals\/([^/]+)\/?$/.exec(pathname);
  if (deal) {
    if ([...params.keys()].length > 0) return null;
    const id = decodeURIComponent(deal[1]);
    return istId(id) ? weiterLink({ art: "deal", id }) : null;
  }
  if (pathname === "/inbox" || pathname === "/inbox/") {
    if (params.has(ALT_PARAM) || params.has("compose")) return null;
    const conv = params.get("conv");
    return istId(conv) ? weiterLink({ art: "gespraech", id: conv }) : null;
  }
  return null;
}

/** iCal: `href` aus `map-events.ts` (`/objects/deals/<id>`) wird zur Weiche; anderes bleibt. Die UID ändert sich nicht. */
export function akteLinkAusHref(href: string): string {
  const deal = /^\/objects\/deals\/([^/?#]+)$/.exec(href);
  if (!deal) return href;
  const id = decodeURIComponent(deal[1]);
  return istId(id) ? weiterLink({ art: "deal", id }) : href;
}

/**
 * Kundenakte (Plan 11). Bis Plan 11 auf `main` ist, zeigt der Link auf die alte
 * Personenseite; der Koordinator stellt `KUNDENAKTE_NEU` nach dem Merge von Plan 11 um.
 */
export const KUNDENAKTE_NEU = false;
export function kundeLink(personId: string): string {
  const id = encodeURIComponent(personId);
  return KUNDENAKTE_NEU ? `/app/kunden/${id}` : `/objects/people/${id}`;
}

// ─── Verfassen in der neuen Inbox ────────────────────────────────────────────

export interface VerfassenVorgabe {
  channelAccountId: string | null;
  telefon: string | null;
  name: string | null;
  dealRecordId: string | null;
}

/** `/app/inbox?verfassen=1&…`; leere Felder fallen weg. */
export function verfassenUrl(v: VerfassenVorgabe): string {
  const params = new URLSearchParams({ verfassen: "1" });
  if (v.channelAccountId) params.set("kanal", v.channelAccountId);
  if (v.telefon) params.set("telefon", v.telefon);
  if (v.name) params.set("name", v.name);
  if (v.dealRecordId) params.set("deal", v.dealRecordId);
  return `/app/inbox?${params.toString()}`;
}

/** Vorgabe aus der Abfrage; null ohne `verfassen=1`. Name höchstens 120 Zeichen, Telefon höchstens 32. */
export function verfassenAus(params: URLSearchParams): VerfassenVorgabe | null {
  if (params.get("verfassen") !== "1") return null;
  const text = (k: string, max: number): string | null => {
    const v = params.get(k)?.trim() ?? "";
    return v && v.length <= max ? v : null;
  };
  const kanal = params.get("kanal");
  const deal = params.get("deal");
  return {
    channelAccountId: istId(kanal) ? kanal : null,
    telefon: text("telefon", 32),
    name: text("name", 120),
    dealRecordId: istId(deal) ? deal : null,
  };
}

/** Eintrag, den die Inbox nach dem Senden wählt. */
export function nachVerfassenSchluessel(conversationId: string, dealRecordId: string | null): string {
  return istId(dealRecordId) ? `deal:${dealRecordId}` : `gespraech:${conversationId}`;
}

// ─── Neuer Lead ──────────────────────────────────────────────────────────────

/** Gleiche Form wie `PersonenKarte` in `lib/phone-call-lead.ts`. */
export interface Karte {
  id: string;
  name: string;
}

export type PersonWahl = { art: "neu" } | { art: "bestehend"; personId: string };

export interface NeuerLeadEingabe {
  name: string;
  telefon: string | null;
  email: string | null;
  firmaId: string;
  quelle: string;
  /** JJJJ-MM-TT oder null. */
  umzugsdatum: string | null;
  personWahl: PersonWahl | null;
}

export type NeuerLeadFeld = "name" | "kontakt" | "email" | "firma" | "quelle" | "umzugsdatum" | "personWahl";

export type NeuerLeadPruefung =
  | { ok: true; eingabe: NeuerLeadEingabe }
  | { ok: false; feld: NeuerLeadFeld; text: string };

export const NEUER_LEAD_TEXT: Record<NeuerLeadFeld, string> = {
  name: "Bitte einen Namen eintragen, 2 bis 120 Zeichen, nicht nur Ziffern.",
  kontakt: "Bitte Telefon oder E-Mail eintragen.",
  email: "Die E-Mail-Adresse sieht nicht gültig aus.",
  firma: "Bitte die Firma wählen.",
  quelle: "Bitte die Quelle wählen.",
  umzugsdatum: "Das Umzugsdatum ist ungültig.",
  personWahl: "Bitte wählen: bestehender Kunde oder neue Person.",
};

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function gueltigesDatum(v: string): boolean {
  if (!DATUM.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Prüft den Körper von `POST /api/v1/leads`. `quellen` ist `SOURCE_CHANNEL_OPTIONS`
 * (vom Aufrufer, damit der Vertrag importfrei bleibt). Telefon wird hier nur
 * gekürzt; kanonisieren macht die Route (`canonicalizePhone`).
 */
export function neuerLeadPruefen(roh: unknown, quellen: readonly string[]): NeuerLeadPruefung {
  const fehler = (feld: NeuerLeadFeld): NeuerLeadPruefung => ({ ok: false, feld, text: NEUER_LEAD_TEXT[feld] });
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return fehler("name");
  const r = roh as Record<string, unknown>;
  const text = (v: unknown): string => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "");

  const name = text(r.name);
  if (name.length < 2 || name.length > 120 || /^[\d\s+\-./()]+$/.test(name)) return fehler("name");
  const telefon = text(r.telefon) || null;
  const email = text(r.email).toLowerCase() || null;
  if (!telefon && !email) return fehler("kontakt");
  if (telefon && telefon.length > 32) return fehler("kontakt");
  if (email && (email.length > 200 || !EMAIL.test(email))) return fehler("email");
  const firmaId = text(r.firmaId);
  if (!istId(firmaId)) return fehler("firma");
  const quelle = text(r.quelle);
  if (!quellen.includes(quelle)) return fehler("quelle");
  const datum = text(r.umzugsdatum) || null;
  if (datum && !gueltigesDatum(datum)) return fehler("umzugsdatum");

  let personWahl: PersonWahl | null = null;
  if (r.personWahl != null) {
    const w = r.personWahl as Record<string, unknown>;
    if (w && w.art === "neu") personWahl = { art: "neu" };
    else if (w && w.art === "bestehend" && typeof w.personId === "string" && istId(w.personId)) {
      personWahl = { art: "bestehend", personId: w.personId };
    } else return fehler("personWahl");
  }
  return { ok: true, eingabe: { name, telefon, email, firmaId, quelle, umzugsdatum: datum, personWahl } };
}

export type NeuerLeadEntscheid =
  | { art: "anlegen"; person: { neu: true } | { neu: false; id: string } }
  /** Treffer zur Nummer und noch keine Wahl, oder die Wahl ist kein Treffer: Mensch entscheidet (409). */
  | { art: "rueckfrage"; treffer: Karte[] };

/** Treffer = lebende Personen mit derselben kanonischen Nummer (`kartenFuerNummer`). Nie automatisch zuordnen. */
export function neuerLeadEntscheid(treffer: readonly Karte[], wahl: PersonWahl | null): NeuerLeadEntscheid {
  if (treffer.length === 0) {
    if (wahl?.art === "bestehend") return { art: "rueckfrage", treffer: [] };
    return { art: "anlegen", person: { neu: true } };
  }
  if (!wahl) return { art: "rueckfrage", treffer: [...treffer] };
  if (wahl.art === "neu") return { art: "anlegen", person: { neu: true } };
  const id = wahl.personId;
  return treffer.some((t) => t.id === id)
    ? { art: "anlegen", person: { neu: false, id } }
    : { art: "rueckfrage", treffer: [...treffer] };
}

/** Antwort von `POST /api/v1/leads`. */
export type NeuerLeadAntwort =
  | { ok: true; dealRecordId: string; personRecordId: string }
  | { ok: false; code: "RUECKFRAGE"; treffer: Karte[] };

// ─── Anruf zuordnen (Erweiterung von POST /api/v1/phone-calls/{callId}/lead) ──

/** Körper der Route. Neu ist nur `personId` (Wahl unter den Treffern zur Nummer). */
export interface AnrufLeadKoerper {
  name?: string;
  dealId?: string;
  neuerLead?: boolean;
  personId?: string;
}

/** Was der Zuordnen-Dialog aus einer Listenzeile (`GET /api/v1/phone-calls`) anbietet. */
export type AnrufDialogLage =
  | { art: "keiner" }
  | { art: "person_waehlen"; treffer: Karte[] }
  | { art: "lead_waehlen"; person: Karte; leads: Karte[] }
  | { art: "an_lead"; person: Karte; lead: Karte }
  | { art: "neuer_lead"; person: Karte | null };

/**
 * Lage aus `matchStatus`, `dealRecordId`, `karten`, `bestehendePerson`, `offeneLeads`.
 * Mit Lead oder bei `matched` ohne Lead: „keiner“ (wie heute, Hinweistext bleibt).
 */
export function anrufDialogLage(a: {
  matchStatus: string;
  dealRecordId: string | null;
  karten: readonly Karte[];
  bestehendePerson: Karte | null;
  offeneLeads: readonly Karte[];
}): AnrufDialogLage {
  if (a.dealRecordId || a.matchStatus === "matched") return { art: "keiner" };
  if (a.karten.length >= 2) return { art: "person_waehlen", treffer: [...a.karten] };
  if (a.matchStatus === "ambiguous") return { art: "keiner" };
  const person = a.bestehendePerson;
  if (person && a.offeneLeads.length >= 2) return { art: "lead_waehlen", person, leads: [...a.offeneLeads] };
  if (person && a.offeneLeads.length === 1) return { art: "an_lead", person, lead: a.offeneLeads[0] };
  return { art: "neuer_lead", person };
}
