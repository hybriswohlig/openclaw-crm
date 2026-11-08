/**
 * Leads-Board und Liste (Plan 7, Task A): reine Bausteine zwischen der
 * Datenbankzeile und der Antwort. Karte bauen, Spalte zuordnen, filtern,
 * Chips zählen, sortieren, Spalten mit Anzahl und Summe bilden, Seiten
 * schneiden. Ohne Datenbankzugriff; geladen wird in `services/leads-board.ts`.
 *
 * Die Chip-Definitionen (`chipsAus`) liegen hier, damit die spätere
 * Startseite „Heute“ dieselben nimmt (Entscheidung 1 und 6).
 *
 * Regeln aus anderen Teilen, unverändert übernommen:
 * - Kategorie einer Stufe immer über `stufenKategorie` (Titel als Rückfall).
 * - „KV gesendet“ wie die Akte (`services/ablauf-fakten.ts`): `sent_at` der
 *   neuesten gesperrten Version, sonst der am Angebot verknüpften Version,
 *   sonst (nur Angebot ohne Versionsbezug) das erste KV-Dokument.
 * - Betrag über `leadWert` (mit `kalkCent`), Rest über `offenAus`, offene
 *   Zahlungsmeldungen über `offeneMeldungen`, Leistung über `portalLeistung`.
 */
import { portalLeistung } from "@openclaw-crm/customer-portal-core";
import { mitAlt } from "@/lib/handy-links";
import type { AblaufFakten } from "@/lib/ablauf";
import { artAus, kalkulationLinks, kuerzelAus, ortAus } from "@/lib/akte";
import { datumKurz, euroText, tagKurz, uhrzeitKurz } from "@/lib/anzeige";
import { berlinDateString } from "@/lib/berlin-date";
import { plausiblerCent } from "@/lib/lagekarte/typen";
import {
  BOARD_KATEGORIEN,
  BOARD_SEITE,
  EINGEKLAPPTE_KATEGORIEN,
  KV_UNGESEHEN_TAGE,
  OHNE_STUFE,
  SPALTEN_SATZ,
  SUCHE_MIN_ZEICHEN,
  betragAnzeige,
  spaltenTon,
  vorText,
  wartetPille,
  wasZeile,
  wocheGrenzen,
  type LeadFirma,
  type LeadKarte,
  type LeadKategorie,
  type LeadQuelle,
  type LeadSpalte,
  type LeadsChipKey,
  type LeadsChips,
  type LeadsFilter,
  type ListenSortierung,
} from "@/lib/leads-board";
import {
  berlinTag,
  offenAus,
  rechnungZaehlt,
  type BarBeiTeam,
  type OffenErgebnis,
  type RechnungKurz,
  type ZahlungQuelle,
} from "@/lib/geld";
import { aktiveZielStufe } from "@/lib/stufen-ziel";
import { offeneMeldungen } from "@/lib/zahlungsmeldungen";
import { stufenKategorie } from "@/services/lagekarte/status";
import { leadWert, type AngebotRoh } from "@/services/lagekarte/wert";

// ─── Eingaben ────────────────────────────────────────────────────────────────

