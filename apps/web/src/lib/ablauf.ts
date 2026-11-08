/**
 * Ablauf der Umzugsakte (Plan 3, Task 6), reine Logik: elf Schritte von der
 * Anfrage bis zur Bewertung, abgeleitet aus gespeicherten Fakten. Kein
 * Datenbankzugriff; die Fakten lädt `services/ablauf-fakten.ts`.
 *
 * Regeln: Teile ohne Wert entfallen samt Trenner. `jetzt` ist der erste nicht
 * erledigte Schritt, der nicht entfällt; bei Stufe Verloren oder Kein Lead
 * gibt es keinen, alle nicht erledigten Schritte entfallen. Schritt 11 entfällt
 * auch allein, wenn die Bewertungsbitte gesperrt ist (Beschwerde, Abmeldung).
 * Anzeige deutsch in Europe/Berlin, Trenner „·“, keine Gedankenstriche.
 */
import { berlinDateString } from "@/lib/berlin-date";
import { fahrzeugEurAus } from "@/lib/einsatz";
import { berlinTag, datumKurz, euroText, tagKurz, uhrzeitKurz, volumenText } from "@/lib/anzeige";
import { KEIN_LEAD_STAGE_CATEGORY } from "@/lib/kontaktart";
import type { NachfassModus, NachfassRegelStand } from "@/lib/nachfass-schalter";
import { ZAHLUNGSART_LABEL } from "@/lib/zahlungsart";
import type { RechnerErgebnis } from "@/services/rechner/client";

export interface AblaufFakten {
  erstelltAm: string;
  quelle: string | null;
  ersteAntwortAm: string | null;
  fotos: number;
  fotoanalyseAm: string | null;
  volumenCbm: number | null;
  zugang: string | null;
  halteverbot: string | null;
  besichtigungAm: string | null;
  leistung: "move" | "kitchen_installation" | "clearance" | "clearance_move";
  kalkulation: {
    version: number;
    status: "entwurf" | "gesperrt";
    selbstkostenCent: number | null;
    margeProzent: number | null;
    geprueftVon: string | null;
    anpassungen: number;
    ersteAnpassung: { key: string; grund: string } | null;
    /** Nummer eines neueren Entwurfs nach der gesperrten Version, sonst null. */
    neuerEntwurf: number | null;
  } | null;
  kv: {
    version: number | null;
    betragCent: number | null;
    istStunden: boolean;
    gesendetAm: string | null;
    gueltigBis: string | null;
    anzahlungCent: number | null;
    geoeffnet: number;
    zuletztGeoeffnet: string | null;
  } | null;
  unterschriftAktiv: boolean;
  nachfass: { modus: NachfassModus; text: string; regeln: NachfassRegelStand[] };
  annahme: { am: string; unterschriftAm: string | null } | null;
  abAm: string | null;
  team: { personen: number; namen: string[] };
  einsatz: {
    fahrzeug: string | null;
    fahrtH: number | null;
    arbeitH: number | null;
    satzFahrtEur: number | null;
    satzArbeitEur: number | null;
    fahrzeugEur: number | null;
  } | null;
  termin: { datum: string; von: string | null; bis: string | null } | null;
  durchgefuehrtAm: string | null;
  rechnung: { am: string; faelligAm: string | null } | null;
  rest: { restCent: number | null; quelle: string };
  letzteZahlungAm: string | null;
  offeneMeldungen: number;
  bewertung: { status: string | null; am: string | null };
  stageCategory: string | null;
}

export interface AblaufSchritt {
  nr: number;
  key:
    | "anfrage"
    | "fotos"
    | "kalkulation"
    | "kv"
    | "annahme"
    | "ab"
    | "einsatz"
    | "termin"
    | "rechnung"
    | "zahlung"
    | "bewertung";
  titel: string;
  wer: "auto" | "du" | "kunde" | "intern" | null;
  zustand: "erledigt" | "jetzt" | "offen" | "entfaellt";
  zeile: string;
  hinweis?: { ton: "gold" | "blau"; text: string };
  sequenz?: { tag: 2 | 7 | 10; text: string; wann: string; art: "auto" | "entwurf" | "gesendet" }[];
  chips?: string[];
}

