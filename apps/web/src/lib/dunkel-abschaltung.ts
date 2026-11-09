/**
 * Plan 14: Dunkel und Abschaltung. Vertrag (rein: keine Datenbank, kein Netz, kein DOM-Zugriff
 * außer im Text des Kopf-Skripts). Ziel im Repo: apps/web/src/lib/dunkel-abschaltung.ts
 *
 * `DarstellungSpiegel` ist seit 14b ein Alias von `Darstellung` aus Plan 13; `ALT_PARAM` kommt aus
 * Plan 10 (`@/lib/handy-links`). Beide Importe sind rein (Edge-tauglich, ohne Datenbank).
 */

import type { Darstellung } from "@/lib/einstellungen-uebersicht";
import { ALT_PARAM } from "@/lib/handy-links";

// ─── 1. Darstellung ─────────────────────────────────────────────────────────

export type DarstellungSpiegel = Darstellung;
export type LgTheme = "light" | "dark";

/** Spiegel-Cookie der Darstellung; das Kopf-Skript liest ihn vor dem ersten Bild. */
export const DARSTELLUNG_COOKIE = "neu_darstellung";
export const COOKIE_MAX_ALTER_S = 400 * 24 * 60 * 60;

/** Seitenfarbe für Statusleiste und PWA in /app. */
export const NEU_THEMEFARBE: Record<LgTheme, string> = { light: "#faf9f7", dark: "#1c1c1e" };

export function darstellungLesen(roh: string | null | undefined): DarstellungSpiegel | null {
  return roh === "hell" || roh === "dunkel" || roh === "system" ? roh : null;
}

/** Ohne gültigen Wert gilt „system“ (Übersicht S2). */
export function themeAus(d: DarstellungSpiegel | null, systemDunkel: boolean): LgTheme {
  if (d === "hell") return "light";
  if (d === "dunkel") return "dark";
  return systemDunkel ? "dark" : "light";
}

/** Nur Pfade der neuen Oberfläche bekommen je ein dunkles Theme. */
export function istNeuPfad(pfad: string): boolean {
  return pfad === "/app" || pfad.startsWith("/app/");
}

/** Set-Cookie-Wert (für Route-Antworten und `document.cookie`). */
export function cookieZeile(name: string, wert: string, sicher: boolean): string {
  return `${name}=${encodeURIComponent(wert)}; Path=/; Max-Age=${COOKIE_MAX_ALTER_S}; SameSite=Lax${sicher ? "; Secure" : ""}`;
}