/** Eine geparste Datenbankzeile je Deal (alle Zeiten ISO, Tage YYYY-MM-DD). */
export interface LeadRoh {
  id: string;
  erstelltAm: string;
  /** `deal_numbers.deal_number`. */
  nummer: string | null;
  name: string | null;
  /** `record_values.text_value` des Attributs `stage` (Status-ID), roh. */
  stufeId: string | null;
  /** Attribut `move_date`. */
  umzugAm: string | null;
  /** Ende eines mehrtägigen Umzugs (`move_end` u. ä.), sonst null. */
  umzugEnde?: string | null;
  /** `customer_date_selections.selected_date`. */
  terminAuswahl: string | null;
  /** Adresse (Objekt `LocationValue` oder Freitext). */
  von: unknown;
  nach: unknown;
  firmaId: string | null;
  /** `select_options.id` des Attributs `source_channel`. */
  quelleId: string | null;
  /** Attribut `value` (`{amount, currencyCode}`; eine reine Zahl gilt als Betrag in Euro). */
  wert: unknown;
  /** Attribut `besichtigung_am`: Tag („2026-11-07“) oder Zeitpunkt (ISO). */
  besichtigungAm: string | null;
  /** Gespeicherter Verlustgrund (Options-ID). */
  verlustGrund: string | null;
  /** Zeile aus `deal_workflow_state`; null ohne Zeile. */
  wartet: { auf: "uns" | "kunde" | "niemand"; seit: string | null; grund: string | null } | null;
  /** `quotations` des Deals (höchstens eine); null ohne Angebot. */
  angebot: {
    festpreisEuro: string | null;
    istStunden: boolean;
    serviceType: string | null;
    mitEntruempelung: boolean;
    gueltigBis: string | null;
    selectedPackageOptionId: string | null;
    /** `calculation_version_id IS NULL`. */
    ohneVersion: boolean;
    /** `sent_at` der am Angebot verknüpften Version. */
    versionGesendetAm: string | null;
    /** Positionen des Stunden-KV (nur bei `istStunden` geladen). */
    positionen: { quantity: number; unitRateEuro: string }[];
  } | null;
  /** Paketoptionen im Portal. */
  optionen: AngebotRoh["optionen"];
  /** Aktive Annahme (`superseded_at IS NULL`). */
  annahme: { cent: number | null; am: string | null } | null;
  /** `max(customer_status_links.last_viewed_at)`. */
  portalZuletztGeoeffnet: string | null;
  /** Neueste gesperrte Version und neuester Entwurf, nur einzelne Felder (nie `rechner_result` ganz). */
  versionen: {
    gesperrt: { version: number; cent: number | null; gesendetAm: string | null; teamSoll: number | null } | null;
    entwurf: { cent: number | null; teamSoll: number | null } | null;
  };
  /** `deal_calculations.result`: nur Festpreis (Euro) und Teamgröße. */
  rechner: { festpreis: string | null; teamSoll: number | null } | null;
  /** Aktive Rechnung (`entwurf` oder `gestellt`); null ohne Zeile. */
  rechnung: RechnungKurz | null;
  /** `deal_workflow_state.bezahlt_am`, ISO. */
  bezahltAm: string | null;
  /** `deal_workflow_state.stage_entered_at`, ISO. Für den Tag „Durchgeführt“ ohne Termin. */
  stufeBetretenAm: string | null;
  /** Bar beim Team, noch nicht bei den Inhabern. */
  barBeiTeam: BarBeiTeam[];
  /** `quotations.deposit_required_cents`. */
  anzahlungCent: number | null;
  /** `max(move_time_entries.finished_at)`, ISO. */
  fertigAm: string | null;
  /** Erstes KV-Dokument, neueste Rechnung, neueste Auftragsbestätigung (`deal_documents.uploaded_at`). */
  dokumente: { kvErstesAm: string | null; rechnungAm: string | null; abAm: string | null };
  zahlungen: {
    amount: string;
    taxTreatment: string | null;
    date: string | null;
    id?: string;
    quelle?: ZahlungQuelle | null;
    stornoVonPaymentId?: string | null;
  }[];
  /** Namen des zugeteilten Teams in Zuteilungsreihenfolge. */
  team: string[];
  /** Summe `analysiert` aus `agent_events` `fotos_erledigt` (wie die Akte). */
  fotos: number;
  /** Telefonnummern der Kontakte aller Gespräche des Deals (roh). */
  telefone: string[];
  /** `activity_events` der drei Zahlungsmeldungs-Typen. */
  meldungsEreignisse: { id: string; eventType: string; payload: unknown; createdAt: string }[];
  /** `max(inbox_conversations.last_message_at)` ohne Spam. */
  letzteNachrichtAm: string | null;
}

export interface LeadEintrag {
  karte: LeadKarte;
  chips: LeadsChipKey[];
  /** Name, Orte und Deal-Nummer, klein geschrieben. */
  suchtext: string;
  /** Telefonnummern nur aus Ziffern. */
  telefonZiffern: string[];
}

export interface StufeZeile {
  id: string;
  label: string;
  kategorie: LeadKategorie | null;
  reihenfolge: number;
  aktiv: boolean;
}

/** Stufen-Zeile aus der Datenbank (alle Stufen des Attributs `stage`, auch inaktive). */
export function stufeZeileAus(s: {
  id: string;
  title: string;
  stage_category: string | null;
  sort_order: unknown;
  is_active: unknown;
}): StufeZeile {
  const n = Number(s.sort_order);
  return {
    id: s.id,
    label: s.title,
    kategorie: stufenKategorie({ titel: s.title, kategorie: s.stage_category }),
    reihenfolge: Number.isFinite(n) ? n : 0,
    aktiv: s.is_active === true || s.is_active === "t" || s.is_active === "true",
  };
}

// ─── Spalten ─────────────────────────────────────────────────────────────────

const BOARD_SET: ReadonlySet<string> = new Set(BOARD_KATEGORIEN);
const EINGEKLAPPT_SET: ReadonlySet<string> = new Set(EINGEKLAPPTE_KATEGORIEN);

