/**
 * Widerruf über den Portal-Button (§ 356a BGB): Erklärung speichern, Annahme
 * aufheben, Eingangsbestätigung an den Kunden (Abs. 4), Alarm ans Team.
 * Der Eingang zählt, auch wenn die Bestätigung scheitert; dann meldet der
 * Team-Alarm, dass sie von Hand raus muss.
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
import { adminAufgabe, ladeWaThread, sendeWhatsAppText } from "./kva-bestaetigung";
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
    "Bereits geleistete Zahlungen erstatten wir nach den Regeln der Widerrufsbelehrung. Wir melden uns dazu bei Ihnen.",
    `Freundliche Grüße\n${input.firma}`,
  ].join("\n\n");
}

export function teamAlarmWiderrufText(input: {
  dealNumber: string;
  name: string;
  eingegangenAt: Date;
  bestaetigt: boolean;
  preisCents: number;
  vorzeitigerBeginn: boolean;
}): string {
  return [
    `Widerruf eingegangen: Auftrag ${input.dealNumber}, ${input.name}, ${euro(input.preisCents)}, am ${datumLang(input.eingegangenAt)} um ${uhrzeit(input.eingegangenAt)} Uhr über das Kundenportal.`,
    "Die Annahme ist aufgehoben. Termin freigeben und die Rückzahlung bereits gezahlter Beträge binnen 14 Tagen veranlassen.",
    input.vorzeitigerBeginn
      ? "Der Kunde hatte den Beginn vor Fristende verlangt: Für schon erbrachte Leistungen steht uns anteiliger Wertersatz zu."
      : null,
    input.bestaetigt ? null : "Achtung: Die Eingangsbestätigung ging nicht raus. Bitte selbst an den Kunden schicken.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Portal-Kontext ───────────────────────────────────────────────────────────

const KEIN_WIDERRUF: WiderrufKontext = {
  aktiv: false,
  fristEnde: null,
  name: null,
  vertrag: null,
  emailMaskiert: null,
  whatsapp: false,
  eingegangen: null,
};

/**
 * Was das Portal zum Widerruf zeigt: den Button während der Frist oder den
 * Hinweis auf einen eingegangenen Widerruf. Fehlt die Tabelle (Migration
 * noch nicht gelaufen), zeigt das Portal einfach keinen Eingang.
 */