/** Wert eines Cookies aus einem `document.cookie`-artigen Text. */
export function cookieWert(cookies: string, name: string): string | null {
  for (const teil of cookies.split(";")) {
    const [k, ...rest] = teil.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Inline-Skript für `<head>` im Root-Layout. Läuft vor dem ersten Bild, nur unter /app.
 * Setzt ausschließlich `data-lg-theme` auf <html> und die Themenfarbe; fasst nie die Klasse
 * `dark` an (next-themes, Portal und alte Seiten hängen daran).
 */
export const DARSTELLUNG_SKRIPT = `(function(){try{var p=location.pathname;if(p!=="/app"&&p.indexOf("/app/")!==0)return;var m=document.cookie.match(/(?:^|; )${DARSTELLUNG_COOKIE}=([^;]*)/);var d=m?decodeURIComponent(m[1]):"system";var dunkel=d==="dunkel"||(d!=="hell"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-lg-theme",dunkel?"dark":"light");}catch(e){}})();`;

// ─── 2. Tokens ──────────────────────────────────────────────────────────────

/**
 * Tokens, die unter `[data-neu]` hell und unter `[data-lg-theme="dark"] [data-neu]` dunkel
 * gesetzt werden. `neu.css` muss genau diese Werte tragen (Test liest die Datei).
 * Neu gegenüber main: `*-ink` für Text in Akzentfarbe (aus neu-akte.css nach neu.css),
 * `--violet-ink`, `--flaeche` (deckend), `--tinte-flaeche` (dunkle Fläche mit weißer Schrift,
 * ersetzt `background: var(--ink)`), `--silber-1`/`--silber-2` (Band im Hintergrund).
 */
export const TOKENS: Record<string, { hell: string; dunkel: string }> = {
  "--ink": { hell: "#222224", dunkel: "#f5f5f7" },
  "--ink-2": { hell: "#66666a", dunkel: "#c7c7cc" },
  "--ink-3": { hell: "#8e8e93", dunkel: "#a1a1a6" },
  "--fill": { hell: "rgba(255, 255, 255, 0.52)", dunkel: "rgba(44, 44, 46, 0.52)" },
  "--fill-2": { hell: "rgba(255, 255, 255, 0.68)", dunkel: "rgba(44, 44, 46, 0.68)" },
  "--fill-3": { hell: "rgba(255, 255, 255, 0.88)", dunkel: "rgba(44, 44, 46, 0.88)" },
  "--flaeche": { hell: "#ffffff", dunkel: "#2c2c2e" },
  "--tinte-flaeche": { hell: "#222224", dunkel: "#3a3a3c" },
  "--rim": { hell: "rgba(255, 255, 255, 0.92)", dunkel: "rgba(255, 255, 255, 0.12)" },
  "--hair": { hell: "rgba(34, 34, 36, 0.08)", dunkel: "rgba(255, 255, 255, 0.10)" },
  "--gold-ink": { hell: "#8a5200", dunkel: "#f5b54a" },
  "--rose-ink": { hell: "#a8113a", dunkel: "#ff8fa3" },
  "--jade-ink": { hell: "#0d6b4a", dunkel: "#4fd8a4" },
  "--blue-ink": { hell: "#0054b3", dunkel: "#7ab8ff" },
  "--violet-ink": { hell: "#5a3fd6", dunkel: "#b4a5ff" },
  /** Heller Gold-Ton als Fläche (Hinweis, „wartet“); dunkel etwas kräftiger, damit er sichtbar bleibt. */
  "--gold-tint": { hell: "rgba(232, 150, 12, 0.14)", dunkel: "rgba(232, 150, 12, 0.22)" },
  "--seite-oben": { hell: "#faf9f7", dunkel: "#242426" },
  "--seite-unten": { hell: "#e6e8ec", dunkel: "#1c1c1e" },
  "--silber-1": { hell: "#d2d5da", dunkel: "#3a3d42" },
  "--silber-2": { hell: "#ffffff", dunkel: "#2c2c2e" },
};

/** „Transparenz reduzieren“: deckende Flächen je Theme. */
export const FILL_DECKEND: Record<LgTheme, string> = { light: "#ffffff", dark: "#2c2c2e" };

/** Kürzel-Farben für Avatare und Kürzel (heute viermal kopiert, erste Farbe `var(--ink)`). */
export const KUERZEL_FARBEN = [
  "var(--tinte-flaeche)",
  "#0d6b4a",
  "#0054b3",
  "#5a3fd6",
  "#a8113a",
  "#0e6f86",
  "#3d4f6b",
] as const;

// ─── 3. Kontrast (WCAG 2.x) ─────────────────────────────────────────────────

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function farbeLesen(f: string): Rgba | null {
  const s = f.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(s);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(s);
  if (rgb) return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a: rgb[4] === undefined ? 1 : +rgb[4] };
  return null;
}

/** Legt eine (halb)transparente Farbe über einen deckenden Grund. */
export function ueber(vorne: string, grund: string): string {
  const v = farbeLesen(vorne);
  const g = farbeLesen(grund);
  if (!v || !g) throw new Error(`Farbe nicht lesbar: ${vorne} / ${grund}`);
  const m = (x: number, y: number) => Math.round(x * v.a + y * (1 - v.a));
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(m(v.r, g.r))}${h(m(v.g, g.g))}${h(m(v.b, g.b))}`;
}

function leuchtdichte(f: string): number {
  const c = farbeLesen(f);
  if (!c) throw new Error(`Farbe nicht lesbar: ${f}`);
  const kanal = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * kanal(c.r) + 0.7152 * kanal(c.g) + 0.0722 * kanal(c.b);
}

export function kontrast(a: string, b: string): number {
  const [x, y] = [leuchtdichte(a), leuchtdichte(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Textfarben, die auf jeder Fläche 4,5:1 halten müssen. */
export const TEXT_TOKENS = ["--ink", "--ink-2", "--gold-ink", "--rose-ink", "--jade-ink", "--blue-ink", "--violet-ink"] as const;
/** Flächen, auf denen Text steht (Glas über dem Seitengrund, deckend). */
export const FLAECHEN_TOKENS = ["--fill", "--fill-2", "--fill-3", "--flaeche"] as const;

/** Kleinster Kontrast eines Text-Tokens über allen Flächen und beiden Seitenenden. */
export function minKontrast(text: string, theme: "hell" | "dunkel"): number {
  const t = TOKENS[text][theme];
  let min = Infinity;
  for (const seite of [TOKENS["--seite-oben"][theme], TOKENS["--seite-unten"][theme]]) {
    for (const f of FLAECHEN_TOKENS) min = Math.min(min, kontrast(t, ueber(TOKENS[f][theme], seite)));
  }
  return min;
}

// ─── 4. Wächter gegen harte Farben in styles/neu*.css ───────────────────────

export interface FarbBefund {
  datei: string;
  zeile: number;
  text: string;
}

const FARBE_IM_WERT = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
const AKZENT_ALS_TEXT = /^\s*color\s*:\s*var\(--(blue|jade|gold|rose|violet)\)/;
const WEISSE_SCHRIFT = /^\s*color\s*:\s*#fff(fff)?\s*;/i;

/**
 * Meldet Deklarationen mit harter Farbe (Hex, rgb, rgba) und Akzentfarben als Textfarbe.
 * Erlaubt: Token-Definitionen (`--name: …`), weiße Schrift (`color: #fff`), Zeilen mit
 * dem Kommentar `/* fest *\/` (bewusst themenunabhängig, z. B. Logo-Kachel, Dokumentvorschau).
 */
export function harteFarben(css: string, datei: string): FarbBefund[] {
  const befunde: FarbBefund[] = [];
  const zeilen = css.split("\n");
  let inKommentar = false;
  zeilen.forEach((roh, i) => {
    let z = roh;
    if (inKommentar) {
      const ende = z.indexOf("*/");
      if (ende < 0) return;
      z = z.slice(ende + 2);
      inKommentar = false;
    }
    const fest = /\/\*\s*fest\s*\*\//.test(z);
    z = z.replace(/\/\*.*?\*\//g, "");
    const start = z.indexOf("/*");
    if (start >= 0) {
      inKommentar = true;
      z = z.slice(0, start);
    }
    if (fest) return;
    const decl = /^\s*([-\w]+)\s*:\s*(.+)$/.exec(z);
    if (!decl) return;
    if (decl[1].startsWith("--")) return;
    if (WEISSE_SCHRIFT.test(z)) return;
    if (FARBE_IM_WERT.test(decl[2]) || AKZENT_ALS_TEXT.test(z)) {
      befunde.push({ datei, zeile: i + 1, text: roh.trim() });
    }
  });
  return befunde;
}

// ─── 5. Umleitung alter Pfade ───────────────────────────────────────────────

/**
 * Spiegel-Cookie `crm_ui`, Weiche `/weiter`, `mitAlt` und `altUmleitung` (Akte, Inbox mit `conv`)
 * liefert Plan 10 in `@/lib/handy-links`. Die Middleware ruft zuerst `altUmleitung`, dann
 * `umleitZiel`. `?alt=1` (von `mitAlt`) schaltet beide je Link ab.
 */
export { ALT_PARAM };
/** Umgebungsvariable nur für die Pfade dieses Plans; alles außer "an" heißt aus. */
export const UMLEITUNG_ENV = "ALTE_PFADE_UMLEITEN";

/** Präfixe, die nie umgeleitet werden. */
export const NIE_UMLEITEN = [
  "/api/",
  "/app",
  "/s/",
  "/r/",
  "/legal/",
  "/mitarbeiter",
  "/login",
  "/register",
  "/passwort-setzen",
  "/pending-approval",
  "/start",
  "/weiter",
  "/_next",
] as const;

/** Pfade, die Plan 10 regelt (Akte mit und ohne Reiter, Inbox mit Abfrage). Plan 14 lässt sie unberührt. */
export const PLAN10_PRAEFIXE = ["/objects/deals/", "/inbox/"] as const;

export interface Zuordnung {
  /** Exakter Pfad oder Muster mit `:id` als letztem Segment. */
  alt: string;
  /** Ziel; `:id` wird übernommen. `null` = offenes Ziel, bleibt alt. */
  neu: string | null;
  /** Bei `neu === null`: warum; sonst der Plan, der das Ziel liefert. */
  grund: string;
}

export const ZUORDNUNG: readonly Zuordnung[] = [
  { alt: "/home", neu: "/app/heute/karte", grund: "Plan 10 (Lagekarte unter Heute)" },
  { alt: "/inbox", neu: "/app/inbox", grund: "nur ohne Abfrage; `conv` regelt Plan 10, `compose` bleibt alt" },
  { alt: "/objects/deals", neu: "/app/leads", grund: "Plan 7" },
  { alt: "/objects/people", neu: "/app/kunden", grund: "Plan 11" },
  { alt: "/objects/people/:id", neu: "/app/kunden/:id", grund: "Plan 11" },
  { alt: "/anrufe", neu: "/app/anrufe", grund: "Plan 10 (Zuordnen)" },
  { alt: "/contract-calendar", neu: "/app/plan", grund: "Plan 8, Kalender-Abo Plan 13" },
  { alt: "/operations", neu: "/app/plan", grund: "Plan 12 (Team bestätigen)" },
  { alt: "/employees", neu: "/app/mitarbeiter", grund: "Plan 12" },
  { alt: "/financial", neu: "/app/kasse", grund: "Plan 9; Gesellschaften bleiben alt (Link mit ?alt=1)" },
  { alt: "/statistics", neu: "/app/uebersicht", grund: "Plan 13" },
  { alt: "/settings", neu: "/app/einstellungen", grund: "Plan 13" },
  { alt: "/objects/companies", neu: null, grund: "Firmenkunden nicht im Neubau" },
  { alt: "/objects/auftraege", neu: null, grund: "generische Objektseite" },
  { alt: "/lists/:id", neu: null, grund: "Listen nicht in der Spec" },
  { alt: "/email", neu: null, grund: "Verfassen neuer E-Mails und Konto-Sync fehlen" },
  { alt: "/sichtbarkeit", neu: null, grund: "PostHog-Auswertung nicht in Übersicht" },
  { alt: "/leads/speed-to-lead", neu: null, grund: "Kennzahl fehlt in Übersicht" },
  { alt: "/leads/feld-vorschlaege", neu: null, grund: "KI-Feldvorschläge fehlen" },
  { alt: "/tasks", neu: null, grund: "Aufgaben-Modul, Inhaber-Frage offen" },
  { alt: "/notes", neu: null, grund: "globale Notizliste fehlt" },
  { alt: "/notifications", neu: null, grund: "Mitteilungsliste fehlt" },
  { alt: "/search", neu: null, grund: "globale Suche fehlt" },
  { alt: "/integrations", neu: null, grund: "Kanalpflege nicht in Einstellungen" },
  { alt: "/admin/ai-tasks", neu: null, grund: "KI-Aufgaben-Prompts" },
];

function passt(muster: string, pfad: string): string | null | false {
  if (!muster.endsWith("/:id")) return muster === pfad ? null : false;
  const basis = muster.slice(0, -4);
  if (!pfad.startsWith(basis + "/")) return false;
  const id = pfad.slice(basis.length + 1);
  return id && !id.includes("/") ? id : false;
}

/**
 * Ziel für einen alten Pfad oder `null` (nicht umleiten). Unbekannte Unterpfade
 * (`/settings/whatsapp`, `/tasks/projects/1`) bleiben alt. Die Abfrage fällt weg;
 * `/objects/deals?create=1` und `/inbox` mit Abfrage bleiben alt.
 */
export function umleitZiel(pfad: string, suche: URLSearchParams): string | null {
  if (suche.has(ALT_PARAM)) return null;
  if (NIE_UMLEITEN.some((p) => pfad === p || pfad.startsWith(p.endsWith("/") ? p : p + "/"))) return null;
  if (PLAN10_PRAEFIXE.some((p) => pfad === p || pfad.startsWith(p))) return null;
  if (pfad === "/objects/deals" && suche.has("create")) return null;
  if (pfad === "/inbox" && [...suche.keys()].length > 0) return null;
  for (const z of ZUORDNUNG) {
    const treffer = passt(z.alt, pfad);
    if (treffer === false) continue;
    if (!z.neu) return null;
    return treffer === null ? z.neu : z.neu.replace(":id", encodeURIComponent(treffer));
  }
  return null;
}

/** Ereignis in `activity_events` für jede gerenderte alte Seite (Grundlage der Lösch-Checkliste). */
export const ALT_AUFRUF_EVENT = "alte_seite.aufruf";
export interface AltAufruf {
  pfad: string;
  ui: "neu" | "alt" | null;
  mitAlt: boolean;
}

// ─── 6. PUT /quotation in Stufen ────────────────────────────────────────────

export const QUOTATION_STUFE_ENV = "QUOTATION_PUT_STUFE";
export type QuotationStufe = "zaehlen" | "sperren";
export function quotationStufe(roh: string | undefined): QuotationStufe {
  return roh === "sperren" ? "sperren" : "zaehlen";
}

/** Header, den der MCP-Dispatch bei `crm_update_deal_quotation` und `crm_api` mitsendet. */
export const MCP_WERKZEUG_HEADER = "x-crm-mcp-tool";
/** Wert von `CRM_UI_CLIENT_HEADER` (`x-crm-client`, `@/lib/deal-source`) für Aufrufe aus der Oberfläche. */
export const UI_CLIENT_WERT = "ui";

export type QuotationQuelle = "ui" | "mcp_werkzeug" | "mcp_crm_api" | "api_schluessel" | "sitzung";

export function quotationQuelle(e: {
  authMethod?: "cookie" | "api_key";
  uiHeader: string | null;
  mcpWerkzeug: string | null;
}): QuotationQuelle {
  if (e.mcpWerkzeug === "crm_update_deal_quotation") return "mcp_werkzeug";
  if (e.mcpWerkzeug === "crm_api") return "mcp_crm_api";
  if (e.authMethod === "api_key") return "api_schluessel";
  return e.uiHeader === UI_CLIENT_WERT ? "ui" : "sitzung";
}

/** Nur die Oberfläche (Sitzung plus Header) darf nach der Sperre noch schreiben. */
export function quotationPutErlaubt(stufe: QuotationStufe, quelle: QuotationQuelle): boolean {
  return stufe === "zaehlen" || quelle === "ui";
}

export const QUOTATION_ZAEHL_EVENT = "quotation.put";
export interface QuotationZaehlung {
  quelle: QuotationQuelle;
  stufe: QuotationStufe;
  abgelehnt: boolean;
  dealRecordId: string;
  apiKeyId: string | null;
  felder: string[];
}

export const QUOTATION_ERSATZ = [
  "crm_get_calculation",
  "crm_override_calculation",
  "crm_lock_calculation_version",
  "crm_render_kv_from_version",
  "crm_update_quotation_details",
  "crm_set_deal_anzahlung",
  "crm_update_deal_package_options",
] as const;

export const QUOTATION_GESPERRT = {
  status: 410,
  code: "QUOTATION_PUT_GONE",
  message:
    "Writing the quotation directly is switched off. Change prices in the calculation (crm_override_calculation, then crm_lock_calculation_version); validity, notes, summary and service type via crm_update_quotation_details.",
  ersatz: QUOTATION_ERSATZ,
} as const;

/** Bereit zur Sperre: mindestens 30 Tage gezählt und 14 Tage kein Aufruf außer aus der Oberfläche. */
export const ZAEHL_MIN_TAGE = 30;
export const RUHE_TAGE = 14;
export function sperreBereit(
  zaehlungSeit: Date,
  aufrufe: ReadonlyArray<{ quelle: QuotationQuelle; am: Date }>,
  jetzt: Date
): { bereit: boolean; gruende: string[] } {
  const tag = 24 * 60 * 60 * 1000;
  const gruende: string[] = [];
  const tage = Math.floor((jetzt.getTime() - zaehlungSeit.getTime()) / tag);
  if (tage < ZAEHL_MIN_TAGE) gruende.push(`erst ${tage} von ${ZAEHL_MIN_TAGE} Tagen gezählt`);
  const grenze = jetzt.getTime() - RUHE_TAGE * tag;
  const fremd = aufrufe.filter((a) => a.quelle !== "ui" && a.am.getTime() >= grenze);
  if (fremd.length > 0) gruende.push(`${fremd.length} Aufrufe außerhalb der Oberfläche in den letzten ${RUHE_TAGE} Tagen`);
  return { bereit: gruende.length === 0, gruende };
}

// ─── 7. Ersatz-Werkzeug crm_update_quotation_details ────────────────────────

export const SERVICE_TYPES = ["move", "kitchen_installation", "clearance", "clearance_move"] as const;
export type ServiceTypWahl = (typeof SERVICE_TYPES)[number];
export const DETAILS_TEXT_MAX = 4000;

/** Felder, die den Preis nicht berühren und die Verknüpfung zur Version stehen lassen. */
export interface QuotationDetailsPatch {
  validUntil?: string | null;
  notes?: string | null;
  summary?: string | null;
  serviceType?: ServiceTypWahl;
  paymentMethodPreference?: string | null;
  showStandardInclusions?: boolean;
}

/** Nach der Annahme darf nur noch `notes` (intern) geändert werden. */
export const NACH_ANNAHME_ERLAUBT: ReadonlyArray<keyof QuotationDetailsPatch> = ["notes"];

export function quotationDetailsPruefen(
  roh: unknown
): { ok: true; patch: QuotationDetailsPatch } | { ok: false; fehler: string } {
  if (!roh || typeof roh !== "object" || Array.isArray(roh)) return { ok: false, fehler: "Body muss ein Objekt sein" };
  const r = roh as Record<string, unknown>;
  const erlaubt = ["validUntil", "notes", "summary", "serviceType", "paymentMethodPreference", "showStandardInclusions"];
  const fremd = Object.keys(r).filter((k) => !erlaubt.includes(k));
  if (fremd.length) return { ok: false, fehler: `Unbekannte Felder: ${fremd.join(", ")}` };
  const patch: QuotationDetailsPatch = {};
  if ("validUntil" in r) {
    const v = r.validUntil;
    if (v !== null && (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))))
      return { ok: false, fehler: "validUntil muss YYYY-MM-DD oder null sein" };
    patch.validUntil = v as string | null;
  }
  for (const k of ["notes", "summary", "paymentMethodPreference"] as const) {
    if (!(k in r)) continue;
    const v = r[k];
    if (v !== null && (typeof v !== "string" || v.length > DETAILS_TEXT_MAX)) return { ok: false, fehler: `${k} muss Text bis ${DETAILS_TEXT_MAX} Zeichen oder null sein` };
    patch[k] = v === null ? null : (v as string).trim() || null;
  }
  if ("serviceType" in r) {
    if (!(SERVICE_TYPES as readonly unknown[]).includes(r.serviceType)) return { ok: false, fehler: `serviceType muss einer von ${SERVICE_TYPES.join(", ")} sein` };
    patch.serviceType = r.serviceType as ServiceTypWahl;
  }
  if ("showStandardInclusions" in r) {
    if (typeof r.showStandardInclusions !== "boolean") return { ok: false, fehler: "showStandardInclusions muss true oder false sein" };
    patch.showStandardInclusions = r.showStandardInclusions;
  }
  if (Object.keys(patch).length === 0) return { ok: false, fehler: "Keine Felder angegeben" };
  return { ok: true, patch };
}