function istSpaltenStufe(s: StufeZeile): boolean {
  return s.aktiv && s.kategorie !== null && (BOARD_SET.has(s.kategorie) || EINGEKLAPPT_SET.has(s.kategorie));
}

function nachReihenfolge(a: StufeZeile, b: StufeZeile): number {
  return a.reihenfolge - b.reihenfolge || a.label.localeCompare(b.label, "de");
}

/**
 * Spalte eines Deals (Entscheidung 2): die eigene Stufe, wenn sie aktiv ist
 * und eine Board-Kategorie hat; bei inaktiver Stufe die aktive Stufe
 * derselben Kategorie (`aktiveZielStufe`, deutsche vor englischer Dublette);
 * sonst `OHNE_STUFE`. Nichts verschwindet.
 */
export function spalteFuer(stufeId: string | null, stufen: StufeZeile[]): string {
  if (!stufeId) return OHNE_STUFE;
  const s = stufen.find((x) => x.id === stufeId);
  if (!s || !s.kategorie) return OHNE_STUFE;
  if (istSpaltenStufe(s)) return s.id;
  const ziel = aktiveZielStufe(
    stufen.filter(istSpaltenStufe).map((x) => ({
      id: x.id,
      title: x.label,
      sortOrder: x.reihenfolge,
      isActive: x.aktiv,
      stageCategory: x.kategorie,
    })),
    s.kategorie,
  );
  return ziel?.id ?? OHNE_STUFE;
}

// ─── Karte ───────────────────────────────────────────────────────────────────

const LEISTUNGEN: readonly AblaufFakten["leistung"][] = ["move", "kitchen_installation", "clearance", "clearance_move"];

/** Leistung wie die Akte (`leistungAus` in `services/ablauf-fakten.ts`); ohne Angebot Umzug. */
function leistungAus(a: LeadRoh["angebot"]): AblaufFakten["leistung"] {
  if (!a?.serviceType) return "move";
  const l = portalLeistung(a.serviceType as "move" | "kitchen_installation" | "clearance", a.mitEntruempelung);
  return LEISTUNGEN.includes(l) ? l : "move";
}

/** „KV gesendet“ nach der Regel der Akte; ohne Angebot null. */
export function kvGesendetAus(roh: LeadRoh): string | null {
  const a = roh.angebot;
  if (!a) return null;
  const versionsGesendet = roh.versionen.gesperrt ? roh.versionen.gesperrt.gesendetAm : a.versionGesendetAm;
  return versionsGesendet ?? (a.ohneVersion ? roh.dokumente.kvErstesAm : null);
}

/** Team-Soll (Entscheidung 12): gesperrte Version, sonst Entwurf, sonst `deal_calculations`. */
export function teamSollAus(roh: LeadRoh): number | null {
  return roh.versionen.gesperrt?.teamSoll ?? roh.versionen.entwurf?.teamSoll ?? roh.rechner?.teamSoll ?? null;
}

/** Ist unter Soll; ohne Soll fehlt das Team nur, wenn niemand zugeteilt ist. */
export function teamFehltAus(soll: number | null, ist: number): boolean {
  return soll !== null && soll > 0 ? ist < soll : ist === 0;
}

/** Ein `value` als reine Zahl gilt als Euro-Betrag (Altbestand); `leadWert` liest nur `.amount`. */
function dealWertAus(wert: unknown): unknown {
  if (typeof wert === "number" || (typeof wert === "string" && wert.trim() !== "" && Number.isFinite(Number(wert)))) {
    return { amount: wert };
  }
  return wert;
}