export async function ladeWiderrufKontext(input: {
  workspaceId: string;
  dealRecordId: string;
  dealNumber: string;
  kundeName: string | null;
  emailMaskiert: string | null;
  aufgehobenAm: Date | null;
  now: Date;
}): Promise<WiderrufKontext> {
  const annahme = await ladeAktiveAnnahme(input.dealRecordId);
  if (annahme) {
    const aktiv = widerrufsfunktionAktiv({
      widerrufModus: annahme.widerrufModus as WiderrufModus | null,
      signedAt: annahme.signedAt,
      now: input.now,
    });
    if (!aktiv) return KEIN_WIDERRUF;
    return {
      aktiv: true,
      fristEnde: widerrufsfristEnde(annahme.signedAt),
      name: annahme.acceptedFullName || input.kundeName,
      vertrag: widerrufVertragText({ dealNumber: input.dealNumber, serviceType: annahme.serviceType, signedAt: annahme.signedAt }),
      emailMaskiert: input.emailMaskiert,
      whatsapp: !!(await ladeWaThread(input.workspaceId, input.dealRecordId).catch(() => null)),
      eingegangen: null,
    };
  }
  if (!input.aufgehobenAm) return KEIN_WIDERRUF;
  try {
    // Nur wenn die letzte Aufhebung der Widerruf war (nicht ein Admin-Aufheben danach).
    const [w] = await db
      .select({ eingegangenAt: kvaWiderrufe.eingegangenAt, vertrag: kvaWiderrufe.vertrag })
      .from(kvaWiderrufe)
      .innerJoin(kvaConfirmations, eq(kvaWiderrufe.confirmationId, kvaConfirmations.id))
      .where(and(eq(kvaWiderrufe.dealRecordId, input.dealRecordId), eq(kvaConfirmations.supersededAt, input.aufgehobenAm)))
      .orderBy(desc(kvaWiderrufe.eingegangenAt))
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
  | { ok: true; eingegangenAt: string; nachlauf: (() => Promise<void>) | null }
  | { ok: false; reason: "invalid_token" | "not_found" | "revoked" | "keine_annahme" | "frist_abgelaufen" | "kanal_unavailable" };

const AUFHEBUNGSGRUND = "Widerruf durch den Kunden über das Kundenportal (§ 356a BGB)";

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
    // Doppelklick: Der Widerruf ist schon da. Fehlt die Bestätigung, holen wir sie nach.
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
  if (!widerrufsfunktionAktiv({ widerrufModus: annahme.widerrufModus as WiderrufModus | null, signedAt: annahme.signedAt, now })) {
    return { ok: false, reason: "frist_abgelaufen" };
  }

  const ctx = await loadContextByToken(token);
  if (!ctx) return { ok: false, reason: "not_found" };
  const bekannteEmail = payload.kanal === "email" ? await loadCustomerEmail(link.workspaceId, link.dealRecordId) : null;
  const whatsapp = payload.kanal === "whatsapp" ? !!(await ladeWaThread(link.workspaceId, link.dealRecordId)) : false;
  if (!kanalVerfuegbar(payload.kanal, { emailBekannt: !!bekannteEmail, whatsapp })) {
    return { ok: false, reason: "kanal_unavailable" };
  }

  const vertrag = widerrufVertragText({ dealNumber: ctx.dealNumber, serviceType: annahme.serviceType, signedAt: annahme.signedAt });
  const neu = await db.transaction(async (tx) => {
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
    await tx
      .update(kvaConfirmations)
      .set({ supersededAt: now, supersededBy: "kunde", supersededReason: AUFHEBUNGSGRUND })
      .where(and(eq(kvaConfirmations.id, annahme.id), isNull(kvaConfirmations.supersededAt)));
    return zeile;
  });

  if (!neu) {
    // Paralleler Klick hat gewonnen.
    const [gewinner] = await db.select().from(kvaWiderrufe).where(eq(kvaWiderrufe.confirmationId, annahme.id)).limit(1);
    if (!gewinner) return { ok: false, reason: "keine_annahme" };
    return { ok: true, eingegangenAt: gewinner.eingegangenAt.toISOString(), nachlauf: () => widerrufNachlauf(gewinner.id) };
  }

  await emitEvent({
    workspaceId: link.workspaceId,
    recordId: link.dealRecordId,
    objectSlug: "deals",
    eventType: "customer.kva_widerrufen",
    payload: {
      widerrufId: neu.id,
      confirmationId: annahme.id,
      kanal: payload.kanal,
      ipAddress: req.ipAddress.slice(0, 200),
    },
  });

  return { ok: true, eingegangenAt: now.toISOString(), nachlauf: () => widerrufNachlauf(neu.id, { mitTeamAlarm: true }) };
}

// ─── Nachlauf: Eingangsbestätigung und Team-Alarm ─────────────────────────────

type WiderrufRow = typeof kvaWiderrufe.$inferSelect;

/** Nur eine Ausführung sendet; eine hängengebliebene wird nach 10 Minuten frei. */
async function versandBeanspruchen(id: string): Promise<WiderrufRow | null> {
  const [row] = await db
    .update(kvaWiderrufe)
    .set({ bestaetigungKanaele: "sending", bestaetigungSentAt: new Date() })
    .where(
      and(
        eq(kvaWiderrufe.id, id),
        or(
          isNull(kvaWiderrufe.bestaetigungSentAt),
          and(
            eq(kvaWiderrufe.bestaetigungKanaele, "sending"),
            isNotNull(kvaWiderrufe.bestaetigungSentAt),
            lt(kvaWiderrufe.bestaetigungSentAt, sql`now() - interval '10 minutes'`)
          )
        )
      )
    )
    .returning();
  return row ?? null;
}

async function bestaetigungSenden(row: WiderrufRow, firma: string, dealNumber: string): Promise<boolean> {
  const text = eingangsbestaetigungText({
    firma,
    name: row.name,
    vertrag: row.vertrag,
    kanalText: kanalText(row.kanal, row.email),
    eingegangenAt: row.eingegangenAt,
  });
  if (row.kanal === "whatsapp") {
    const thread = await ladeWaThread(row.workspaceId, row.dealRecordId);
    if (!thread) return false;
    await sendeWhatsAppText(row.workspaceId, thread, text);
    return true;
  }
  if (!row.email) return false;
  const transport = await resolveCustomerEmailTransport(row.workspaceId, row.dealRecordId, true, row.email);
  if (!transport.ok) return false;
  await sendNewEmail({
    workspaceId: row.workspaceId,
    channelAccountId: transport.account.id,
    dealRecordId: row.dealRecordId,
    to: row.email,
    subject: `Eingangsbestätigung Ihres Widerrufs, Auftrag ${dealNumber}`,
    body: text,
  });
  return true;
}

/** Wirft nie; jeder Schritt hat seinen eigenen Fehlerfang. */
export async function widerrufNachlauf(widerrufId: string, opts: { mitTeamAlarm?: boolean } = {}): Promise<void> {
  let row: WiderrufRow | null = null;
  try {
    row = await versandBeanspruchen(widerrufId);
  } catch (err) {
    console.error("[kva-widerruf] Beanspruchen fehlgeschlagen:", err);
  }

  let basis: WiderrufRow | null = row;
  let firma = "";
  let dealNumber = "";
  let preisCents = 0;
  let vorzeitigerBeginn = false;
  try {
    if (!basis) [basis] = await db.select().from(kvaWiderrufe).where(eq(kvaWiderrufe.id, widerrufId)).limit(1);
    if (!basis) return;
    const [annahme] = await db
      .select({ linkId: kvaConfirmations.customerLinkId, preis: kvaConfirmations.confirmedTotalCents, vorzeitig: kvaConfirmations.vorzeitigerBeginnVerlangt })
      .from(kvaConfirmations)
      .where(eq(kvaConfirmations.id, basis.confirmationId))
      .limit(1);
    preisCents = annahme?.preis ?? 0;
    vorzeitigerBeginn = annahme?.vorzeitig ?? false;
    const [link] = annahme
      ? await db.select({ token: customerStatusLinks.token }).from(customerStatusLinks).where(eq(customerStatusLinks.id, annahme.linkId)).limit(1)
      : [];
    const ctx = link ? await loadContextByToken(link.token) : null;
    firma = ctx?.branding.displayName ?? "";
    dealNumber = ctx?.dealNumber ?? basis.dealRecordId.slice(0, 8);
  } catch (err) {
    console.error("[kva-widerruf] Daten für die Bestätigung fehlen:", err);
  }
  if (!basis) return;

  // Nicht beansprucht: Ein anderer Lauf hat schon gesendet (oder sendet gerade).
  let bestaetigt = !row && !!basis.bestaetigungSentAt && basis.bestaetigungKanaele !== "sending";
  if (row) {
    try {
      bestaetigt = await bestaetigungSenden(row, firma, dealNumber);
    } catch (err) {
      console.error("[kva-widerruf] Eingangsbestätigung fehlgeschlagen:", err);
      bestaetigt = false;
    }
    try {
      await db
        .update(kvaWiderrufe)
        .set(bestaetigt ? { bestaetigungSentAt: new Date(), bestaetigungKanaele: row.kanal } : { bestaetigungSentAt: null, bestaetigungKanaele: null })
        .where(eq(kvaWiderrufe.id, row.id));
    } catch (err) {
      console.error("[kva-widerruf] Versandstatus nicht gespeichert:", err);
    }
  }

  if (!opts.mitTeamAlarm) return;
  const text = teamAlarmWiderrufText({ dealNumber, name: basis.name, eingegangenAt: basis.eingegangenAt, bestaetigt, preisCents, vorzeitigerBeginn });
  try {
    await sendeAnInterne(basis.workspaceId, text, { nachholen: true });
  } catch (err) {
    console.error("[kva-widerruf] Team-Alarm fehlgeschlagen:", err);
  }
  try {
    await adminAufgabe(basis.workspaceId, basis.dealRecordId, `Widerruf bearbeiten: Auftrag ${dealNumber}`, text);
  } catch (err) {
    console.error("[kva-widerruf] Aufgabe fehlgeschlagen:", err);
  }
}
