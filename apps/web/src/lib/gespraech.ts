/**
 * Gespräch der Umzugsakte (Plan 3, Task 7), reine Logik: Einträge aus allen
 * Kanälen zu einem Verlauf zusammenführen, Systemzeilen aus den Fakten des
 * Deals bauen, Sendefähigkeit und Vorauswahl eines Gesprächs bestimmen.
 * Kein Datenbankzugriff; die Daten lädt `services/gespraech.ts`.
 *
 * Zeit und Datum in Europe/Berlin, Anzeige deutsch („Di 03.11.“, „heute 08:12“,
 * „2.480 €“, „38 m³“). Keine Gedankenstriche, Trenner „·“.
 */
import { berlinDateString } from "@/lib/berlin-date";

export type GespraechKanalArt = "whatsapp" | "email" | "sms";

export type GespraechEintrag =
  | {
      art: "nachricht";
      id: string;
      zeit: string;
      richtung: "inbound" | "outbound";
      kanal: GespraechKanalArt;
      gespraechId: string;
      /** Kontaktname bei eingehend, `null` bei ausgehend (es gibt keine Autorenspalte). */
      von: string | null;
      text: string;
      status: string;
      anhaenge: { id: string; name: string; mime: string }[];
    }
  | { art: "anruf"; id: string; zeit: string; dauerSek: number | null; zusammenfassung: string | null }
  | {
      art: "system";
      id: string;
      zeit: string;
      /** Ganze Zeile. */
      text: string;
      /** Der fett gesetzte Teil, steht wörtlich am Ende von `text`; null = nichts fett. */
      betont: string | null;
    };

type Nachricht = Extract<GespraechEintrag, { art: "nachricht" }>;
type Anruf = Extract<GespraechEintrag, { art: "anruf" }>;
type Systemzeile = Extract<GespraechEintrag, { art: "system" }>;

export interface SystemFakten {
  erstelltAm: string;
  firma: string | null;
  quelle: string | null;
  fotoanalyse: { am: string; teile: number; volumenCbm: number | null } | null;
  sperrungen: {
    am: string;
    von: string | null;
    version: number;
    betragCent: number | null;
    ersteAnpassung: { key: string; grund: string } | null;
    anpassungen: number;
  }[];
  versand: { am: string; version: number; kanal: string }[];
  geoeffnet: { anzahl: number; zuletzt: string } | null;
  zahlungen: { am: string; betragCent: number; art: string | null }[];
  kundenereignisse: { am: string; typ: string; payload: unknown }[];
}

// ─── Anzeige ──────────────────────────────────────────────────────────────────

const WOCHENTAG = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;

/** Kalendertag in Berlin; ein reines Datum („2026-11-20“) bleibt, wie es ist. */
function berlinTag(wert: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(wert)) return wert;
  return berlinDateString(new Date(wert));
}

/** „Fr 20.11.“ */
export function tagKurz(wert: string): string {
  const tag = berlinTag(wert);
  const [jahr, monat, t] = tag.split("-");
  const wochentag = WOCHENTAG[new Date(Date.UTC(Number(jahr), Number(monat) - 1, Number(t))).getUTCDay()];
  return `${wochentag} ${t}.${monat}.`;
}

const UHRZEIT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** „heute 08:12“ am selben Berliner Tag, sonst „Di 03.11.“. */
export function zeitpunktKurz(wert: string, jetzt: Date): string {
  if (berlinTag(wert) === berlinDateString(jetzt)) return `heute ${UHRZEIT.format(new Date(wert))}`;
  return tagKurz(wert);
}

/** „2.480 €“, „1.990,50 €“ (ganze Beträge ohne Nachkommastellen). */
export function euroText(cent: number): string {
  const stellen = Math.round(cent) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: stellen,
    maximumFractionDigits: stellen,
  })
    .format(cent / 100)
    .replace(/ /g, " ");
}

const VOLUMEN = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** „38 m³“, „12,5 m³“. */
export function volumenText(cbm: number): string {
  return `${VOLUMEN.format(cbm)} m³`;
}