function istTag(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Grund hinter „läuft“ (Entscheidung 10): zukünftige Besichtigung
 * („Besichtigung Do 07.11. 16:00“, nur Tag ohne Uhrzeit), sonst bei Geplant
 * mit Termin „Termin Fr 14.11.“, sonst keiner.
 */
export function laeuftGrund(roh: LeadRoh, kategorie: LeadKategorie | null, jetzt: Date): string | null {
  const b = roh.besichtigungAm;
  if (b) {
    if (istTag(b)) {
      if (b >= berlinDateString(jetzt)) return `Besichtigung ${tagKurz(b)}`;
    } else {
      const t = Date.parse(b);
      if (Number.isFinite(t) && t > jetzt.getTime()) return `Besichtigung ${tagKurz(b)} ${uhrzeitKurz(b)}`;
    }
  }
  const termin = roh.umzugAm ?? roh.terminAuswahl;
  if (kategorie === "booked" && termin) return `Termin ${tagKurz(termin)}`;
  return null;
}

/** Der eine offene Rest (`offenAus`): gestellte Rechnung vor Annahme, Festpreis und Stunden-KV. */
export function offenVonLead(roh: LeadRoh): OffenErgebnis {
  return offenAus({
    rechnung: roh.rechnung ? { status: roh.rechnung.status, bruttoCent: roh.rechnung.bruttoCent } : null,
    annahmeCent: roh.annahme?.cent ?? null,
    festpreis: roh.angebot?.festpreisEuro ?? null,
    istStunden: roh.angebot?.istStunden ?? false,
    zahlungen: roh.zahlungen,
  });
}

/** Letzter bekannter Umzugstag: das spätere von Attribut und Kundenauswahl. */
export function letzterUmzugstag(roh: LeadRoh, planEnde?: string | null): string | null {
  // Fix-Welle I2: das Ende zählt (Attribut `move_end`, sonst Ende des Plan-Eintrags), sonst der Starttag.
  const tage = [roh.umzugAm, roh.terminAuswahl, roh.umzugEnde ?? null, planEnde ?? null].filter(
    (t): t is string => t != null && t !== ""
  );
  if (tage.length === 0) return null;
  return tage.reduce((a, b) => (a > b ? a : b));
}

/** Erster fester Termin: Kundenauswahl, sonst das Umzugsdatum. */
export function ersterTermin(roh: LeadRoh): string | null {
  return roh.terminAuswahl ?? roh.umzugAm;
}

/**
 * Tag „durchgeführt“: letzter Umzugstag, wenn bekannt. Sonst bei Durchgeführt
 * der Berliner Tag von `wartet.seit`, sonst von `stage_entered_at`.
 */
export function durchgefuehrtAmAus(roh: LeadRoh, kategorie: string | null): string | null {
  const letzter = letzterUmzugstag(roh);
  if (letzter) return letzter;
  if (kategorie !== "done_unpaid") return null;
  const iso = roh.wartet?.seit ?? roh.stufeBetretenAm;
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return berlinTag(iso);
}

/** Gestellte Rechnung. Ohne Rechnungszeile zählt das alte Rechnungsdokument. */
export function rechnungGestellt(roh: LeadRoh): boolean {
  if (roh.rechnung) return roh.rechnung.status === "gestellt";
  return roh.dokumente.rechnungAm != null;
}

/** Letzter Zahlungstag der Preiszahlungen (ohne Kaution), YYYY-MM-DD. */
function bezahltAmAus(roh: LeadRoh): string | null {
  return roh.zahlungen.reduce<string | null>(
    (letzte, z) => (z.taxTreatment !== "nicht_steuerbar" && z.date && (!letzte || z.date > letzte) ? z.date : letzte),
    null,
  );
}

/**
 * Höchstens ein Kontextfeld je Stufe (Entscheidung 13): In Kontakt „9 Fotos“,
 * Angebot „gültig bis 12.11.“, Durchgeführt „Rest 1.600 €“, Bezahlt
 * „bezahlt 03.11.“, sonst keins (Geplant zeigt das Team).
 */
export function kontextAus(roh: LeadRoh, kategorie: LeadKategorie | null): string | null {
  switch (kategorie) {
    case "open_engaged":
      return roh.fotos > 0 ? (roh.fotos === 1 ? "1 Foto" : `${roh.fotos} Fotos`) : null;
    case "quoted":
      return roh.angebot?.gueltigBis ? `gültig bis ${datumKurz(roh.angebot.gueltigBis)}` : null;
    case "done_unpaid": {
      const rest = offenVonLead(roh).restCent;
      return rest !== null && rest > 0 ? `Rest ${euroText(rest)}` : null;
    }
    case "paid": {
      const am = bezahltAmAus(roh);
      return am ? `bezahlt ${datumKurz(am)}` : null;
    }
    default:
      return null;
  }
}

const TAG_MS = 24 * 60 * 60 * 1000;
const WOCHE_KATEGORIEN: ReadonlySet<string> = new Set<LeadKategorie>(["booked", "done_unpaid", "paid"]);

/**
 * Chips „Heute im Blick“ eines Deals (Entscheidung 6):
 * warten = Pille „auf uns“ (Endstufen haben keine);
 * kv_ungesehen = Angebot, KV gesendet, seitdem kein Portalaufruf, älter als
 * `KV_UNGESEHEN_TAGE` (live);
 * ohne_team = Geplant und `teamFehlt`;
 * rechnung_offen = wie die Kasse-Schlange „offen“: gestellte Rechnung
 * (ohne Zeile: altes Rechnungsdokument), Rest > 0 oder Betrag unbekannt
 * (Stunden-KV bzw. gestellte Rechnung ohne Betrag), nicht verloren;
 * ohne_ab = Geplant, Annahme aktiv, keine Auftragsbestätigung;
 * diese_woche = Termin Montag bis Sonntag der laufenden Berliner Woche bei
 * Geplant, Durchgeführt oder Bezahlt.
 */
export function chipsAus(
  f: {
    karte: Pick<LeadKarte, "wartet" | "termin" | "teamFehlt" | "stufe">;
    kvGesendetAm: string | null;
    portalZuletztGeoeffnet: string | null;
    rechnungGestellt: boolean;
    restCent: number | null;
    /** `restCent == null` zählt nur hier: Stunden-KV oder gestellte Rechnung ohne Betrag. */
    restUnbekannt: boolean;
    annahme: boolean;
    abAm: string | null;
  },
  jetzt: Date,
  woche: { von: string; bis: string } = wocheGrenzen(jetzt),
): LeadsChipKey[] {
  const k = f.karte.stufe.kategorie;
  const chips: LeadsChipKey[] = [];
  if (f.karte.wartet.auf === "uns") chips.push("warten");
  if (k === "quoted" && f.kvGesendetAm) {
    const gesendet = Date.parse(f.kvGesendetAm);
    const gesehen = f.portalZuletztGeoeffnet !== null && Date.parse(f.portalZuletztGeoeffnet) >= gesendet;
    if (!gesehen && jetzt.getTime() - gesendet > KV_UNGESEHEN_TAGE * TAG_MS) chips.push("kv_ungesehen");
  }
  if (k === "booked" && f.karte.teamFehlt) chips.push("ohne_team");
  const restOffen = f.restCent == null ? f.restUnbekannt : f.restCent > 0;
  if (k !== "lost" && f.rechnungGestellt && restOffen) chips.push("rechnung_offen");
  if (k === "booked" && f.annahme && !f.abAm) chips.push("ohne_ab");
  const t = f.karte.termin;
  if (t && k && WOCHE_KATEGORIEN.has(k) && t >= woche.von && t <= woche.bis) chips.push("diese_woche");
  return chips;
}

/** „Kunde meldet bezahlt · 500 €“ für offene „Ich habe bezahlt“-Meldungen (mehrere: Summe). */
function zahlungGemeldetAus(roh: LeadRoh): string | null {
  const offen = offeneMeldungen(roh.meldungsEreignisse);
  if (offen.length === 0) return null;
  return `Kunde meldet bezahlt · ${euroText(offen.reduce((s, m) => s + m.betragCent, 0))}`;
}

const nurZiffern = (t: string) => t.replace(/\D/g, "");

/** Karte, Chips und Suchschlüssel eines Deals. */
export function eintragAus(
  roh: LeadRoh,
  k: { stufen: StufeZeile[]; firmen: Map<string, LeadFirma>; quellen: Map<string, LeadQuelle> },
  jetzt: Date,
  woche: { von: string; bis: string } = wocheGrenzen(jetzt),
): LeadEintrag {
  const stufe = roh.stufeId ? k.stufen.find((s) => s.id === roh.stufeId) ?? null : null;
  const kategorie = stufe?.kategorie ?? null;
  const name = roh.name?.trim() || "Ohne Namen";
  const von = ortAus(roh.von);
  const nach = ortAus(roh.nach);
  const termin = roh.umzugAm ?? roh.terminAuswahl;
  const art = artAus(leistungAus(roh.angebot), null);

  const angebot: AngebotRoh | null = roh.angebot
    ? {
        fixedPriceEuro: roh.angebot.festpreisEuro,
        isVariable: roh.angebot.istStunden,
        selectedPackageOptionId: roh.angebot.selectedPackageOptionId,
        optionen: roh.optionen,
        positionen: roh.angebot.positionen,
      }
    : null;
  const wert = leadWert({
    kvaCent: roh.annahme?.cent ?? null,
    angebot,
    dealValue: dealWertAus(roh.wert),
    rechnerErgebnis: roh.rechner?.festpreis != null ? { preis: { festpreis: roh.rechner.festpreis } } : null,
    kalkCent: roh.versionen.gesperrt?.cent ?? roh.versionen.entwurf?.cent ?? null,
  });
  const betrag: LeadKarte["betrag"] = wert
    ? { cent: wert.cent, art: wert.art === "schaetzung" ? "geschaetzt" : "fest" }
    : null;

  const team = roh.team.map((n) => ({ kuerzel: kuerzelAus(n), name: n }));
  const teamFehlt = teamFehltAus(teamSollAus(roh), team.length);
  const wartet = wartetPille(roh.wartet, kategorie, jetzt, laeuftGrund(roh, kategorie, jetzt));
  const kvGesendetAm = kvGesendetAus(roh);
  const aktivitaet = roh.letzteNachrichtAm ?? roh.erstelltAm;
  const altLink = mitAlt(`/objects/deals/${roh.id}`);
  const firma = roh.firmaId ? k.firmen.get(roh.firmaId) ?? null : null;
  const quelle = roh.quelleId ? k.quellen.get(roh.quelleId) ?? null : null;

  const karte: LeadKarte = {
    id: roh.id,
    nummer: roh.nummer,
    name,
    stufe: stufe
      ? { id: stufe.id, label: stufe.label, kategorie }
      : { id: null, label: "Ohne Stufe", kategorie: null },
    spalteId: spalteFuer(roh.stufeId, k.stufen),
    betrag,
    betragText: betragAnzeige(betrag),
    art,
    von,
    nach,
    termin,
    was: wasZeile({ art, von, nach, termin, kategorie }),
    wartet,
    quelle,
    firma,
    team,
    teamFehlt,
    kontext: kontextAus(roh, kategorie),
    aktivitaet,
    aktivitaetText: vorText(aktivitaet, jetzt),
    zahlungGemeldet: zahlungGemeldetAus(roh),
    fakten: {
      annahmeAm: roh.annahme?.am ?? null,
      kvVorhanden: roh.dokumente.kvErstesAm !== null || kvGesendetAm !== null,
      verlustGrund: roh.verlustGrund?.trim() ? roh.verlustGrund : null,
    },
    kvLink: kalkulationLinks(roh.id, altLink, {
      hatPaketoptionen: roh.optionen.length > 0,
      istStunden: roh.angebot?.istStunden === true,
    }).kvLink,
    erstelltAm: roh.erstelltAm,
  };

  const offen = offenVonLead(roh);
  const chips = chipsAus(
    {
      karte,
      kvGesendetAm,
      portalZuletztGeoeffnet: roh.portalZuletztGeoeffnet,
      // Gleiche Regel wie die Kasse-Schlange „offen“ (Fix-Welle I3: Altrechnungen eingeschränkt).
      rechnungGestellt: rechnungZaehlt(roh.rechnung, kategorie),
      restCent: offen.restCent,
      restUnbekannt: offen.restCent == null,
      annahme: roh.annahme != null,
      abAm: roh.dokumente.abAm,
    },
    jetzt,
    woche,
  );

  return {
    karte,
    chips,
    suchtext: [name, von, nach, roh.nummer].filter(Boolean).join(" ").toLocaleLowerCase("de-DE"),
    telefonZiffern: [...new Set(roh.telefone.map(nurZiffern).filter((z) => z.length > 0))],
  };
}

// ─── Filter und Chips ────────────────────────────────────────────────────────

const OHNE_TERMIN_SICHTBAR: ReadonlySet<string> = new Set<LeadKategorie>(["open_new", "open_engaged", "quoted"]);

/**
 * Suche (Entscheidung 7): ab `SUCHE_MIN_ZEICHEN` in Name, Orten und
 * Deal-Nummer; eine reine Nummer ab 4 Ziffern zusätzlich in den Telefonnummern
 * der Gesprächskontakte, ohne führende Nullen („0170 123“ findet „+49170123…“).
 */
export function passtSuche(e: Pick<LeadEintrag, "suchtext" | "telefonZiffern">, suche: string): boolean {
  const q = suche.trim();
  if (q.length < SUCHE_MIN_ZEICHEN) return true;
  if (e.suchtext.includes(q.toLocaleLowerCase("de-DE"))) return true;
  const ziffern = nurZiffern(q);
  if (!/^[+\d\s()/.-]+$/.test(q) || ziffern.length < 4) return false;
  const ohneNull = ziffern.replace(/^0+/, "");
  return ohneNull.length >= 3 && e.telefonZiffern.some((t) => t.includes(ohneNull));
}

/**
 * Filter der Leiste und des Chips. Monat (Bezug Termin): Deals ohne Termin
 * bleiben nur in Neue Anfrage, In Kontakt und Angebot. Ohne `endstufen`
 * fallen Verloren und Kein Lead weg (das Board ruft deshalb mit
 * `endstufen: true` und klappt die Spalten selbst ein).
 */
export function filtern(eintraege: LeadEintrag[], f: LeadsFilter): LeadEintrag[] {
  return eintraege.filter((e) => {
    const k = e.karte;
    const kategorie = k.stufe.kategorie;
    if (!f.endstufen && kategorie && EINGEKLAPPT_SET.has(kategorie)) return false;
    if (f.chip && !e.chips.includes(f.chip)) return false;
    if (f.firmaId && k.firma?.id !== f.firmaId) return false;
    if (f.quelleId && k.quelle?.id !== f.quelleId) return false;
    if (f.nurWartet && k.wartet.auf !== "uns") return false;
    if (f.monat) {
      if (k.termin) {
        if (!k.termin.startsWith(`${f.monat}-`)) return false;
      } else if (!kategorie || !OHNE_TERMIN_SICHTBAR.has(kategorie)) {
        return false;
      }
    }
    return passtSuche(e, f.suche);
  });
}

/** Zähler über die übergebenen (ungefilterten) Einträge. */
export function chipsZaehlen(eintraege: LeadEintrag[]): LeadsChips {
  const z: LeadsChips = { warten: 0, kv_ungesehen: 0, ohne_team: 0, rechnung_offen: 0, ohne_ab: 0, diese_woche: 0 };
  for (const e of eintraege) for (const c of e.chips) z[c]++;
  return z;
}

// ─── Sortierung ──────────────────────────────────────────────────────────────

function wartetRang(k: LeadKarte): number {
  return k.wartet.auf === "uns" ? 0 : k.wartet.auf === "kunde" ? 1 : 2;
}

function zeitOder(iso: string | null, fehlt: number): number {
  if (!iso) return fehlt;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fehlt;
}

/**
 * Reihenfolge im Board (Entscheidung 14): „wartet auf uns“, dann „wartet auf
 * Kunden“, je nach Wartebeginn aufsteigend (längste Wartezeit oben, ohne
 * Beginn ans Ende), danach alle übrigen nach Aktivität absteigend; Gleichstand
 * nach ID.
 */
function boardVergleich(a: LeadEintrag, b: LeadEintrag): number {
  const ka = a.karte;
  const kb = b.karte;
  const r = wartetRang(ka) - wartetRang(kb);
  if (r !== 0) return r;
  if (wartetRang(ka) < 2) {
    const d = zeitOder(ka.wartet.seit, Infinity) - zeitOder(kb.wartet.seit, Infinity);
    if (d !== 0 && !Number.isNaN(d)) return d;
  } else {
    const d = zeitOder(kb.aktivitaet, -Infinity) - zeitOder(ka.aktivitaet, -Infinity);
    if (d !== 0 && !Number.isNaN(d)) return d;
  }
  return ka.id < kb.id ? -1 : ka.id > kb.id ? 1 : 0;
}

export function sortierenInSpalte(eintraege: LeadEintrag[]): LeadEintrag[] {
  return [...eintraege].sort(boardVergleich);
}

/** Werte ohne Angabe stehen in beiden Richtungen unten. */
function mitLeerenUnten<T>(a: T | null, b: T | null, vergleich: (x: T, y: T) => number, richtung: "auf" | "ab"): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const d = vergleich(a, b);
  return richtung === "auf" ? d : -d;
}