// ─── Kleine Helfer ────────────────────────────────────────────────────────────

type Teil = string | null | undefined | false;

/** Teile ohne Wert entfallen samt Trenner. */
function teile(...xs: Teil[]): string {
  return xs.filter((x): x is string => typeof x === "string" && x !== "").join(" · ");
}

const KOMMA1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** Tagesnummer eines Berliner Kalendertags (für Abstände in Tagen). */
function tagNummer(tag: string): number {
  const [j, m, t] = tag.split("-").map(Number);
  return Math.round(Date.UTC(j, m - 1, t) / 86_400_000);
}

/** Abstand in Kalendertagen (Berlin) von `jetzt` bis `wert`. */
function tageBis(wert: string, jetzt: Date): number {
  return tagNummer(berlinTag(wert)) - tagNummer(berlinDateString(jetzt));
}

/** „heute“, „morgen“, sonst „Mi 11.11.“. */
function tagRelativ(wert: string, jetzt: Date): string {
  const d = tageBis(wert, jetzt);
  if (d === 0) return "heute";
  if (d === 1) return "morgen";
  return tagKurz(wert);
}

/** Vergangen: Zeitpunkt nicht nach `jetzt`; ein reines Datum erst ab dem Folgetag. */
function istVergangen(wert: string, jetzt: Date): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(wert)) return wert < berlinDateString(jetzt);
  const t = Date.parse(wert);
  return Number.isFinite(t) && t <= jetzt.getTime();
}

function mehrzahl(n: number, eins: string, viele: string): string {
  return `${n} ${n === 1 ? eins : viele}`;
}