/** Schlüssel einer Übersteuerung (Kalkulation) → Anzeige. Eigene Schlüssel bleiben, wie sie sind. */
const ANPASSUNG_LABEL: Record<string, string> = {
  volumen: "Volumen",
  "beladen.etage": "Etage Beladen",
  "beladen.aufzug": "Aufzug Beladen",
  "beladen.tragweg": "Tragweg Beladen",
  "entladen.etage": "Etage Entladen",
  "entladen.aufzug": "Aufzug Entladen",
  "entladen.tragweg": "Tragweg Entladen",
  "halteverbot.beladen": "Halteverbot Beladen",
  "halteverbot.entladen": "Halteverbot Entladen",
  kartons: "Kartons",
  team: "Team",
  termin: "Termin",
  marge: "Marge",
  arbeit: "Satz Arbeit",
  fahrt: "Satz Fahrt",
  "personal.arbeit": "Arbeit",
  "personal.fahrt": "Fahrt",
  personal: "Personal",
  fahrzeug: "Fahrzeug",
  halteverbot: "Halteverbot",
  gemeinkosten: "Gemeinkosten",
};

export function anpassungLabel(key: string): string {
  return ANPASSUNG_LABEL[key] ?? key;
}

const VERSAND_LABEL: Record<string, string> = { whatsapp: "WhatsApp", email: "E-Mail", sms: "SMS" };

/**
 * Zahlungsart → Anzeige. Gleiche Aufzählung wie Entscheidung 4; Altwerte und
 * Unbekanntes erscheinen als Rohwert.
 * TODO(Task 2): durch `zahlungsartText` aus `lib/zahlungsart.ts` ersetzen, sobald
 * es auf dem Zweig liegt (hier nur, um die Datei von Task 2 nicht anzufassen).
 */
const ZAHLUNGSART_ANZEIGE: Record<string, string> = {
  bank_transfer: "Überweisung",
  paypal: "PayPal",
  cash: "Bar",
  card: "Karte",
  other: "Sonstiges",
};

// ─── Zusammenführen ───────────────────────────────────────────────────────────

const RANG: Record<GespraechEintrag["art"], number> = { system: 0, anruf: 1, nachricht: 2 };

function zeitwert(zeit: string): number {
  const t = Date.parse(zeit);
  return Number.isNaN(t) ? 0 : t;
}

/** Aufsteigend nach Zeit; bei gleicher Zeit Systemzeile vor Anruf vor Nachricht. */
export function gespraechZusammenfuehren(teile: {
  nachrichten: Nachricht[];
  anrufe: Anruf[];
  system: Systemzeile[];
}): GespraechEintrag[] {
  const alle: GespraechEintrag[] = [...teile.system, ...teile.anrufe, ...teile.nachrichten];
  return alle
    .map((e, i) => ({ e, i, t: zeitwert(e.zeit) }))
    .sort((a, b) => a.t - b.t || RANG[a.e.art] - RANG[b.e.art] || a.i - b.i)
    .map((x) => x.e);
}

// ─── Systemzeilen ─────────────────────────────────────────────────────────────

function zeile(id: string, zeit: string, teile: string[], betont: string | null): Systemzeile {
  return { art: "system", id, zeit, text: [...teile, ...(betont ? [betont] : [])].join(" · "), betont };
}

function zahlAus(payload: unknown, feld: string): number | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>)[feld];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function textAus(payload: unknown, feld: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>)[feld];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function kundenzeile(e: SystemFakten["kundenereignisse"][number], i: number): Systemzeile | null {
  const id = `sys:kunde:${i}`;
  switch (e.typ) {
    case "customer.kva_confirmed":
      return zeile(id, e.am, ["Kunde hat angenommen"], null);
    case "customer.kva_signed":
      return zeile(id, e.am, ["Kunde hat unterschrieben"], null);
    case "customer.date_selected": {
      const datum = textAus(e.payload, "selectedDate");
      const tag = datum && /^\d{4}-\d{2}-\d{2}/.test(datum) ? tagKurz(datum.slice(0, 10)) : null;
      return zeile(id, e.am, ["Kunde hat einen Termin gewählt", ...(tag ? [tag] : [])], null);
    }
    case "customer.marked_paid": {
      const cent = zahlAus(e.payload, "amountCents");
      return zeile(id, e.am, ["Kunde meldet bezahlt", ...(cent !== null && cent > 0 ? [euroText(cent)] : [])], null);
    }
    default:
      return null;
  }
}

/**
 * Systemzeilen für das, was das CRM und der Kunde getan haben. `betont` ist der
 * fett gesetzte Teil und steht wörtlich am Ende von `text`. `jetzt` nur für
 * „heute“ (Tests).
 */