/**
 * Sortierung der Liste (Entscheidung 15). `wartezeit`: die Gruppen bleiben
 * (auf uns, auf Kunden, übrige), „ab“ ist die Board-Reihenfolge (längste
 * Wartezeit oben), „auf“ dreht nur die Zeit innerhalb der wartenden Gruppen.
 * `termin`, `betrag`, `quelle`, `stufe` (nach `sort_order`): ohne Wert unten,
 * Gleichstand in Board-Reihenfolge.
 */
export function listeSortieren(eintraege: LeadEintrag[], s: ListenSortierung, stufen: StufeZeile[]): LeadEintrag[] {
  const rang = new Map(stufen.map((x) => [x.id, x.reihenfolge]));
  const vergleich = (a: LeadEintrag, b: LeadEintrag): number => {
    const ka = a.karte;
    const kb = b.karte;
    switch (s.schluessel) {
      case "wartezeit": {
        const r = wartetRang(ka) - wartetRang(kb);
        if (r !== 0) return r;
        if (wartetRang(ka) < 2) {
          const d = mitLeerenUnten(
            ka.wartet.seit ? zeitOder(ka.wartet.seit, 0) : null,
            kb.wartet.seit ? zeitOder(kb.wartet.seit, 0) : null,
            (x, y) => x - y,
            s.richtung === "ab" ? "auf" : "ab",
          );
          if (d !== 0) return d;
        }
        return 0;
      }
      case "termin":
        return mitLeerenUnten(ka.termin, kb.termin, (x, y) => x.localeCompare(y), s.richtung);
      case "betrag":
        return mitLeerenUnten(ka.betrag?.cent ?? null, kb.betrag?.cent ?? null, (x, y) => x - y, s.richtung);
      case "quelle":
        return mitLeerenUnten(ka.quelle?.label ?? null, kb.quelle?.label ?? null, (x, y) => x.localeCompare(y, "de"), s.richtung);
      case "stufe":
        return mitLeerenUnten(
          ka.stufe.id !== null ? rang.get(ka.stufe.id) ?? null : null,
          kb.stufe.id !== null ? rang.get(kb.stufe.id) ?? null : null,
          (x, y) => x - y,
          s.richtung,
        );
    }
  };
  return [...eintraege].sort((a, b) => vergleich(a, b) || boardVergleich(a, b));
}