// ─── 8. Prüfraster ──────────────────────────────────────────────────────────

export const PRUEFRASTER_BREITEN = [390, 1440] as const;
export const PRUEFRASTER_THEMES = ["hell", "dunkel"] as const;

/** `:deal` = Deal (a) aus `scripts/akte-testdaten.ts`, `:person` = dessen Person. */
export const PRUEFRASTER_SEITEN = [
  "/app/heute",
  "/app/leads",
  "/app/leads/:deal",
  "/app/leads/:deal/kalkulation",
  "/app/inbox",
  "/app/plan",
  "/app/anrufe",
  "/app/kasse",
  "/app/kunden",
  "/app/kunden/:person",
  "/app/mitarbeiter",
  "/app/bewertungen",
  "/app/einstellungen",
  "/app/uebersicht",
  "/app/mehr",
] as const;

export interface PruefFall {
  pfad: string;
  breite: (typeof PRUEFRASTER_BREITEN)[number];
  theme: (typeof PRUEFRASTER_THEMES)[number];
  datei: string;
}

export function pruefFaelle(ids: { deal: string; person: string }): PruefFall[] {
  const faelle: PruefFall[] = [];
  for (const seite of PRUEFRASTER_SEITEN) {
    const pfad = seite.replace(":deal", ids.deal).replace(":person", ids.person);
    const name = seite.replace(/^\/app\/?/, "").replace(/:deal/g, "deal").replace(/:person/g, "person").replace(/\//g, "-") || "app";
    for (const breite of PRUEFRASTER_BREITEN)
      for (const theme of PRUEFRASTER_THEMES) faelle.push({ pfad, breite, theme, datei: `${name}-${breite}-${theme}.png` });
  }
  return faelle;
}

// ─── 9. Löschen alter Seiten ────────────────────────────────────────────────

export const LOESCHEN_MIN_TAGE = 28;

export interface LoeschStand {
  umleitungAnSeit: Date | null;
  /** Aufrufe umgeleiteter alter Pfade mit `?alt=1` oder ohne Spiegel-Cookie in den letzten 14 Tagen. */
  altAufrufe14Tage: number;
  quotationGesperrtSeit: Date | null;
  /** Dateien der neuen Welt, die Module unter app/(dashboard) oder alte components/* importieren. */
  neuImportiertAlt: string[];
  /** Offene Ziele aus ZUORDNUNG, die der Inhaber noch nicht entschieden hat. */
  offeneZiele: string[];
  inhaberOkay: boolean;
}

export function loeschenErlaubt(s: LoeschStand, jetzt: Date): { erlaubt: boolean; offen: string[] } {
  const tag = 24 * 60 * 60 * 1000;
  const offen: string[] = [];
  if (!s.umleitungAnSeit) offen.push("Umleitung ist nicht eingeschaltet");
  else if ((jetzt.getTime() - s.umleitungAnSeit.getTime()) / tag < LOESCHEN_MIN_TAGE) offen.push(`Umleitung kürzer als ${LOESCHEN_MIN_TAGE} Tage an`);
  if (s.altAufrufe14Tage > 0) offen.push(`${s.altAufrufe14Tage} Aufrufe alter Seiten in 14 Tagen`);
  if (!s.quotationGesperrtSeit) offen.push("PUT /quotation ist nicht gesperrt");
  if (s.neuImportiertAlt.length) offen.push(`neue Oberfläche importiert alte Module: ${s.neuImportiertAlt.join(", ")}`);
  if (s.offeneZiele.length) offen.push(`offene Ziele ohne Entscheidung: ${s.offeneZiele.join(", ")}`);
  if (!s.inhaberOkay) offen.push("Okay des Inhabers fehlt");
  return { erlaubt: offen.length === 0, offen };
}
