/**
 * Gespräch der Umzugsakte (Plan 3, Task 7), reine Logik: Einträge aus allen
 * Kanälen zu einem Verlauf zusammenführen, Systemzeilen aus den Fakten des
 * Deals bauen, Sendefähigkeit und Vorauswahl eines Gesprächs bestimmen.
 * Kein Datenbankzugriff; die Daten lädt `services/gespraech.ts`.
 *
 * Zeit und Datum in Europe/Berlin, Anzeige deutsch („Di 03.11.“, „heute 08:12“,
 * „2.480 €“, „38 m³“). Keine Gedankenstriche, Trenner „·“.
 */
import { euroText, tagKurz, volumenText, zeitpunktKurz } from "@/lib/anzeige";
import { zahlungsartText } from "@/lib/zahlungsart";

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
  | {
      art: "anruf";
      id: string;
      zeit: string;
      dauerSek: number | null;
      zusammenfassung: string | null;
      /** `phone_calls.line_label`, etwa „Festnetz“ oder „Kottke Mobil“. */
      leitung: string | null;
      /** `phone_calls.answered_by`. */
      angenommenVon: string | null;
      /** Nummer des Anrufers: E.164, sonst wie übermittelt. */
      nummer: string | null;
      /** Es gibt ein Transkript; geladen wird es erst beim Öffnen (`GET /phone-calls/[id]`). */
      hatTranskript: boolean;
    }
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
  /** `id` = payments.id (stabile Zeilen-ID). */
  zahlungen: { id: string; am: string; betragCent: number; art: string | null }[];
  /** `id` = activity_events.id (stabile Zeilen-ID). */
  kundenereignisse: { id: string; am: string; typ: string; payload: unknown }[];
}

// ─── Anzeige ──────────────────────────────────────────────────────────────────

// Gemeinsame Helfer liegen in `lib/anzeige.ts`; hier weiter exportiert.
export { euroText, tagKurz, volumenText, zeitpunktKurz };

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

function kundenzeile(e: SystemFakten["kundenereignisse"][number]): Systemzeile | null {
  const id = `sys:kunde:${e.id}`;
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

  for (const z of f.zahlungen) {
    // Ohne Angabe entfällt der Teil (zahlungsartText gäbe „keine Angabe“).
    const art = z.art && z.art.trim() !== "" ? zahlungsartText(z.art) : null;
    out.push(zeile(`sys:zahlung:${z.id}`, z.am, ["Zahlung erfasst", euroText(z.betragCent), ...(art ? [art] : [])], null));
  }

  for (const e of f.kundenereignisse) {
    const z = kundenzeile(e);
    if (z) out.push(z);
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