// ─── Spalten und Seiten ──────────────────────────────────────────────────────

/** Ein Ausschnitt ab `offset`; `weiter` ist der Offset der nächsten Seite oder null. */
export function seite<T>(liste: T[], offset: number, limit: number): { teil: T[]; weiter: number | null } {
  const ab = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const bis = ab + Math.max(0, Math.floor(limit));
  return { teil: liste.slice(ab, bis), weiter: bis < liste.length ? bis : null };
}

/** Summe der plausiblen Beträge; „~“, sobald einer davon geschätzt ist. */
function summeAus(eintraege: LeadEintrag[]): { summeCent: number | null; summeGeschaetzt: boolean } {
  let summe: number | null = null;
  let geschaetzt = false;
  for (const e of eintraege) {
    const b = e.karte.betrag;
    if (!b) continue;
    const cent = plausiblerCent({ cent: b.cent, art: b.art === "fest" ? "angebot" : "schaetzung" });
    if (cent === null) continue;
    summe = (summe ?? 0) + cent;
    if (b.art === "geschaetzt") geschaetzt = true;
  }
  return { summeCent: summe, summeGeschaetzt: geschaetzt };
}

export const OHNE_STUFE_LABEL = "Ohne Stufe";
export const OHNE_STUFE_SATZ = "Stufe fehlt oder ist unbekannt";

