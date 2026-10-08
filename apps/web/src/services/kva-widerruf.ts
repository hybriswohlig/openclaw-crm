/**
 * Widerruf über den Portal-Button (§ 356a BGB): Erklärung speichern, Annahme
 * aufheben, Eingangsbestätigung an den Kunden (Abs. 4), Alarm ans Team.
 * Der Eingang zählt, auch wenn die Bestätigung scheitert. Alarm und
 * Bestätigung laufen getrennt mit eigener Beanspruchung; was nach der
 * Antwort liegen bleibt, holt der Cron /api/cron/widerruf-nachholen nach.
 */
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { customerStatusLinks, kvaConfirmations, kvaWiderrufe } from "@/db/schema/customer-portal";
import {
  validateTokenShape,
  widerrufsfristEnde,
  widerrufsfunktionAktiv,
  type WiderrufKanal,
  type WiderrufKontext,
  type WiderrufModus,
  type WiderrufPayload,
} from "@openclaw-crm/customer-portal-core";
import { emitEvent } from "./activity-events";
import { sendNewEmail } from "./inbox-email";
import { loadCustomerEmail, resolveCustomerEmailTransport } from "./customer-portal-emails";
import { adminAufgabe, ladeKundenWaThread, sendeWhatsAppText } from "./kva-bestaetigung";
import { ladeAktiveAnnahme } from "./kva-annahme";
import { loadContextByToken } from "./customer-portal-data";
import { sendeAnInterne } from "./intern/intern-senden";

// ─── Texte ────────────────────────────────────────────────────────────────────

