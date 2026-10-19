/**
 * Reine Nachfass-Entscheidungen. Kein Datenbankzugriff, kein Versand.
 * Prüfreihenfolge: Ausschluss, dann Zustand, dann Regel.
 */
import { looksDeclined } from "@/services/agent/agent-suppress";
import type { LossReasonTitle } from "@/lib/deal-source";
import {
  ABSCHLUSS_NACH_MS,
  ALT_ABSCHLUSS_NACH_MS,
  ALT_BATCH_PRO_TAG,
  ALT_NACH_MS,
  ANGEBOT_SPAET_MS,
  CEYLAN_MAIL,
  FU1_NACH_MS,
  FU2_NACH_MS,
  INFO_FUER_TEAM_MS,
  KUNDEN_CAP_PRO_TAG,
  SAUBERE_FREIGABEN_FUER_AUTOSEND,
  SIGNATUR_CEYLAN,
  SIGNATUR_KOTTKE,
  TEAM_ABSTAND_MS,
  TEAM_MAX,
  TERMIN_NAH_MS,
  VERLUST_KEINE_RUECKMELDUNG,
  istCeylanWhatsApp,
  istNuriGespraech,
  type NachfassRegel,
} from "./konstanten";

export type Marke = "kottke" | "ceylan" | "unbekannt" | "andere";
export type KanalArt = "whatsapp" | "email" | "sms" | "andere";
export type StageKategorie =
  | "open_new"
  | "open_engaged"
  | "quoted"
  | "booked"
  | "done_unpaid"
  | "paid"
  | "lost";

export type Triage = "frei" | "verloren" | "markiert";

export interface NachfassNachricht {
  direction: "inbound" | "outbound";
  body: string;
  at: Date;
  /** Team-Nachricht, zählt nicht als Outbound an den Kunden. */
  internal?: boolean;
  system?: boolean;
  /** pending/failed sind nicht rausgegangen. */
  status?: string;
}

export interface NachfassLage {
  marke: Marke;
  kontoId: string;
  kanal: KanalArt;
  kontoAdresse: string | null;
  gespraechId: string | null;
  stageKategorie: StageKategorie | null;
  serviceUmzug: boolean;
  /** YYYY-MM-DD, Europe/Berlin-Kalendertag. */
  moveDate: string | null;
  angebotAm: Date | null;
  hatAngebot: boolean;
  infosVollstaendig: boolean;
  infosVollstaendigSeit: Date | null;
  kundeHatNachgehakt: boolean;
  /** Nach der letzten kundenrelevanten Outbound keine inhaltliche Inbound. */
  stumm: boolean;
  kundeHatGeantwortet: boolean;
  letzteAktivitaet: Date | null;
  fu1Gesendet: boolean;
  fu2Gesendet: boolean;
  abschlussGesendet: boolean;
  regelCGesendet: boolean;
  legacyFuGesendetAm: Date | null;
  legacyAbschlussGesendet: boolean;
  triage: Triage | null;
  sequenzBegonnen: boolean;
  teamErinnerungen: number;
  letzteTeamErinnerung: Date | null;
  humanOwned: boolean;
  aiPaused: boolean;
  aiNeedsReply: boolean;
  keinProaktivConsent: boolean;
  istIntern: boolean;
  istDuplikat: boolean;
  portalOhneKontakt: boolean;
  b2b: boolean;
  /** complaint | legal | optout | price | deposit | null */
  chatSperre: string | null;
  /** Vom Kunden genannter Verlustgrund, falls der Chat einen hergibt. */
  vomKunden: LossReasonTitle | null;
  anredeUnklar: boolean;
  gesendetHeute: number;
  legacyEntwuerfeHeute: number;
  entwurfLiegt: boolean;
  teamEntwurfLiegt: boolean;
  gestoppt: boolean;
}