export function systemzeilenAus(f: SystemFakten, jetzt: Date = new Date()): Systemzeile[] {
  const out: Systemzeile[] = [];

  out.push(
    zeile(
      "sys:lead",
      f.erstelltAm,
      ["Lead angelegt", ...(f.firma ? [f.firma] : []), ...(f.quelle ? [`Quelle ${f.quelle}`] : [])],
      "Neue Anfrage"
    )
  );

  if (f.fotoanalyse) {
    const { am, teile, volumenCbm } = f.fotoanalyse;
    out.push(
      zeile(
        "sys:fotoanalyse",
        am,
        ["Fotoanalyse fertig", `Möbelliste ${teile} ${teile === 1 ? "Teil" : "Teile"}`],
        volumenCbm !== null && volumenCbm > 0 ? volumenText(volumenCbm) : null
      )
    );
  }

  for (const s of f.sperrungen) {
    const teile = [s.von ? `Kalkulation geprüft von ${s.von}` : "Kalkulation geprüft"];
    if (s.ersteAnpassung) {
      teile.push(`${anpassungLabel(s.ersteAnpassung.key)}: ${s.ersteAnpassung.grund}`);
      if (s.anpassungen > 1) teile.push(`+${s.anpassungen - 1} weitere`);
    }
    const betont = [`KV v${s.version}`, ...(s.betragCent !== null ? [euroText(s.betragCent)] : [])].join(" · ");
    out.push(zeile(`sys:sperrung:${s.version}`, s.am, teile, betont));
  }

  for (const v of f.versand) {
    const kanal = VERSAND_LABEL[v.kanal] ?? v.kanal;
    out.push(zeile(`sys:versand:${v.version}`, v.am, [`KV v${v.version} gesendet`, ...(kanal ? [kanal] : [])], null));
  }

  if (f.geoeffnet && f.geoeffnet.anzahl > 0) {
    const { anzahl, zuletzt } = f.geoeffnet;
    out.push(
      zeile("sys:geoeffnet", zuletzt, ["Kunde hat den Link geöffnet", `${anzahl}×`, `zuletzt ${zeitpunktKurz(zuletzt, jetzt)}`], null)
    );
  }

  f.zahlungen.forEach((z, i) => {
    const art = z.art ? (ZAHLUNGSART_ANZEIGE[z.art] ?? z.art) : null;
    out.push(zeile(`sys:zahlung:${i}`, z.am, ["Zahlung erfasst", euroText(z.betragCent), ...(art ? [art] : [])], null));
  });

  let k = 0;
  for (const e of f.kundenereignisse) {
    const z = kundenzeile(e, k);
    if (z) {
      out.push(z);
      k++;
    }
  }

  return out;
}

// ─── Kanäle ───────────────────────────────────────────────────────────────────

/**
 * Sendefähig nur, wenn das Gespräch direkt am Deal hängt (Entscheidung 10) und
 * der Kanal aus dem CRM senden kann: WABA, Baileys `inhouse` oder E-Mail
 * (dieselben Wege wie `sendeAntwort` in `services/inbox-senden.ts`).
 */
export function kannSendenAus(g: {
  direkt: boolean;
  kanal: GespraechKanalArt;
  waPhoneNumberId: string | null;
  bridge: string | null;
}): boolean {
  if (!g.direkt) return false;
  if (g.kanal === "email") return true;
  if (g.kanal === "whatsapp") return Boolean(g.waPhoneNumberId) || g.bridge === "inhouse";
  return false;
}

/**
 * Vorauswahl des Eingabefelds: das sendefähige (also direkt verknüpfte)
 * Gespräch der letzten eingehenden Nachricht. Ohne eingehende Nachricht dort:
 * das sendefähige Gespräch mit der letzten Nachricht, sonst das erste
 * sendefähige. Kein sendefähiges Gespräch → null.
 */
export function vorauswahlAus(
  kanaele: readonly { gespraechId: string; kannSenden: boolean }[],
  nachrichten: readonly Pick<Nachricht, "gespraechId" | "richtung" | "zeit">[]
): string | null {
  const sendbar = new Set(kanaele.filter((k) => k.kannSenden).map((k) => k.gespraechId));
  if (sendbar.size === 0) return null;
  const letzte = (nurEingehend: boolean) => {
    let treffer: { id: string; t: number } | null = null;
    for (const n of nachrichten) {
      if (!sendbar.has(n.gespraechId) || (nurEingehend && n.richtung !== "inbound")) continue;
      const t = zeitwert(n.zeit);
      if (!treffer || t >= treffer.t) treffer = { id: n.gespraechId, t };
    }
    return treffer?.id ?? null;
  };
  return letzte(true) ?? letzte(false) ?? kanaele.find((k) => k.kannSenden)!.gespraechId;
}