const TZ = "Europe/Berlin";
const datumLang = (d: Date) =>
  d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const uhrzeit = (d: Date) => d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const euro = (c: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(c / 100);

export function leistungLabel(serviceType: string | null): string {
  if (serviceType === "move") return "Umzug";
  if (serviceType === "kitchen_installation") return "Küchenmontage";
  if (serviceType === "clearance") return "Entrümpelung";
  return "Auftrag";
}

/** Angaben zur Identifizierung des Vertrags (§ 356a Abs. 2 Nr. 2 BGB). */
export function widerrufVertragText(input: { dealNumber: string; serviceType: string | null; signedAt: Date }): string {
  const leistung = leistungLabel(input.serviceType);
  return [`Auftrag ${input.dealNumber}`, leistung === "Auftrag" ? null : leistung, `angenommen am ${datumLang(input.signedAt)}`]
    .filter(Boolean)
    .join(", ");
}

export function kanalVerfuegbar(kanal: WiderrufKanal, k: { emailBekannt: boolean; whatsapp: boolean }): boolean {
  if (kanal === "email") return k.emailBekannt;
  if (kanal === "whatsapp") return k.whatsapp;
  return true;
}

function kanalText(kanal: string, email: string | null): string {
  return kanal === "whatsapp" ? "per WhatsApp an die Nummer, mit der Sie uns schreiben" : `per E-Mail an ${email ?? "Ihre E-Mail-Adresse"}`;
}

export type BestaetigungsWeg = { art: "whatsapp" } | { art: "email"; an: string };

/**
 * Wege für die Eingangsbestätigung. Bei WhatsApp geht sie zusätzlich an die
 * bekannte E-Mail: Ob ein Chat ein dauerhafter Datenträger ist, ist nicht
 * sicher, eine E-Mail ist es.
 */
export function bestaetigungsWege(input: { kanal: string; email: string | null; bekannteEmail: string | null }): BestaetigungsWeg[] {
  if (input.kanal === "whatsapp") {
    return input.bekannteEmail ? [{ art: "whatsapp" }, { art: "email", an: input.bekannteEmail }] : [{ art: "whatsapp" }];
  }
  return input.email ? [{ art: "email", an: input.email }] : [];
}

/** Eingangsbestätigung mit Inhalt der Erklärung, Datum und Uhrzeit (§ 356a Abs. 4 BGB). */
export function eingangsbestaetigungText(input: {
  firma: string;
  name: string;
  vertrag: string;
  kanalText: string;
  eingegangenAt: Date;
}): string {
  return [
    "Eingangsbestätigung Ihres Widerrufs",
    `Guten Tag ${input.name},`,
    `Ihr Widerruf ist am ${datumLang(input.eingegangenAt)} um ${uhrzeit(input.eingegangenAt)} Uhr über die Widerrufsfunktion in Ihrem Kundenportal bei uns eingegangen.`,
    [
      "Inhalt Ihrer Erklärung:",
      "Hiermit widerrufe ich den Vertrag.",
      `Name: ${input.name}`,
      `Vertrag: ${input.vertrag}`,
      `Eingangsbestätigung ${input.kanalText}`,
    ].join("\n"),
    "Wie es mit bereits geleisteten Zahlungen weitergeht, richtet sich nach der Widerrufsbelehrung. Wir melden uns dazu bei Ihnen.",
    `Freundliche Grüße\n${input.firma}`,
  ].join("\n\n");
}

export function teamAlarmWiderrufText(input: {
  dealNumber: string;
  name: string;
  eingegangenAt: Date;
  preisCents: number;
  vorzeitigerBeginn: boolean;
}): string {
  return [
    `Widerruf eingegangen: Auftrag ${input.dealNumber}, ${input.name}, ${euro(input.preisCents)}, am ${datumLang(input.eingegangenAt)} um ${uhrzeit(input.eingegangenAt)} Uhr über das Kundenportal.`,
    "Die Annahme ist aufgehoben. Termin freigeben und die Rückzahlung bereits gezahlter Beträge binnen 14 Tagen veranlassen.",
    input.vorzeitigerBeginn
      ? "Der Kunde hatte den Beginn vor Fristende verlangt: Für schon erbrachte Leistungen steht uns anteiliger Wertersatz zu."
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function bestaetigungFehlgeschlagenText(input: { dealNumber: string; name: string; ziel: string }): string {
  return `Achtung, Widerruf Auftrag ${input.dealNumber} (${input.name}): Die Eingangsbestätigung ging nicht raus. Bitte unverzüglich selbst schicken, gewünscht war: ${input.ziel}. Das System versucht es noch zweimal.`;
}

function maskiere(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const lokal = email.slice(0, at);
  if (lokal.length <= 2) return `${lokal[0]}…${email.slice(at)}`;
  return `${lokal[0]}${lokal[1]}…${lokal[lokal.length - 1]}${email.slice(at)}`;
}

// ─── Portal-Kontext ───────────────────────────────────────────────────────────

const KEIN_WIDERRUF: WiderrufKontext = {
  aktiv: false,
  fristEnde: null,
  name: null,
  vertrag: null,
  emailMaskiert: null,
  whatsapp: false,
  annahmeAm: null,
  eingegangen: null,
};

/**
 * Was das Portal zum Widerruf zeigt: den Button während der Frist oder den
 * Hinweis auf einen eingegangenen Widerruf. Die E-Mail ist die, an die
 * wirklich gesendet würde; WhatsApp nur, wenn der Chat der Kundenperson
 * eine Nachricht annimmt.
 */
export async function ladeWiderrufKontext(input: {
  workspaceId: string;
  dealRecordId: string;
  dealNumber: string;
  kundeName: string | null;
  /** Leistung laut Zeiterfassung vollständig erbracht. */
  leistungErbracht: boolean;
  aufgehobenAm: Date | null;
  now: Date;
}): Promise<WiderrufKontext> {
  const annahme = await ladeAktiveAnnahme(input.dealRecordId);
  if (annahme) {
    const aktiv = widerrufsfunktionAktiv({
      widerrufModus: annahme.widerrufModus as WiderrufModus | null,
      signedAt: annahme.signedAt,
      now: input.now,
      vorzeitigerBeginnVerlangt: annahme.vorzeitigerBeginnVerlangt,
      leistungErbracht: input.leistungErbracht,
    });
    if (!aktiv) return KEIN_WIDERRUF;
    const email = await loadCustomerEmail(input.workspaceId, input.dealRecordId).catch(() => null);
    return {
      aktiv: true,
      fristEnde: widerrufsfristEnde(annahme.signedAt),
      name: annahme.acceptedFullName || input.kundeName,
      vertrag: widerrufVertragText({ dealNumber: input.dealNumber, serviceType: annahme.serviceType, signedAt: annahme.signedAt }),
      emailMaskiert: email ? maskiere(email) : null,
      whatsapp: !!(await ladeKundenWaThread(input.workspaceId, input.dealRecordId).catch(() => null)),
      annahmeAm: annahme.signedAt.toISOString(),
      eingegangen: null,
    };
  }
  if (!input.aufgehobenAm) return KEIN_WIDERRUF;
  try {
    // Nur wenn die zuletzt aufgehobene Annahme die widerrufene ist (nicht ein Admin-Aufheben danach).
    const [letzte] = await db
      .select({ id: kvaConfirmations.id })
      .from(kvaConfirmations)
      .where(and(eq(kvaConfirmations.dealRecordId, input.dealRecordId), isNotNull(kvaConfirmations.supersededAt)))
      .orderBy(desc(kvaConfirmations.supersededAt))
      .limit(1);
    if (!letzte) return KEIN_WIDERRUF;
    const [w] = await db
      .select({ eingegangenAt: kvaWiderrufe.eingegangenAt, vertrag: kvaWiderrufe.vertrag })
      .from(kvaWiderrufe)
      .where(eq(kvaWiderrufe.confirmationId, letzte.id))
      .limit(1);
    if (!w) return KEIN_WIDERRUF;
    return { ...KEIN_WIDERRUF, eingegangen: { at: w.eingegangenAt.toISOString(), vertrag: w.vertrag } };
  } catch (err) {
    console.error("[kva-widerruf] Widerruf nicht lesbar:", err);
    return KEIN_WIDERRUF;
  }
}

// ─── Einreichen ───────────────────────────────────────────────────────────────

export type WiderrufErgebnis =
  | { ok: true; eingegangenAt: string; nachlauf: () => Promise<void> }
  | {
      ok: false;
      reason:
        | "invalid_token"
        | "not_found"
        | "revoked"
        | "keine_annahme"
        | "kein_widerrufsrecht"
        | "angebot_geaendert"
        | "frist_abgelaufen"
        | "kanal_unavailable";
    };

const AUFHEBUNGSGRUND = "Widerruf durch den Kunden über das Kundenportal (§ 356a BGB)";

class AnnahmeSchonAufgehoben extends Error {}

export async function widerrufFuerToken(
  token: string,
  payload: WiderrufPayload,
  req: { ipAddress: string; userAgent: string }
): Promise<WiderrufErgebnis> {
  if (!validateTokenShape(token)) return { ok: false, reason: "invalid_token" };
  const [link] = await db.select().from(customerStatusLinks).where(eq(customerStatusLinks.token, token)).limit(1);
  if (!link) return { ok: false, reason: "not_found" };
  const now = new Date();
  if (link.revokedAt || (link.expiresAt != null && link.expiresAt < now)) return { ok: false, reason: "revoked" };

  const annahme = await ladeAktiveAnnahme(link.dealRecordId);
  if (!annahme) {
    // Doppelklick: Der Widerruf ist schon da. Was fehlt (Bestätigung, Alarm), holt der Nachlauf nach.
    const [schon] = await db
      .select()
      .from(kvaWiderrufe)
      .where(eq(kvaWiderrufe.dealRecordId, link.dealRecordId))
      .orderBy(desc(kvaWiderrufe.eingegangenAt))
      .limit(1);
    if (schon && now.getTime() - schon.eingegangenAt.getTime() < 60 * 60 * 1000) {
      return { ok: true, eingegangenAt: schon.eingegangenAt.toISOString(), nachlauf: () => widerrufNachlauf(schon.id) };
    }
    return { ok: false, reason: "keine_annahme" };
  }
  if (annahme.widerrufModus !== "belehrung") return { ok: false, reason: "kein_widerrufsrecht" };
  // Der Dialog zeigte eine andere Annahme (inzwischen aufgehoben und neu angenommen).
  if (payload.annahmeAm && payload.annahmeAm !== annahme.signedAt.toISOString()) {
    return { ok: false, reason: "angebot_geaendert" };
  }

  const ctx = await loadContextByToken(token);
  if (!ctx) return { ok: false, reason: "not_found" };
  // Gleiche Regel wie der Button: Frist mit Kulanz, erloschen nach erbrachter Leistung.
  if (!ctx.widerruf.aktiv) return { ok: false, reason: "frist_abgelaufen" };
  const bekannteEmail = payload.kanal === "email" ? await loadCustomerEmail(link.workspaceId, link.dealRecordId) : null;
  if (!kanalVerfuegbar(payload.kanal, { emailBekannt: !!bekannteEmail, whatsapp: ctx.widerruf.whatsapp })) {
    return { ok: false, reason: "kanal_unavailable" };
  }

  const vertrag = widerrufVertragText({ dealNumber: ctx.dealNumber, serviceType: annahme.serviceType, signedAt: annahme.signedAt });
  let neu: typeof kvaWiderrufe.$inferSelect | null = null;
  try {
    neu = await db.transaction(async (tx) => {
      const [zeile] = await tx
        .insert(kvaWiderrufe)
        .values({
          workspaceId: link.workspaceId,
          dealRecordId: link.dealRecordId,
          confirmationId: annahme.id,
          name: payload.name,
          vertrag,
          kanal: payload.kanal,
          email: payload.kanal === "whatsapp" ? null : (payload.email ?? bekannteEmail),
          eingegangenAt: now,
          ipAddress: req.ipAddress.slice(0, 200),
          userAgent: req.userAgent.slice(0, 1000),
        })
        .onConflictDoNothing({ target: kvaWiderrufe.confirmationId })
        .returning();
      if (!zeile) return null;
      const aufgehoben = await tx
        .update(kvaConfirmations)
        .set({ supersededAt: now, supersededBy: "kunde", supersededReason: AUFHEBUNGSGRUND })
        .where(and(eq(kvaConfirmations.id, annahme.id), isNull(kvaConfirmations.supersededAt)))
        .returning({ id: kvaConfirmations.id });
      // Ein Admin hat die Annahme gerade aufgehoben: nichts speichern.
      if (aufgehoben.length === 0) throw new AnnahmeSchonAufgehoben();
      return zeile;
    });
  } catch (err) {
    if (err instanceof AnnahmeSchonAufgehoben) return { ok: false, reason: "keine_annahme" };
    throw err;
  }

  if (!neu) {
    // Paralleler Klick hat gewonnen.
    const [gewinner] = await db.select().from(kvaWiderrufe).where(eq(kvaWiderrufe.confirmationId, annahme.id)).limit(1);
    if (!gewinner) return { ok: false, reason: "keine_annahme" };
    return { ok: true, eingegangenAt: gewinner.eingegangenAt.toISOString(), nachlauf: () => widerrufNachlauf(gewinner.id) };
  }

  const zeile = neu;
  await emitEvent({
    workspaceId: link.workspaceId,
    recordId: link.dealRecordId,
    objectSlug: "deals",
    eventType: "customer.kva_widerrufen",
    payload: { widerrufId: zeile.id, confirmationId: annahme.id, kanal: payload.kanal, ipAddress: req.ipAddress.slice(0, 200) },
  }).catch((err) => console.error("[kva-widerruf] Event fehlgeschlagen:", err));

  return { ok: true, eingegangenAt: now.toISOString(), nachlauf: () => widerrufNachlauf(zeile.id) };
}

// ─── Nachlauf: Team-Alarm und Eingangsbestätigung ─────────────────────────────

type WiderrufRow = typeof kvaWiderrufe.$inferSelect;
const MAX_VERSUCHE = 3;

interface NachlaufInfo {
  firma: string;
  dealNumber: string;
  preisCents: number;
  vorzeitigerBeginn: boolean;
}

async function ladeNachlaufInfo(row: WiderrufRow): Promise<NachlaufInfo> {
  const info: NachlaufInfo = { firma: "", dealNumber: row.dealRecordId.slice(0, 8), preisCents: 0, vorzeitigerBeginn: false };
  try {
    const [annahme] = await db
      .select({ linkId: kvaConfirmations.customerLinkId, preis: kvaConfirmations.confirmedTotalCents, vorzeitig: kvaConfirmations.vorzeitigerBeginnVerlangt })
      .from(kvaConfirmations)
      .where(eq(kvaConfirmations.id, row.confirmationId))
      .limit(1);
    if (!annahme) return info;
    info.preisCents = annahme.preis;
    info.vorzeitigerBeginn = annahme.vorzeitig;
    const [link] = await db.select({ token: customerStatusLinks.token }).from(customerStatusLinks).where(eq(customerStatusLinks.id, annahme.linkId)).limit(1);
    const ctx = link ? await loadContextByToken(link.token) : null;
    if (ctx) {
      info.firma = ctx.branding.displayName;
      info.dealNumber = ctx.dealNumber;
    }
  } catch (err) {
    console.error("[kva-widerruf] Daten für den Nachlauf fehlen:", err);
  }
  return info;
}

/** Alarm und Aufgabe ans Team, genau einmal. Scheitert der Alarm, holt der Cron nach. */
async function teamAlarm(row: WiderrufRow, info: NachlaufInfo): Promise<void> {
  const [beansprucht] = await db
    .update(kvaWiderrufe)
    .set({ teamAlarmAt: new Date() })
    .where(and(eq(kvaWiderrufe.id, row.id), isNull(kvaWiderrufe.teamAlarmAt)))
    .returning({ id: kvaWiderrufe.id });
  if (!beansprucht) return;
  const text = teamAlarmWiderrufText({
    dealNumber: info.dealNumber,
    name: row.name,
    eingegangenAt: row.eingegangenAt,
    preisCents: info.preisCents,
    vorzeitigerBeginn: info.vorzeitigerBeginn,
  });
  try {
    await sendeAnInterne(row.workspaceId, text, { nachholen: true });
  } catch (err) {
    console.error("[kva-widerruf] Team-Alarm fehlgeschlagen:", err);
    await db.update(kvaWiderrufe).set({ teamAlarmAt: null }).where(eq(kvaWiderrufe.id, row.id));
    return;
  }
  try {
    await adminAufgabe(row.workspaceId, row.dealRecordId, `Widerruf bearbeiten: Auftrag ${info.dealNumber}`, text);
  } catch (err) {
    console.error("[kva-widerruf] Aufgabe fehlgeschlagen:", err);
  }
}

/** Nur eine Ausführung sendet; eine hängengebliebene wird nach 10 Minuten frei. Höchstens drei Versuche. */
async function versandBeanspruchen(id: string): Promise<WiderrufRow | null> {
  const [row] = await db
    .update(kvaWiderrufe)
    .set({
      bestaetigungKanaele: "sending",
      bestaetigungSentAt: new Date(),
      bestaetigungVersuche: sql`${kvaWiderrufe.bestaetigungVersuche} + 1`,
    })
    .where(
      and(
        eq(kvaWiderrufe.id, id),
        lt(kvaWiderrufe.bestaetigungVersuche, MAX_VERSUCHE),
        or(
          isNull(kvaWiderrufe.bestaetigungSentAt),
          and(
            eq(kvaWiderrufe.bestaetigungKanaele, "sending"),
            lt(kvaWiderrufe.bestaetigungSentAt, sql`now() - interval '10 minutes'`)
          )
        )
      )
    )
    .returning();
  return row ?? null;
}

async function wegSenden(row: WiderrufRow, weg: BestaetigungsWeg, text: string, dealNumber: string): Promise<boolean> {
  try {
    if (weg.art === "whatsapp") {
      const thread = await ladeKundenWaThread(row.workspaceId, row.dealRecordId);
      if (!thread) return false;
      await sendeWhatsAppText(row.workspaceId, thread, text);
      return true;
    }
    const transport = await resolveCustomerEmailTransport(row.workspaceId, row.dealRecordId, true, weg.an);
    if (!transport.ok) return false;
    await sendNewEmail({
      workspaceId: row.workspaceId,
      channelAccountId: transport.account.id,
      dealRecordId: row.dealRecordId,
      to: weg.an,
      subject: `Eingangsbestätigung Ihres Widerrufs, Auftrag ${dealNumber}`,
      body: text,
    });
    return true;
  } catch (err) {
    console.error(`[kva-widerruf] Eingangsbestätigung per ${weg.art} fehlgeschlagen:`, err);
    return false;
  }
}

async function eingangBestaetigen(widerrufId: string, info: NachlaufInfo): Promise<void> {
  const row = await versandBeanspruchen(widerrufId);
  if (!row) return;
  const text = eingangsbestaetigungText({
    firma: info.firma,
    name: row.name,
    vertrag: row.vertrag,
    kanalText: kanalText(row.kanal, row.email),
    eingegangenAt: row.eingegangenAt,
  });
  const bekannteEmail = row.kanal === "whatsapp" ? await loadCustomerEmail(row.workspaceId, row.dealRecordId).catch(() => null) : null;
  const kanaele: string[] = [];
  for (const weg of bestaetigungsWege({ kanal: row.kanal, email: row.email, bekannteEmail })) {
    if (await wegSenden(row, weg, text, info.dealNumber)) kanaele.push(weg.art);
  }
  await db
    .update(kvaWiderrufe)
    .set(kanaele.length > 0 ? { bestaetigungSentAt: new Date(), bestaetigungKanaele: kanaele.join(",") } : { bestaetigungSentAt: null, bestaetigungKanaele: null })
    .where(eq(kvaWiderrufe.id, row.id));
  // Beim ersten Fehlschlag sofort Bescheid geben; die weiteren Versuche laufen still.
  if (kanaele.length === 0 && row.bestaetigungVersuche === 1) {
    await sendeAnInterne(
      row.workspaceId,
      bestaetigungFehlgeschlagenText({ dealNumber: info.dealNumber, name: row.name, ziel: kanalText(row.kanal, row.email) }),
      { nachholen: true }
    ).catch((err) => console.error("[kva-widerruf] Fehler-Alarm fehlgeschlagen:", err));
  }
}

/** Alarm und Eingangsbestätigung, unabhängig voneinander. Wirft nie. */
export async function widerrufNachlauf(widerrufId: string): Promise<void> {
  let row: WiderrufRow | undefined;
  try {
    [row] = await db.select().from(kvaWiderrufe).where(eq(kvaWiderrufe.id, widerrufId)).limit(1);
  } catch (err) {
    console.error("[kva-widerruf] Widerruf nicht lesbar:", err);
    return;
  }
  if (!row) return;
  const info = await ladeNachlaufInfo(row);
  const ergebnisse = await Promise.allSettled([teamAlarm(row, info), eingangBestaetigen(row.id, info)]);
  for (const e of ergebnisse) {
    if (e.status === "rejected") console.error("[kva-widerruf] Nachlauf fehlgeschlagen:", e.reason);
  }
}

/**
 * Cron: liegengebliebene Alarme und Bestätigungen der letzten 7 Tage
 * nachholen. Zwei Minuten Abstand, damit after() erst selbst laufen kann.
 */
export async function widerrufeNachholen(): Promise<number> {
  const offen = await db
    .select({ id: kvaWiderrufe.id })
    .from(kvaWiderrufe)
    .where(
      and(
        sql`${kvaWiderrufe.eingegangenAt} > now() - interval '7 days'`,
        sql`${kvaWiderrufe.eingegangenAt} < now() - interval '2 minutes'`,
        or(
          isNull(kvaWiderrufe.teamAlarmAt),
          and(
            lt(kvaWiderrufe.bestaetigungVersuche, MAX_VERSUCHE),
            or(
              isNull(kvaWiderrufe.bestaetigungSentAt),
              and(
                eq(kvaWiderrufe.bestaetigungKanaele, "sending"),
                lt(kvaWiderrufe.bestaetigungSentAt, sql`now() - interval '10 minutes'`)
              )
            )
          )
        )
      )
    )
    .limit(20);
  for (const { id } of offen) await widerrufNachlauf(id);
  return offen.length;
}