export type Entscheidung =
  | { art: "nichts"; grund: string }
  | { art: "stop"; grund: string }
  | { art: "triage_verloren"; grund: string; verlustgrund: LossReasonTitle }
  | { art: "triage_markieren"; grund: string }
  | { art: "triage_frei"; grund: string }
  | { art: "planen"; regel: NachfassRegel | "legacy_abschluss"; ab: Date; grund: string }
  | {
      art: "entwurf";
      regel: NachfassRegel | "legacy_abschluss";
      publikum: "kunde" | "team";
      nurEntwurf: boolean;
      grund: string;
    };

const OFFENE_STAGES: ReadonlySet<StageKategorie> = new Set([
  "open_new",
  "open_engaged",
  "quoted",
]);

const TERMINAL: ReadonlySet<StageKategorie> = new Set([
  "booked",
  "done_unpaid",
  "paid",
  "lost",
]);

const QUITTUNG =
  /^(gelesen|zugestellt|empfangen|read|delivered|seen)([ .!]*|$)|\[(gelesen|zugestellt|read|delivered|reaction|reaktion|system|bridge|typing)\]|^(reaction|reaktion):/i;

export function berlinTeile(now: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  ymd: string;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  let hour = Number.parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;
  const year = Number.parseInt(get("year"), 10);
  const month = Number.parseInt(get("month"), 10);
  const day = Number.parseInt(get("day"), 10);
  const minute = Number.parseInt(get("minute"), 10);
  const ymd = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { year, month, day, hour, minute, ymd };
}