/** „7 Min“, „3 Std“, „2 Tagen“ (nach …); negativ oder ungültig → null. */
function dauerText(vonIso: string, bisIso: string): string | null {
  const ms = Date.parse(bisIso) - Date.parse(vonIso);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} Min`;
  const std = Math.floor(min / 60);
  if (std < 24) return `${std} Std`;
  const tage = Math.floor(std / 24);
  return tage === 1 ? "1 Tag" : `${tage} Tagen`;
}

function stundenText(h: number): string {
  return `${KOMMA1.format(h)} h`;
}

function euroAusEur(eur: number): string {
  return euroText(Math.round(eur * 100));
}

// ─── Hilfen für die Fakten (vom Lader genutzt) ────────────────────────────────

const AUFZUG_TEXT: Record<string, string> = {
  keiner: "ohne Aufzug",
  klein: "mit kleinem Aufzug",
  gross: "mit großem Aufzug",
};

/** Zugang beim Beladen: „2. OG ohne Aufzug“, „EG“, „Hochparterre“; nichts bekannt → null. */
export function zugangText(etage: number | null, aufzug: string | null): string | null {
  const aufzugTeil = aufzug ? (AUFZUG_TEXT[aufzug] ?? null) : null;
  if (etage === null) return aufzugTeil;
  if (etage === 0) return aufzug === "keiner" || aufzugTeil === null ? "EG" : `EG ${aufzugTeil}`;
  const etageTeil = etage === 0.5 ? "Hochparterre" : etage < 0 ? "UG" : `${KOMMA1.format(etage)}. OG`;
  return aufzugTeil ? `${etageTeil} ${aufzugTeil}` : etageTeil;
}

/** „Halteverbot beidseitig“, „Halteverbot Beladen“, „Halteverbot Entladen“; keins → null. */
export function halteverbotText(beladen: boolean, entladen: boolean): string | null {
  if (beladen && entladen) return "Halteverbot beidseitig";
  if (beladen) return "Halteverbot Beladen";
  if (entladen) return "Halteverbot Entladen";
  return null;
}

function endlich(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Einsatz aus dem Rechner-Ergebnis: empfohlenes Fahrzeug aus `fahrzeugoptionen`,
 * Fahrtzeit aus `zeiten.fahrtMin`, Arbeitszeit je Person aus `kosten.personenH ÷
 * team.groesse`, Sätze aus den Kostenzeilen `personal.fahrt` und
 * `personal.arbeit`, Fahrzeugbetrag als Summe aller Zeilen
 * `fahrzeug.<id>.<teil>` (Miete, Mehr-km, Kraftstoff, Tagespauschale,
 * Verschleiß). Ohne verwertbare Angabe null.
 */
export function einsatzAus(ergebnis: RechnerErgebnis | null): AblaufFakten["einsatz"] {
  if (!ergebnis) return null;
  const empfehlung = ergebnis.empfehlungOptionId
    ? (ergebnis.fahrzeugoptionen ?? []).find((o) => o.id === ergebnis.empfehlungOptionId)
    : undefined;
  const posten = ergebnis.kosten?.posten ?? [];
  const zeile = (key: string) => posten.find((p) => p.key === key);
  const fahrtMin = endlich(ergebnis.zeiten?.fahrtMin);
  const personenH = endlich(ergebnis.kosten?.personenH);
  const groesse = endlich(ergebnis.team?.groesse);
  const einsatz = {
    fahrzeug: empfehlung?.name?.trim() || null,
    fahrtH: fahrtMin !== null ? fahrtMin / 60 : null,
    arbeitH: personenH !== null && groesse !== null && groesse > 0 ? personenH / groesse : null,
    satzFahrtEur: endlich(zeile("personal.fahrt")?.satz),
    satzArbeitEur: endlich(zeile("personal.arbeit")?.satz),
    fahrzeugEur: fahrzeugEurAus(posten),
  };
  return Object.values(einsatz).every((v) => v === null) ? null : einsatz;
}

// ─── Schritte ─────────────────────────────────────────────────────────────────

type Entwurf = Omit<AblaufSchritt, "nr" | "zustand" | "zeile"> & {
  erledigt: boolean;
  /** Entfällt auch ohne Verloren (gesperrte Bewertungsbitte): nie `jetzt`, nie `offen`. */
  entfaellt?: boolean;
  /** Zeile, wenn der Schritt erledigt ist, sonst die offene Zeile. */
  zeileErledigt: string;
  zeileOffen: string;
};

const NACHFASS_TEXT: Record<2 | 7 | 10, string> = { 2: "Nachfrage", 7: "Erinnerung", 10: "Abschluss" };
const ZAHLUNGSART_CHIPS = (["bank_transfer", "paypal", "cash", "card"] as const).map((k) => ZAHLUNGSART_LABEL[k]);
const BEWERTUNG_ERLEDIGT = new Set(["sent_whatsapp", "sent_sms", "clicked", "review_left"]);
/** Nach Beschwerde (`complaint_routed`) oder Abmeldung (`suppressed`) keine Bewertungsbitte; `failed` darf erneut. */
const BEWERTUNG_GESPERRT: Record<string, string> = {
  complaint_routed: "gesperrt · Beschwerde",
  suppressed: "gesperrt · abgemeldet",
};
const DURCHGEFUEHRT_STUFEN = new Set(["done_unpaid", "paid"]);
const VERLOREN_STUFEN = new Set(["lost", KEIN_LEAD_STAGE_CATEGORY]);

function anfrage(f: AblaufFakten): Entwurf {
  const antwort = f.ersteAntwortAm ? dauerText(f.erstelltAm, f.ersteAntwortAm) : null;
  const zeile = teile(
    `${tagKurz(f.erstelltAm)} ${uhrzeitKurz(f.erstelltAm)}`,
    f.quelle,
    antwort && `erste Antwort nach ${antwort}`
  );
  return { key: "anfrage", titel: "Anfrage eingegangen", wer: "auto", erledigt: true, zeileErledigt: zeile, zeileOffen: zeile };
}

function fotos(f: AblaufFakten, jetzt: Date): Entwurf {
  const besichtigung =
    (f.leistung === "clearance" || f.leistung === "clearance_move") && f.besichtigungAm ? f.besichtigungAm : null;
  // Eine vergangene Besichtigung zählt nur bei Entrümpelung; so hat ein erledigter Schritt immer eine Zeile.
  const besichtigt = besichtigung !== null && istVergangen(besichtigung, jetzt);
  const erledigt = f.fotoanalyseAm !== null || (f.volumenCbm !== null && f.volumenCbm > 0) || besichtigt;
  const angaben = [
    f.fotos > 0 && mehrzahl(f.fotos, "Foto", "Fotos"),
    f.volumenCbm !== null && f.volumenCbm > 0 && volumenText(f.volumenCbm),
    f.zugang,
    f.halteverbot,
  ];
  const zeileErledigt = besichtigung
    ? teile(`Besichtigung ${tagKurz(besichtigung)}`, ...angaben)
    : teile(...angaben) || (f.fotoanalyseAm ? `Fotoanalyse ${tagKurz(f.fotoanalyseAm)}` : "");
  return {
    key: "fotos",
    titel: besichtigung ? "Besichtigung und Infos" : "Fotos und Infos",
    wer: besichtigung ? "du" : "auto",
    erledigt,
    zeileErledigt,
    zeileOffen: besichtigung ? `Besichtigung ${tagKurz(besichtigung)}` : "Fotos und Angaben fehlen noch",
  };
}

function kalkulation(f: AblaufFakten): Entwurf {
  const k = f.kalkulation;
  const selbstkosten = k?.selbstkostenCent != null && `Selbstkosten ${euroText(k.selbstkostenCent)}`;
  let zeileErledigt = "";
  if (k) {
    const geprueft = k.geprueftVon ? `geprüft von ${k.geprueftVon}` : "geprüft";
    const anpassungen = k.anpassungen > 0 ? `, ${mehrzahl(k.anpassungen, "Anpassung", "Anpassungen")}` : "";
    zeileErledigt = teile(
      selbstkosten,
      k.margeProzent !== null && `Marge ${KOMMA1.format(k.margeProzent)} %`,
      `${geprueft}${anpassungen}`,
      k.neuerEntwurf !== null && `Entwurf v${k.neuerEntwurf} in Arbeit`
    );
  }
  return {
    key: "kalkulation",
    titel: "Kalkulation",
    wer: "intern",
    erledigt: k?.status === "gesperrt",
    zeileErledigt,
    zeileOffen: k ? teile(`Entwurf v${k.version}`, selbstkosten) : "Noch keine Kalkulation",
  };
}

function kvKopf(kv: NonNullable<AblaufFakten["kv"]>): Teil[] {
  if (kv.istStunden) return ["Stunden-KV"];
  return [kv.version !== null && `v${kv.version}`, kv.betragCent !== null && euroText(kv.betragCent)];
}

function kostenvoranschlag(f: AblaufFakten): Entwurf {
  const kv = f.kv;
  const kopf = kv ? kvKopf(kv) : [];
  let zeileOffen = "Noch kein KV";
  if (kv) {
    zeileOffen = kv.gesendetAm
      ? teile(...kopf, `gesendet ${tagKurz(kv.gesendetAm)}`, kv.gueltigBis && `gültig bis ${datumKurz(kv.gueltigBis)}`)
      : teile(...kopf, "noch nicht gesendet");
  }
  return {
    key: "kv",
    titel: "Kostenvoranschlag",
    wer: "du",
    erledigt: f.annahme !== null,
    zeileErledigt: teile(...kopf, f.annahme && `angenommen ${tagKurz(f.annahme.am)}`),
    zeileOffen,
  };
}

/** Hinweis und Sequenz für Schritt 4 im Zustand `jetzt` mit gesendetem KV ohne Annahme. */
function kvZusatz(f: AblaufFakten, jetzt: Date): Pick<AblaufSchritt, "hinweis" | "sequenz"> {
  const kv = f.kv;
  if (!kv?.gesendetAm || f.annahme) return {};
  const saetze = [kv.geoeffnet > 0 ? `${kv.geoeffnet}× geöffnet, noch nicht angenommen.` : "Noch nicht geöffnet."];
  const naechste = f.nachfass.regeln.find((r) => !r.gesendetAm && r.geplantAm);
  if (naechste?.geplantAm && (f.nachfass.modus === "sendet" || f.nachfass.modus === "entwurf")) {
    const wann = `${tagRelativ(naechste.geplantAm, jetzt)} ${uhrzeitKurz(naechste.geplantAm)}`;
    saetze.push(
      f.nachfass.modus === "sendet"
        ? `Nachfass Tag ${naechste.tag} geht ${wann} automatisch raus.`
        : `Nachfass Tag ${naechste.tag} kommt ${wann} als Entwurf zur Freigabe.`
    );
  }
  const sequenz = f.nachfass.regeln.flatMap((r): NonNullable<AblaufSchritt["sequenz"]> => {
    if (r.gesendetAm) return [{ tag: r.tag, text: NACHFASS_TEXT[r.tag], wann: `gesendet ${tagKurz(r.gesendetAm)}`, art: "gesendet" }];
    if (r.geplantAm) return [{ tag: r.tag, text: NACHFASS_TEXT[r.tag], wann: tagRelativ(r.geplantAm, jetzt), art: r.art }];
    return [];
  });
  return { hinweis: { ton: "gold", text: saetze.join(" ") }, ...(sequenz.length > 0 ? { sequenz } : {}) };
}

function annahme(f: AblaufFakten): Entwurf {
  const a = f.annahme;
  const mitUnterschrift = f.unterschriftAktiv || Boolean(a?.unterschriftAm);
  return {
    key: "annahme",
    titel: mitUnterschrift ? "Annahme und Unterschrift" : "Annahme",
    wer: "kunde",
    erledigt: a !== null && (!f.unterschriftAktiv || a.unterschriftAm !== null),
    zeileErledigt: a ? teile(`angenommen ${tagKurz(a.am)}`, a.unterschriftAm && `unterschrieben ${tagKurz(a.unterschriftAm)}`) : "",
    zeileOffen: teile(
      "im Status-Link",
      f.kv?.anzahlungCent != null && f.kv.anzahlungCent > 0 && `Anzahlung ${euroText(f.kv.anzahlungCent)}`,
      f.unterschriftAktiv && "Unterschrift"
    ),
  };
}

function auftragsbestaetigung(f: AblaufFakten): Entwurf {
  return {
    key: "ab",
    titel: "Auftragsbestätigung",
    wer: "du",
    erledigt: f.abAm !== null,
    zeileErledigt: f.abAm ? `erstellt ${tagKurz(f.abAm)}` : "",
    zeileOffen: "aus der angenommenen Fassung · ein Klick",
  };
}

function einsatz(f: AblaufFakten): Entwurf {
  const e = f.einsatz;
  const mitSatz = (wort: string, h: number | null, satz: number | null) =>
    h !== null && `${wort} ${stundenText(h)}${satz !== null ? ` × ${euroAusEur(satz)}` : ""}`;
  const fahrzeug = e
    ? e.fahrzeug && e.fahrzeugEur !== null
      ? `${e.fahrzeug} ${euroAusEur(e.fahrzeugEur)}`
      : e.fahrzeug || (e.fahrzeugEur !== null && `Fahrzeug ${euroAusEur(e.fahrzeugEur)}`)
    : null;
  const zeile = teile(
    f.team.personen > 0 && mehrzahl(f.team.personen, "Person", "Personen"),
    e && mitSatz("Fahrt", e.fahrtH, e.satzFahrtEur),
    e && mitSatz("Arbeit", e.arbeitH, e.satzArbeitEur),
    fahrzeug
  );
  return {
    key: "einsatz",
    titel: "Einsatz planen",
    wer: "intern",
    erledigt: f.team.personen > 0,
    zeileErledigt: zeile,
    zeileOffen: zeile || "Team und Fahrzeug fehlen",
  };
}

export const TERMIN_WORT: Record<AblaufFakten["leistung"], string> = {
  move: "Umzug",
  clearance_move: "Umzug",
  clearance: "Termin",
  kitchen_installation: "Montage",
};

export const BEGINN_WORT: Record<AblaufFakten["leistung"], string> = {
  move: "Beladen",
  clearance_move: "Beladen",
  clearance: "Beginn",
  kitchen_installation: "Beginn",
};

/** „heute“, „morgen“, „gestern“, „in 16 Tagen“, „vor 3 Tagen“ (Berliner Kalendertage). */
export function inTagen(datum: string, jetzt: Date): string {
  const d = tageBis(datum, jetzt);
  if (d === 0) return "heute";
  if (d === 1) return "morgen";
  if (d === -1) return "gestern";
  return d > 0 ? `in ${d} Tagen` : `vor ${-d} Tagen`;
}

function termin(f: AblaufFakten, jetzt: Date): Entwurf {
  const t = f.termin;
  let zeileOffen = "noch kein Termin";
  if (t) {
    zeileOffen =
      t.von || t.bis ? teile(t.von && `${t.von} ${BEGINN_WORT[f.leistung]}`, t.bis && `ca. ${t.bis} fertig`) : inTagen(t.datum, jetzt);
  }
  return {
    key: "termin",
    titel: t ? `${TERMIN_WORT[f.leistung]} ${tagKurz(t.datum)}` : TERMIN_WORT[f.leistung],
    wer: null,
    erledigt: f.durchgefuehrtAm !== null || DURCHGEFUEHRT_STUFEN.has(f.stageCategory ?? ""),
    zeileErledigt: f.durchgefuehrtAm ? `durchgeführt ${tagKurz(f.durchgefuehrtAm)}` : "durchgeführt",
    zeileOffen,
  };
}

function rechnung(f: AblaufFakten): Entwurf {
  const r = f.rechnung;
  return {
    key: "rechnung",
    titel: "Rechnung",
    wer: "du",
    erledigt: r !== null,
    zeileErledigt: r ? teile(`erstellt ${tagKurz(r.am)}`, r.faelligAm && `fällig ${datumKurz(r.faelligAm)}`) : "",
    zeileOffen: f.rest.restCent !== null ? `Restbetrag ${euroText(f.rest.restCent)}` : "noch keine Rechnung",
  };
}

/**
 * Hinweis zu offenen Meldungen „Ich habe bezahlt“: genau eine lässt sich mit
 * einem Klick bestätigen (die Akte zeigt dort „Bestätigen“), bei mehreren
 * nennt der Hinweis die Zahl und die Akte bietet „Zahlung erfassen“ an.
 */
function meldungsHinweis(anzahl: number): AblaufSchritt["hinweis"] {
  const text = anzahl === 1 ? "Kunde meldet „bezahlt“. Ein Klick bestätigt." : `Kunde meldet „bezahlt“ (${anzahl} Meldungen).`;
  return { ton: "gold", text };
}

function zahlung(f: AblaufFakten): Entwurf {
  // Ein Stunden-KV hat nie Rest 0: dort zählt die Stufe Bezahlt.
  const erledigt = f.rest.restCent === 0 || f.stageCategory === "paid";
  return {
    key: "zahlung",
    titel: "Zahlung",
    wer: "du",
    erledigt,
    zeileErledigt: f.letzteZahlungAm ? `bezahlt ${tagKurz(f.letzteZahlungAm)}` : "bezahlt",
    zeileOffen: "Kunde meldet „bezahlt“ im Link, du bestätigst",
    chips: [...ZAHLUNGSART_CHIPS],
    ...(!erledigt && f.offeneMeldungen > 0 ? { hinweis: meldungsHinweis(f.offeneMeldungen) } : {}),
  };
}

/** Bewertungsanfrage gesendet (Schritt 11 erledigt); gemeinsam mit den Dock-Regeln der Akte. */
export function bewertungAngefragt(f: Pick<AblaufFakten, "bewertung">): boolean {
  return f.bewertung.status !== null && BEWERTUNG_ERLEDIGT.has(f.bewertung.status);
}

/** Bewertungsbitte gesperrt (Beschwerde oder Abmeldung); gemeinsam mit den Dock-Regeln der Akte. */
export function bewertungGesperrt(f: Pick<AblaufFakten, "bewertung">): boolean {
  return f.bewertung.status !== null && f.bewertung.status in BEWERTUNG_GESPERRT;
}

/** Gesperrt (Beschwerde, Abmeldung) entfällt der Schritt: kein `jetzt`, kein Knopf in der Akte. */
function bewertung(f: AblaufFakten): Entwurf {
  const sperre = bewertungGesperrt(f) ? BEWERTUNG_GESPERRT[f.bewertung.status!] : null;
  return {
    key: "bewertung",
    titel: "Bewertung anfragen",
    wer: "du",
    erledigt: bewertungAngefragt(f),
    entfaellt: sperre !== null,
    zeileErledigt: f.bewertung.am ? `angefragt ${tagKurz(f.bewertung.am)}` : "angefragt",
    zeileOffen: sperre ?? "von Hand · Google-Link mit Vorlage",
  };
}

/**
 * Die elf Schritte mit Zustand und Zeile. `position` = Nummer des Schritts
 * `jetzt`, sonst die Zahl der erledigten (Anzeige „{position} von 11“); ein
 * Schritt, der entfällt, wird nie `jetzt` und zählt nicht als erledigt.
 * `jetzt` (Zeitpunkt) nur für relative Angaben („morgen“, „in 16 Tagen“).
 */
export function berechneAblauf(f: AblaufFakten, jetzt: Date): { schritte: AblaufSchritt[]; position: number } {
  const entwuerfe: Entwurf[] = [
    anfrage(f),
    fotos(f, jetzt),
    kalkulation(f),
    kostenvoranschlag(f),
    annahme(f),
    auftragsbestaetigung(f),
    einsatz(f),
    termin(f, jetzt),
    rechnung(f),
    zahlung(f),
    bewertung(f),
  ];
  const verloren = VERLOREN_STUFEN.has(f.stageCategory ?? "");
  const jetztIndex = verloren ? -1 : entwuerfe.findIndex((e) => !e.erledigt && !e.entfaellt);

  const schritte = entwuerfe.map((e, i): AblaufSchritt => {
    const { erledigt, entfaellt, zeileErledigt, zeileOffen, ...rest } = e;
    const zustand: AblaufSchritt["zustand"] = erledigt
      ? "erledigt"
      : verloren || entfaellt
        ? "entfaellt"
        : i === jetztIndex
          ? "jetzt"
          : "offen";
    const schritt: AblaufSchritt = { nr: i + 1, ...rest, zustand, zeile: erledigt ? zeileErledigt : zeileOffen };
    if (schritt.key === "kv" && zustand === "jetzt") Object.assign(schritt, kvZusatz(f, jetzt));
    return schritt;
  });

  const erledigte = schritte.filter((s) => s.zustand === "erledigt").length;
  return { schritte, position: jetztIndex >= 0 ? jetztIndex + 1 : erledigte };
}