/**
 * Spalten des Boards (Entscheidung 2): „Ohne Stufe“ ganz links (nur mit
 * Karten), dann je aktive Stufe einer Board-Kategorie eine Spalte in
 * `sort_order`, rechts Verloren und Kein Lead (ohne `endstufen` eingeklappt:
 * nur Zähler, keine Karten). Anzahl und Summe über die ganze übergebene
 * (gefilterte) Spalte, Karten nur die erste Seite (`BOARD_SEITE`).
 */
export function spaltenBauen(eintraege: LeadEintrag[], stufen: StufeZeile[], f: LeadsFilter): LeadSpalte[] {
  const gruppen = new Map<string, LeadEintrag[]>();
  for (const e of eintraege) {
    const g = gruppen.get(e.karte.spalteId);
    if (g) g.push(e);
    else gruppen.set(e.karte.spalteId, [e]);
  }

  const bauen = (stufeId: string, label: string, kategorie: LeadKategorie | null, eingeklappt: boolean): LeadSpalte => {
    const alle = sortierenInSpalte(gruppen.get(stufeId) ?? []);
    const { teil, weiter } = eingeklappt ? { teil: [], weiter: null } : seite(alle, 0, BOARD_SEITE);
    return {
      stufeId,
      label,
      kategorie,
      ton: spaltenTon(kategorie),
      satz: kategorie ? SPALTEN_SATZ[kategorie] : OHNE_STUFE_SATZ,
      anzahl: alle.length,
      ...summeAus(alle),
      karten: teil.map((e) => e.karte),
      weiter,
      eingeklappt,
    };
  };

  const sichtbar = stufen.filter(istSpaltenStufe).sort(nachReihenfolge);
  const spalten: LeadSpalte[] = [];
  if ((gruppen.get(OHNE_STUFE)?.length ?? 0) > 0) spalten.push(bauen(OHNE_STUFE, OHNE_STUFE_LABEL, null, false));
  for (const s of sichtbar) if (s.kategorie && BOARD_SET.has(s.kategorie)) spalten.push(bauen(s.id, s.label, s.kategorie, false));
  for (const s of sichtbar) {
    if (s.kategorie && EINGEKLAPPT_SET.has(s.kategorie)) spalten.push(bauen(s.id, s.label, s.kategorie, !f.endstufen));
  }
  return spalten;
}

/** Alle Einträge einer Spalte in Board-Reihenfolge (für „Mehr laden“). */
export function spaltenEintraege(eintraege: LeadEintrag[], stufeId: string): LeadEintrag[] {
  return sortierenInSpalte(eintraege.filter((e) => e.karte.spalteId === stufeId));
}