/** UTC-Zeitpunkt, dessen Berliner Wanduhr y-m-d hour:minute zeigt. */
export function berlinUhr(year: number, month: number, day: number, hour: number, minute: number): Date {
  const gewollt = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = gewollt;
  for (let i = 0; i < 4; i++) {
    const ist = berlinTeile(new Date(utc));
    const istAlsUtc = Date.UTC(ist.year, ist.month - 1, ist.day, ist.hour, ist.minute, 0);
    const delta = gewollt - istAlsUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

/** Kundenkanal nur 9–19 Uhr Europe/Berlin, jeden Tag. Stunde 19 ist zu. */
export function imKundenfenster(now: Date): boolean {
  const { hour } = berlinTeile(now);
  if (!Number.isFinite(hour)) return false;
  return hour >= 9 && hour < 19;
}

export function naechsterKundenSlot(now: Date): Date {
  if (imKundenfenster(now)) return now;
  const teile = berlinTeile(now);
  if (teile.hour < 9) return berlinUhr(teile.year, teile.month, teile.day, 9, 0);
  const morgen = new Date(berlinUhr(teile.year, teile.month, teile.day, 12, 0).getTime() + 24 * 60 * 60 * 1000);
  const m = berlinTeile(morgen);
  return berlinUhr(m.year, m.month, m.day, 9, 0);
}

export function kundenCapErreicht(gesendetHeute: number, cap = KUNDEN_CAP_PRO_TAG): boolean {
  return gesendetHeute >= cap;
}

export function altBatchErreicht(entwuerfeHeute: number, cap = ALT_BATCH_PRO_TAG): boolean {
  return entwuerfeHeute >= cap;
}

export function genugSaubereFreigaben(sauber: number): boolean {
  return sauber >= SAUBERE_FREIGABEN_FUER_AUTOSEND;
}

/**
 * Auto-Versand bleibt zu, solange der Schalter aus ist, dryRun nicht explizit
 * aus ist, oder noch keine 20 Freigaben ohne Korrektur vorliegen.
 */
export function autoSendErlaubt(input: {
  schalterAn: boolean;
  dryRun: boolean;
  saubereFreigaben: number;
  nurEntwurf: boolean;
  preisLeak: boolean;
  harteSperre: boolean;
  capErreicht: boolean;
  imFenster: boolean;
  publikum: "kunde" | "team";
}): boolean {
  if (!input.schalterAn || input.dryRun) return false;
  if (!genugSaubereFreigaben(input.saubereFreigaben)) return false;
  if (input.nurEntwurf || input.preisLeak || input.harteSperre) return false;
  if (input.publikum === "kunde" && (!input.imFenster || input.capErreicht)) return false;
  return true;
}

export function zaehltAlsKundeninhalt(m: NachfassNachricht): "inbound" | "outbound" | "ignore" {
  if (m.internal || m.system) return "ignore";
  if (m.direction === "outbound" && (m.status === "pending" || m.status === "failed")) return "ignore";
  const body = (m.body ?? "").replace(/\u200d|\uFE0F/g, "").trim();
  if (!body) return "ignore";
  if (QUITTUNG.test(body)) return "ignore";
  const ohneEmoji = body.replace(/\p{Extended_Pictographic}/gu, "").replace(/\s/g, "");
  if (!ohneEmoji) return "ignore";
  return m.direction === "inbound" ? "inbound" : "outbound";
}

export function ohneAntwort(nachrichten: readonly NachfassNachricht[]): {
  stumm: boolean;
  kundeHatGeantwortet: boolean;
  letzteOutbound: Date | null;
  letzteAktivitaet: Date | null;
} {
  const relevant = nachrichten
    .map((m) => ({ m, art: zaehltAlsKundeninhalt(m) }))
    .filter((x) => x.art !== "ignore")
    .sort((a, b) => a.m.at.getTime() - b.m.at.getTime());
  let letzteOutbound: Date | null = null;
  let letzteAktivitaet: Date | null = null;
  let inboundDanach = false;
  for (const { m, art } of relevant) {
    letzteAktivitaet = m.at;
    if (art === "outbound") {
      letzteOutbound = m.at;
      inboundDanach = false;
    } else if (letzteOutbound && m.at.getTime() > letzteOutbound.getTime()) {
      inboundDanach = true;
    }
  }
  const stumm = letzteOutbound !== null && !inboundDanach;
  return {
    stumm,
    kundeHatGeantwortet: letzteOutbound !== null && inboundDanach,
    letzteOutbound,
    letzteAktivitaet,
  };
}

const GRUSS_ANFANG =
  /^(hallo|hi|hey|moin|servus|guten (tag|morgen|abend)|sehr geehrte[rs]?|liebe[rs]?)(\s+[^\n,!]{1,40}){0,3}[,!]?\s*/i;

/** Laufender Chat: keine zweite Begrüßung vorne. */
export function ohneDoppeltenGruss(text: string, chatLaeuft: boolean): string {
  const t = text.trim();
  if (!chatLaeuft) return t;
  return t.replace(GRUSS_ANFANG, "").trim();
}

export function erkenneMarke(input: {
  firmenname: string | null;
  kontoId: string | null;
  kontoAdresse: string | null;
}): Marke {
  const name = (input.firmenname ?? "").toLowerCase();
  const adresse = (input.kontoAdresse ?? "").toLowerCase();
  const konto = (input.kontoId ?? "").toLowerCase();
  const nameKottke = name.includes("kottke");
  const nameCeylan = name.includes("ceylan");
  const kanalKottke = konto.startsWith("82027c02") || (adresse.includes("kottke") && !adresse.includes("ceylan"));
  const kanalCeylan = adresse.includes("ceylan") || istCeylanWhatsApp(konto);
  if (nameKottke && nameCeylan) return "unbekannt";
  if (nameKottke && kanalCeylan && !nameCeylan) return "unbekannt";
  if (nameCeylan && kanalKottke && !adresse.includes("ceylan")) return "unbekannt";
  if (nameKottke) return "kottke";
  if (nameCeylan) return "ceylan";
  if (kanalKottke && kanalCeylan) return "unbekannt";
  if (kanalCeylan) return "ceylan";
  if (kanalKottke) return "kottke";
  if (!name && !adresse) return "unbekannt";
  return "andere";
}

export function waehleKundenkanal(input: {
  marke: Marke;
  kontoId: string;
  kanal: KanalArt;
  kontoAdresse: string | null;
  gespraechId: string | null;
}): { erlaubt: boolean; nurEntwurf: boolean; grund: string | null; signatur: string | null } {
  if (istNuriGespraech(input.gespraechId)) {
    return { erlaubt: false, nurEntwurf: false, grund: "internes_team_gespraech", signatur: null };
  }
  if (istCeylanWhatsApp(input.kontoId)) {
    return { erlaubt: false, nurEntwurf: false, grund: "ceylan_whatsapp", signatur: null };
  }
  const adresse = (input.kontoAdresse ?? "").toLowerCase();
  if (input.marke === "andere") {
    return { erlaubt: false, nurEntwurf: false, grund: "fremde_firma", signatur: null };
  }
  if (input.marke === "ceylan") {
    if (input.kanal !== "email") {
      return { erlaubt: false, nurEntwurf: false, grund: "ceylan_nur_eigener_mailkanal", signatur: null };
    }
    if (!adresse.includes("ceylan")) {
      return { erlaubt: false, nurEntwurf: false, grund: "marken_mix", signatur: null };
    }
    return { erlaubt: true, nurEntwurf: false, grund: null, signatur: SIGNATUR_CEYLAN };
  }
  if (input.marke === "kottke") {
    if (adresse.includes("ceylan") || adresse === CEYLAN_MAIL) {
      return { erlaubt: false, nurEntwurf: false, grund: "marken_mix", signatur: null };
    }
    if (input.kanal !== "whatsapp" && input.kanal !== "email") {
      return { erlaubt: false, nurEntwurf: false, grund: "kanal_nicht_wa_oder_mail", signatur: null };
    }
    return { erlaubt: true, nurEntwurf: false, grund: null, signatur: SIGNATUR_KOTTKE };
  }
  if (input.kanal !== "whatsapp" && input.kanal !== "email") {
    return { erlaubt: false, nurEntwurf: false, grund: "marke_und_kanal_unklar", signatur: null };
  }
  return { erlaubt: true, nurEntwurf: true, grund: "marke_unklar", signatur: null };
}

export function sperreAusText(text: string | null | undefined): string | null {
  const t = text ?? "";
  if (!t.trim()) return null;
  if (/anwalt|gericht|klage|abmahnung|anzeige erstatten/i.test(t)) return "legal";
  if (/beschwerde|schaden|kaputtgemacht|zerstört|zerstort|zahlungsstreit/i.test(t)) return "complaint";
  if (looksDeclined(t)) return "optout";
  if (/zu teuer|rabatt|nachlass|preis runter|verhandeln|günstiger anbieten|guenstiger anbieten/i.test(t)) {
    return "price";
  }
  if (/anzahlung|deposit|rechnung|bereits (bezahlt|überwiesen|ueberwiesen)|restzahlung/i.test(t)) {
    return "deposit";
  }
  return null;
}

export function istB2B(input: { firmaGesetzt: boolean; text: string }): boolean {
  if (input.firmaGesetzt) return true;
  return /gmbh|hausverwaltung|firmenumzug|unser unternehmen|für unsere firma|fuer unsere firma/i.test(input.text);
}

export function portalOhneDirektkontakt(input: {
  quelle: string | null;
  telefon: string | null;
  email: string | null;
}): boolean {
  const portal = /immoscout|umzugsfirmen|mt24|\bis24\b/i.test(input.quelle ?? "");
  if (!portal) return false;
  const phone = (input.telefon ?? "").replace(/\D/g, "");
  const email = (input.email ?? "").trim().toLowerCase();
  const direkt = !!email && !/noreply|no-reply|immoscout|umzugsfirmen|portal|relay|mt24/.test(email);
  return phone.length < 8 && !direkt;
}

export function umzugsterminLage(
  moveDate: string | null,
  jetzt: Date
): "vergangen" | "innerhalb_48h" | "ok" | "unbekannt" {
  if (!moveDate) return "unbekannt";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(moveDate);
  if (!m) return "unbekannt";
  const start = berlinUhr(Number(m[1]), Number(m[2]), Number(m[3]), 0, 0);
  const heute = berlinTeile(jetzt);
  const heuteStart = berlinUhr(heute.year, heute.month, heute.day, 0, 0);
  if (start.getTime() < heuteStart.getTime()) return "vergangen";
  if (start.getTime() - jetzt.getTime() < TERMIN_NAH_MS) return "innerhalb_48h";
  return "ok";
}

export function angebotZuSpaet(infosSeit: Date | null, angebotAm: Date | null): boolean {
  if (!infosSeit || !angebotAm) return false;
  return angebotAm.getTime() - infosSeit.getTime() >= ANGEBOT_SPAET_MS;
}

export function parkenUnbeantwortet(nachrichten: readonly NachfassNachricht[]): boolean {
  let gefragt: Date | null = null;
  for (const m of nachrichten) {
    if (zaehltAlsKundeninhalt(m) !== "outbound") continue;
    if (/park|halteverbot/i.test(m.body)) gefragt = m.at;
  }
  if (!gefragt) return false;
  return !nachrichten.some(
    (m) =>
      zaehltAlsKundeninhalt(m) === "inbound" &&
      m.at.getTime() > gefragt!.getTime() &&
      /park|halteverbot|straße|strasse|hof|einfahrt/i.test(m.body)
  );
}

export function kundenVerlustgrund(text: string | null | undefined): LossReasonTitle | null {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/zu teuer|budget|nicht leisten/.test(t)) return "zu teuer";
  if (/anderen anbieter|anderweitig|bereits gebucht|schon gebucht|jemand anders/.test(t)) {
    return "anderer Anbieter";
  }
  if (/selbst umgezogen|selber gemacht|selbst gemacht|freunde helfen/.test(t)) return "Selbstumzug";
  if (/abgesagt|nicht mehr nötig|nicht mehr noetig|doch nicht|hat sich erledigt/.test(t)) {
    return "Umzug abgesagt";
  }
  if (/verschoben|termin passt nicht/.test(t)) return "Termin passt nicht";
  return null;
}

/**
 * Was dieser Lauf in loss_reason schreiben darf.
 * null = Feld stehen lassen. Tag 10 schreibt nur, wenn das Feld leer ist,
 * oder ersetzt ein leeres „keine Rückmeldung“ durch einen vom Kunden genannten Grund.
 * Ein bereits gesetzter anderer Grund (z. B. aus der Anreicherung) bleibt.
 */
export function verlustgrundSchreiben(input: {
  bestehend: string | null;
  vomKunden: LossReasonTitle | null;
  anlass: "tag10" | "triage";
  triageGrund?: LossReasonTitle;
}): LossReasonTitle | null {
  const bestehend = (input.bestehend ?? "").trim();
  if (input.anlass === "tag10") {
    if (input.vomKunden && input.vomKunden !== VERLUST_KEINE_RUECKMELDUNG) {
      if (!bestehend || bestehend === VERLUST_KEINE_RUECKMELDUNG) return input.vomKunden;
      return null;
    }
    if (!bestehend) return VERLUST_KEINE_RUECKMELDUNG;
    return null;
  }
  if (bestehend) return null;
  return input.triageGrund ?? null;
}

export function istAltbestand(lage: NachfassLage, jetzt: Date): boolean {
  if (lage.sequenzBegonnen) return false;
  if (!lage.letzteAktivitaet) return false;
  return jetzt.getTime() - lage.letzteAktivitaet.getTime() >= ALT_NACH_MS;
}

function kanalSperre(lage: NachfassLage): ReturnType<typeof waehleKundenkanal> {
  return waehleKundenkanal({
    marke: lage.marke,
    kontoId: lage.kontoId,
    kanal: lage.kanal,
    kontoAdresse: lage.kontoAdresse,
    gespraechId: lage.gespraechId,
  });
}

function harteLageSperre(lage: NachfassLage, jetzt: Date): string | null {
  if (!lage.serviceUmzug) return "kein_umzug";
  if (lage.istIntern) return "intern";
  if (lage.humanOwned) return "human_owned";
  if (lage.aiPaused) return "ai_paused";
  if (lage.aiNeedsReply) return "offene_kundenfrage";
  if (lage.b2b) return "b2b";
  if (lage.chatSperre) return lage.chatSperre;
  const termin = umzugsterminLage(lage.moveDate, jetzt);
  if (termin === "vergangen") return "termin_vergangen";
  if (termin === "innerhalb_48h") return "termin_innerhalb_48h";
  return null;
}

function kundenEntwurf(
  regel: NachfassRegel | "legacy_abschluss",
  lage: NachfassLage,
  jetzt: Date,
  grund: string
): Entscheidung {
  const kanal = kanalSperre(lage);
  if (!kanal.erlaubt) return { art: "nichts", grund: kanal.grund ?? "kanal_gesperrt" };
  if (!imKundenfenster(jetzt)) {
    return { art: "planen", regel, ab: naechsterKundenSlot(jetzt), grund: "ausserhalb_sendezeit" };
  }
  const nurEntwurf =
    kanal.nurEntwurf || lage.anredeUnklar || lage.keinProaktivConsent || lage.marke === "unbekannt";
  return { art: "entwurf", regel, publikum: "kunde", nurEntwurf, grund };
}

export function entscheideNachfass(lage: NachfassLage, jetzt: Date): Entscheidung {
  if (lage.gestoppt) return { art: "nichts", grund: "gestoppt" };
  if (!lage.serviceUmzug) return { art: "nichts", grund: "kein_umzug" };

  if (lage.stageKategorie && TERMINAL.has(lage.stageKategorie)) {
    if (lage.entwurfLiegt || lage.sequenzBegonnen) return { art: "stop", grund: "stage_terminal" };
    return { art: "nichts", grund: "stage_terminal" };
  }
  if (lage.stageKategorie && !OFFENE_STAGES.has(lage.stageKategorie)) {
    return { art: "nichts", grund: "stage_unklar" };
  }

  if (lage.kundeHatGeantwortet && (lage.entwurfLiegt || lage.sequenzBegonnen || lage.legacyFuGesendetAm)) {
    return { art: "stop", grund: "kunde_hat_geantwortet" };
  }

  const alt = istAltbestand(lage, jetzt);
  if (alt && lage.triage === null) {
    const termin = umzugsterminLage(lage.moveDate, jetzt);
    if (termin === "vergangen") {
      return {
        art: "triage_verloren",
        grund: "alt_termin_vergangen",
        verlustgrund:
          lage.vomKunden && lage.vomKunden !== VERLUST_KEINE_RUECKMELDUNG
            ? lage.vomKunden
            : "Termin passt nicht",
      };
    }
    if (lage.istDuplikat) return { art: "triage_markieren", grund: "duplikat" };
    if (lage.portalOhneKontakt) return { art: "triage_markieren", grund: "portal_ohne_kontakt" };
    const hart = harteLageSperre(lage, jetzt);
    if (hart) return { art: "triage_markieren", grund: hart };
    const kanal = kanalSperre(lage);
    if (!kanal.erlaubt) return { art: "triage_markieren", grund: kanal.grund ?? "kanal_gesperrt" };
    return { art: "triage_frei", grund: "altbestand_triage" };
  }

  if (lage.entwurfLiegt) return { art: "nichts", grund: "entwurf_offen" };

  if (alt && lage.triage === "frei") {
    const hart = harteLageSperre(lage, jetzt);
    if (hart) return { art: "nichts", grund: hart };
    if (!lage.legacyFuGesendetAm) {
      if (altBatchErreicht(lage.legacyEntwuerfeHeute)) return { art: "nichts", grund: "alt_batch" };
      return kundenEntwurf("legacy", lage, jetzt, "alt_fu2");
    }
    if (
      !lage.legacyAbschlussGesendet &&
      jetzt.getTime() - lage.legacyFuGesendetAm.getTime() >= ALT_ABSCHLUSS_NACH_MS
    ) {
      return kundenEntwurf("legacy_abschluss", lage, jetzt, "alt_abschluss");
    }
    return { art: "nichts", grund: "alt_wartet" };
  }
  if (alt) return { art: "nichts", grund: lage.triage === "verloren" ? "alt_verloren" : "alt_markiert" };

  const hart = harteLageSperre(lage, jetzt);
  if (hart) {
    if (lage.entwurfLiegt) return { art: "stop", grund: hart };
    return { art: "nichts", grund: hart };
  }
  if (lage.kundeHatGeantwortet) return { art: "nichts", grund: "kunde_hat_geantwortet" };

  if (lage.hatAngebot && lage.angebotAm && lage.stumm && !lage.abschlussGesendet) {
    const alter = jetzt.getTime() - lage.angebotAm.getTime();
    const cFaellig =
      !lage.regelCGesendet &&
      angebotZuSpaet(lage.infosVollstaendigSeit, lage.angebotAm) &&
      alter >= 20 * 60 * 60 * 1000;
    if (cFaellig && !lage.fu1Gesendet) {
      return kundenEntwurf("c", lage, jetzt, "angebot_zu_spaet");
    }
    if (!lage.fu1Gesendet && alter >= FU1_NACH_MS) {
      return kundenEntwurf("a1", lage, jetzt, "fu1");
    }
    if (lage.fu1Gesendet && !lage.fu2Gesendet && alter >= FU2_NACH_MS) {
      return kundenEntwurf("a2", lage, jetzt, "fu2");
    }
    if (lage.fu1Gesendet && lage.fu2Gesendet && alter >= ABSCHLUSS_NACH_MS) {
      return kundenEntwurf("a3", lage, jetzt, "tag10");
    }
  }

  if (
    !lage.hatAngebot &&
    !lage.regelCGesendet &&
    lage.infosVollstaendig &&
    lage.infosVollstaendigSeit &&
    lage.kundeHatNachgehakt &&
    jetzt.getTime() - lage.infosVollstaendigSeit.getTime() >= ANGEBOT_SPAET_MS
  ) {
    return kundenEntwurf("c", lage, jetzt, "angebot_fehlt_kunde_hakt_nach");
  }

  return { art: "nichts", grund: "kein_anlass" };
}

export function teamErinnerungFaellig(lage: NachfassLage, jetzt: Date): Entscheidung {
  if (lage.gestoppt || lage.teamEntwurfLiegt) return { art: "nichts", grund: "team_nicht_faellig" };
  if (!lage.serviceUmzug || lage.hatAngebot || !lage.infosVollstaendig || !lage.infosVollstaendigSeit) {
    return { art: "nichts", grund: "team_nicht_faellig" };
  }
  if (lage.stageKategorie && TERMINAL.has(lage.stageKategorie)) {
    return { art: "nichts", grund: "team_nicht_faellig" };
  }
  if (istAltbestand(lage, jetzt)) return { art: "nichts", grund: "team_nicht_faellig" };
  const hart = harteLageSperre(lage, jetzt);
  if (hart && hart !== "termin_unbekannt") return { art: "nichts", grund: hart };
  if (lage.teamErinnerungen >= TEAM_MAX) return { art: "nichts", grund: "team_max" };
  if (lage.letzteTeamErinnerung && jetzt.getTime() - lage.letzteTeamErinnerung.getTime() < TEAM_ABSTAND_MS) {
    return { art: "nichts", grund: "team_abstand" };
  }
  if (jetzt.getTime() - lage.infosVollstaendigSeit.getTime() < INFO_FUER_TEAM_MS) {
    return { art: "nichts", grund: "team_zu_frueh" };
  }
  return {
    art: "entwurf",
    regel: "b",
    publikum: "team",
    nurEntwurf: lage.marke === "unbekannt",
    grund: "festpreis_fehlt",
  };
}

/** Interner Satz mit Deal-Link. Kein Kundenkanal, kein Preis. */
export function teamErinnerungText(input: { dealName: string; dealUrl: string; nummer: number }): string {
  const name = input.dealName.trim() || "diesem Deal";
  return [
    `Nachfass intern: Bei ${name} sind die Umzugsinfos vollständig, ein Festpreis fehlt noch.`,
    `Deal: ${input.dealUrl}`,
    `Bitte den Festpreis setzen. Erinnerung ${input.nummer} von ${TEAM_MAX}.`,
  ].join("\n");
}

export function schalterAn(
  zeilen: readonly { oc: string; regel: string; an: boolean }[],
  ocId: string | null,
  regel: string
): boolean {
  const oc = ocId ?? "";
  const genau = zeilen.find((z) => z.oc === oc && z.regel === regel);
  if (genau) return genau.an;
  const allgemein = zeilen.find((z) => z.oc === "" && z.regel === regel);
  return allgemein?.an ?? false;
}
