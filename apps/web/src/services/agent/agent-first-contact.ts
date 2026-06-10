/**
 * Sales agent first-contact engine (proactive ImmoScout outreach).
 *
 * ImmoScout sells every Umzugsanfrage to up to 5 competing movers, and the
 * lead-response research (Oldroyd/HBR 2011, XANT 2021) shows contact and
 * qualification odds collapse within minutes. IS24 leads arrive from a noreply
 * sender, so the reply agent can never engage them; this engine opens the
 * conversation instead: one short WhatsApp message in the brand's name that
 * references the customer's own inquiry, asks exactly ONE easy question and
 * proposes a phone call with two concrete slots.
 *
 * Safety model (the 2026-06-03 live-run audit, in order of what failed then):
 *  - Watermark: only leads CREATED AFTER the switch was flipped on are ever
 *    touched (sales_first_contact_enabled_at), plus a hard 48h freshness bound.
 *    Enabling the feature can never blast a stale backlog.
 *  - Atomic claim: the firstContact marker is set with a conditional UPDATE on
 *    the payload row, so overlapping cron ticks can never double-send.
 *  - One first contact per lead, ever. Existing WhatsApp conversations with the
 *    same number are skipped (the reply agent owns ongoing threads).
 *  - Brand from the configured channel account's operating company, never from
 *    the model.
 *  - Past move dates are skipped; messages with prices are blocked before send.
 *  - Send window 08:00-20:00 Europe/Berlin (Sun 10:00-19:00); leads arriving at
 *    night are contacted the next morning.
 *  - Daily cap + per-tick cap; honors the workspace dry-run flag (default ON).
 *  - Legal: strictly transactional wording (answer to the customer's own
 *    inquiry, §7 UWG), deterministic opt-out line, optional AI disclosure
 *    (EU AI Act Art. 50), STOP replies silence the agent via DECLINE_PATTERNS.
 */

import { db } from "@/db";
import { and, asc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { records, recordValues } from "@/db/schema/records";
import { attributes } from "@/db/schema/objects";
import { inboxConversations, channelAccounts } from "@/db/schema/inbox";
import { activityEvents } from "@/db/schema";
import { z } from "zod";
import { runAITask, humanizeGerman } from "@/services/ai/run-task";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
import { emitEvent } from "@/services/activity-events";
import { sendPush } from "@/services/push";
import { getObjectBySlug } from "@/services/objects";
import { canonicalizePhone } from "@/lib/identity/canonical";
import { sendBaileysFirstMessage, sendWhatsAppTemplate } from "@/services/inbox-whatsapp";
import {
  isFirstContactEnabled,
  getFirstContactEnabledAt,
  getFirstContactChannelAccountId,
  getFirstContactTemplate,
  getFirstContactTemplateParams,
  getFirstContactDailyCap,
  isSalesAgentDryRun,
  getAgentSignature,
  isDiscloseAiEnabled,
  getAgentDisclosure,
} from "./agent-config";
import {
  appendSignature,
  ownerUserIds,
  withDisclosure,
  resolveBrandSignature,
} from "./agent-shared";

const MAX_PER_TICK = 5;
// Never contact leads older than this, regardless of the enable watermark. By
// then the speed advantage is gone and the thread belongs to a human.
const MAX_LEAD_AGE_MS = 48 * 60 * 60 * 1000;
// A 'claimed' marker older than this is a crashed tick; retry once.
const STALE_CLAIM_MS = 15 * 60 * 1000;

// Deterministic opt-out, appended to every live free-form first message. An
// objection is absolute (Art. 21 DSGVO), so the wording must make it trivial.
const OPT_OUT_LINE =
  "PS: Wenn Sie keine Nachrichten von uns möchten, antworten Sie einfach mit STOP.";

export interface FirstContactRunSummary {
  enabledWorkspaces: number;
  candidates: number;
  sent: number;
  dryRunPreviews: number;
  skipped: number;
  blocked: number;
  errors: number;
  outsideWindow: number;
  capReached: number;
}

const FirstContactSchema = z.object({
  message_de: z.string().default(""),
  reason: z.string().default(""),
});

const FIRST_CONTACT_SYSTEM = `Du bist Mitarbeiter im Vertrieb eines Umzugsunternehmens (kein Chatbot). Ein Interessent hat soeben über ImmobilienScout24 eine Umzugsanfrage gestellt und dabei seine Telefonnummer angegeben. Du schreibst ihm jetzt die ALLERERSTE WhatsApp-Nachricht im Namen der Firma. Bis zu 4 Mitbewerber erhalten dieselbe Anfrage; wer zuerst ein gutes Gespräch eröffnet, gewinnt meistens.

STIL
- Deutsch, Sie-Form, warm und professionell, 50 bis 80 Wörter, 3 bis 5 kurze Zeilen.
- Keine Gedankenstriche, keine Emojis, keine Bot-Floskeln ("Gerne helfen wir Ihnen weiter!"), keine Werbesprache (keine Rabatte, kein "bestes Angebot", keine Superlative).
- Erfinde KEINEN menschlichen Namen und gib dich nicht als bestimmte Person aus. Signatur und Pflichthinweise werden separat angehängt.

AUFBAU (genau diese Reihenfolge)
1. Anrede (mit Nachnamen, falls bekannt, sonst "Guten Tag").
2. Bezug: Sie haben gerade über ImmobilienScout24 eine Umzugsanfrage gestellt. Nenne 1 bis 2 konkrete Details aus der Anfrage (Strecke, Termin), damit klar ist, dass es um IHRE Anfrage geht.
3. GENAU EINE leicht beantwortbare Frage. Erlaubt ist nur eine dieser zwei Formen:
   a) Telefonat vorschlagen mit den beiden unten vorgegebenen Zeitfenstern als A/B-Wahl, plus Ausweg ("oder schreiben Sie mir einfach hier, was Ihnen lieber ist").
   b) Die EINE wichtigste fehlende Angabe als geschlossene, kurze Frage (z.B. "Steht der Termin am 15.07. schon fest, oder sind Sie noch flexibel?").
   Wenn ein Telefonat sinnvoll ist (es fehlen mehrere Angaben oder alles liegt schon vor), nimm Form a.

HARTE REGELN
- NENNE NIEMALS EINEN PREIS, keine Preisspanne, keine Stundensätze. Kein Angebot, keine Rabatte.
- Versprich keine Verfügbarkeit und bestätige keinen Termin.
- Nur Inhalte, die sich direkt auf DIESE Anfrage beziehen (rechtlich Pflicht: reine Anfrage-Antwort, keine Werbung).
- Schlage NIE ein Datum in der Vergangenheit vor.

AUSGABE: NUR ein JSON-Objekt { message_de, reason }. message_de ist die fertige Nachricht ohne Signatur.`;

// ── Berlin-time helpers ──────────────────────────────────────────────────────

function berlinHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      hour: "numeric",
      hour12: false,
    }).format(now)
  );
}

/** 0 = Sunday ... 6 = Saturday, in Europe/Berlin. */
function berlinWeekday(now: Date): number {
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    weekday: "short",
  }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

/** YYYY-MM-DD in Europe/Berlin (en-CA locale formats exactly like that). */
function berlinDayKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Proactive outreach window: Mon-Sat 08-20, Sun 10-19 (Europe/Berlin). */
function isWithinSendWindow(now: Date): boolean {
  const hour = berlinHour(now);
  const weekday = berlinWeekday(now);
  if (weekday === 0) return hour >= 10 && hour < 19;
  return hour >= 8 && hour < 20;
}

/** Two concrete call slots (alternative-choice close), never on a Sunday. */
function proposeCallSlots(now: Date): [string, string] {
  const hour = berlinHour(now);
  const weekday = berlinWeekday(now);
  // Saturday: tomorrow is Sunday, so push to Monday. Sunday: propose Monday.
  const nextDay = weekday === 6 ? "am Montag" : "morgen";
  if (weekday === 0) {
    return ["morgen zwischen 10 und 12 Uhr", "morgen zwischen 16 und 18 Uhr"];
  }
  if (hour < 15) {
    return ["heute zwischen 16 und 18 Uhr", `${nextDay} zwischen 10 und 12 Uhr`];
  }
  if (hour < 18) {
    return ["heute zwischen 18 und 19 Uhr", `${nextDay} zwischen 10 und 12 Uhr`];
  }
  return [`${nextDay} zwischen 10 und 12 Uhr`, `${nextDay} zwischen 16 und 18 Uhr`];
}

// ── Payload reading ──────────────────────────────────────────────────────────

interface MovingLeadPayload {
  externalId?: string;
  leadType?: string;
  premiumLead?: boolean;
  client?: {
    salutation?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    phone2?: string;
  };
  from?: {
    street?: string;
    zip?: string;
    city?: string;
    floor?: string | number | null;
    livingSpace?: string | number | null;
    elevator?: boolean;
    rooms?: string | number | null;
  };
  to?: {
    street?: string;
    zip?: string;
    city?: string;
    floor?: string | number | null;
    elevator?: boolean;
  };
  dates?: { desiredFrom?: string | null; desiredTo?: string | null };
  ugl?: { volume?: string | number | null };
  distance?: string | number | null;
  firstContact?: { status?: string; at?: string };
}

const LEAD_TYPE_DE: Record<string, string> = {
  umzug: "Umzug",
  fmz: "Fernumzug",
  klavier: "Klaviertransport",
  lager: "Einlagerung",
  beiladung: "Beiladung",
  entruempelung: "Entrümpelung",
};

function fmtDateDe(iso: string | null | undefined): string | null {
  const m = String(iso ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

/**
 * Deterministic gap analysis against the quote-blocking fields: what do we
 * already know from the portal payload, what is still missing? The model gets
 * both lists, so the one question it asks targets the real gap.
 */
function analyzeLead(p: MovingLeadPayload): { facts: string[]; missing: string[] } {
  const facts: string[] = [];
  const missing: string[] = [];

  const typeLabel = LEAD_TYPE_DE[p.leadType ?? ""] ?? "Umzug";
  facts.push(`Art der Anfrage: ${typeLabel}${p.premiumLead ? " (Premium-Anfrage)" : ""}`);

  const fromCity = p.from?.city || p.from?.zip || "";
  const toCity = p.to?.city || p.to?.zip || "";
  if (fromCity || toCity) facts.push(`Strecke: ${fromCity || "?"} nach ${toCity || "?"}`);

  const dateDe = fmtDateDe(p.dates?.desiredFrom);
  if (dateDe) {
    const dateTo = fmtDateDe(p.dates?.desiredTo);
    facts.push(`Wunschtermin: ${dateDe}${dateTo && dateTo !== dateDe ? ` bis ${dateTo}` : ""}`);
  } else {
    missing.push("Wunschtermin");
  }

  if (hasValue(p.from?.livingSpace)) facts.push(`Wohnfläche: ${p.from?.livingSpace} m²`);
  if (hasValue(p.from?.rooms)) facts.push(`Zimmer: ${p.from?.rooms}`);
  if (hasValue(p.ugl?.volume)) facts.push(`Umzugsvolumen: ca. ${p.ugl?.volume} m³`);
  if (!hasValue(p.ugl?.volume) && !hasValue(p.from?.livingSpace) && !hasValue(p.from?.rooms)) {
    missing.push("Umfang (Wohnungsgröße oder Möbelliste)");
  }

  if (!hasValue(p.from?.street)) missing.push("genaue Auszugsadresse");
  if (!hasValue(p.to?.street)) missing.push("genaue Einzugsadresse");
  if (hasValue(p.from?.floor) || p.from?.elevator !== undefined) {
    facts.push(
      `Auszug: Etage ${hasValue(p.from?.floor) ? p.from?.floor : "?"}, Aufzug ${p.from?.elevator ? "ja" : "nein/unbekannt"}`
    );
  } else {
    missing.push("Stockwerk und Aufzug beim Auszug");
  }
  if (hasValue(p.to?.floor) || p.to?.elevator !== undefined) {
    facts.push(
      `Einzug: Etage ${hasValue(p.to?.floor) ? p.to?.floor : "?"}, Aufzug ${p.to?.elevator ? "ja" : "nein/unbekannt"}`
    );
  } else {
    missing.push("Stockwerk und Aufzug beim Einzug");
  }
  if (hasValue(p.distance)) facts.push(`Entfernung: ${p.distance} km`);

  return { facts, missing };
}

// ── Output sanitizing (deterministic, the model can never override) ─────────

const PRICE_RE = /\d{2,6}\s?(€|EUR|Euro)\b/i;

/** No dashes in customer copy: ranges become "bis", asides become commas. */
function stripDashes(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 bis $2")
    .replace(/\s*[–—]\s*/g, ", ");
}

// ── Claim / mark helpers (atomic on the payload row) ─────────────────────────

async function claimLead(rvId: string, nowIso: string, staleCutoffIso: string): Promise<boolean> {
  const claimed = await db
    .update(recordValues)
    .set({
      jsonValue: sql`jsonb_set(${recordValues.jsonValue}, '{firstContact}', jsonb_build_object('status', 'claimed', 'at', ${nowIso}::text), true)`,
    })
    .where(
      and(
        eq(recordValues.id, rvId),
        sql`((${recordValues.jsonValue}->>'firstContact') IS NULL OR (${recordValues.jsonValue}#>>'{firstContact,status}' = 'claimed' AND ${recordValues.jsonValue}#>>'{firstContact,at}' < ${staleCutoffIso}))`
      )
    )
    .returning({ id: recordValues.id });
  return claimed.length > 0;
}

async function markLead(rvId: string, info: Record<string, unknown>): Promise<void> {
  await db
    .update(recordValues)
    .set({
      jsonValue: sql`jsonb_set(${recordValues.jsonValue}, '{firstContact}', ${JSON.stringify(info)}::jsonb, true)`,
    })
    .where(eq(recordValues.id, rvId));
}

// ── Daily cap ────────────────────────────────────────────────────────────────

/** First-contact attempts (live + dry-run) in the last 24h, across the workspace. */
async function attemptsLast24h(workspaceId: string, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activityEvents)
    .where(
      and(
        eq(activityEvents.workspaceId, workspaceId),
        eq(activityEvents.eventType, "agent.action"),
        gte(activityEvents.createdAt, cutoff),
        sql`${activityEvents.payload}->>'action' = 'first_contact'`
      )
    )) as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

// ── Template param substitution (WABA path) ──────────────────────────────────

function buildTemplateParams(
  spec: string,
  p: MovingLeadPayload,
  fullName: string
): string[] {
  const fromCity = p.from?.city || p.from?.zip || "";
  const toCity = p.to?.city || p.to?.zip || "";
  const map: Record<string, string> = {
    "{name}": fullName,
    "{vorname}": p.client?.firstName ?? "",
    "{nachname}": p.client?.lastName ?? "",
    "{von}": fromCity,
    "{nach}": toCity,
    "{route}": fromCity && toCity ? `${fromCity} nach ${toCity}` : fromCity || toCity,
    "{datum}": fmtDateDe(p.dates?.desiredFrom) ?? "",
  };
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      let out = token;
      for (const [k, v] of Object.entries(map)) out = out.split(k).join(v);
      return out;
    });
}

// ── Core run ─────────────────────────────────────────────────────────────────

interface LeadCandidate {
  recordId: string;
  rvId: string;
  payload: MovingLeadPayload;
  createdAt: Date;
}

async function runForWorkspace(
  workspaceId: string,
  now: Date,
  deadlineMs: number,
  summary: FirstContactRunSummary
): Promise<void> {
  if (!(await isFirstContactEnabled(workspaceId))) return;

  const [enabledAt, accountId, dryRun] = await Promise.all([
    getFirstContactEnabledAt(workspaceId),
    getFirstContactChannelAccountId(workspaceId),
    isSalesAgentDryRun(workspaceId),
  ]);
  // Fail-safe: without the enable watermark we cannot bound the backlog, so we
  // refuse to run at all rather than risk a blast.
  if (!enabledAt) {
    console.warn("[agent-first-contact] enabled without watermark, refusing:", workspaceId);
    return;
  }
  if (!accountId) {
    console.warn("[agent-first-contact] no channel account configured:", workspaceId);
    return;
  }
  summary.enabledWorkspaces += 1;

  // Live sends respect the outreach window; dry-run previews may run anytime
  // (they only write timeline events, and the owner tests at night).
  if (!dryRun && !isWithinSendWindow(now)) {
    summary.outsideWindow += 1;
    return;
  }

  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, accountId), eq(channelAccounts.workspaceId, workspaceId)))
    .limit(1);
  if (!account || account.channelType !== "whatsapp") {
    console.warn("[agent-first-contact] configured account missing or not WhatsApp:", accountId);
    return;
  }
  const isWaba = Boolean(account.waPhoneNumberId);
  const templateName = isWaba ? await getFirstContactTemplate(workspaceId) : "";
  if (isWaba && !templateName) {
    console.warn("[agent-first-contact] WABA account but no template configured:", workspaceId);
    return;
  }
  if (!isWaba && account.baileysBridgeProvider !== "inhouse") {
    console.warn("[agent-first-contact] account is neither WABA nor in-house Baileys:", accountId);
    return;
  }

  const dailyCap = await getFirstContactDailyCap(workspaceId);
  const used = await attemptsLast24h(workspaceId, now);
  if (used >= dailyCap) {
    summary.capReached += 1;
    return;
  }
  const budget = Math.min(MAX_PER_TICK, dailyCap - used);

  const dealsObj = await getObjectBySlug(workspaceId, "deals");
  if (!dealsObj) return;
  const [payloadAttr] = await db
    .select({ id: attributes.id })
    .from(attributes)
    .where(and(eq(attributes.objectId, dealsObj.id), eq(attributes.slug, "moving_lead_payload")))
    .limit(1);
  if (!payloadAttr) return;

  const nowIso = now.toISOString();
  const staleCutoffIso = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const freshCutoff = new Date(now.getTime() - MAX_LEAD_AGE_MS);
  const watermark = enabledAt > freshCutoff ? enabledAt : freshCutoff;

  const rows = (await db
    .select({
      recordId: records.id,
      rvId: recordValues.id,
      payload: recordValues.jsonValue,
      createdAt: records.createdAt,
    })
    .from(recordValues)
    .innerJoin(records, eq(records.id, recordValues.recordId))
    .where(
      and(
        eq(records.objectId, dealsObj.id),
        isNull(records.deletedAt),
        eq(recordValues.attributeId, payloadAttr.id),
        sql`${recordValues.jsonValue}->>'source' = 'immoscout24'`,
        gte(records.createdAt, watermark),
        sql`((${recordValues.jsonValue}->>'firstContact') IS NULL OR (${recordValues.jsonValue}#>>'{firstContact,status}' = 'claimed' AND ${recordValues.jsonValue}#>>'{firstContact,at}' < ${staleCutoffIso}))`
      )
    )
    .orderBy(asc(records.createdAt))
    .limit(budget * 3)) as unknown as LeadCandidate[];

  const todayKey = berlinDayKey(now);
  let processed = 0;

  for (const lead of rows) {
    if (processed >= budget) break;
    if (Date.now() > deadlineMs) break;
    try {
      const p = lead.payload ?? {};

      // 1. Usable phone number? (E.164 via the identity layer.)
      const rawPhone = p.client?.phone || p.client?.phone2 || "";
      const e164 = canonicalizePhone(rawPhone, "DE");
      if (!e164) {
        if (await claimLead(lead.rvId, nowIso, staleCutoffIso)) {
          await markLead(lead.rvId, { status: "skipped_no_phone", at: nowIso });
          await emitEvent({
            workspaceId,
            recordId: lead.recordId,
            objectSlug: "deals",
            eventType: "agent.action",
            payload: {
              mode: dryRun ? "dry_run" : "live",
              action: "first_contact",
              channel: "whatsapp",
              message: "",
              reason: "skipped_no_phone: keine nutzbare Telefonnummer im Lead",
            },
            actorId: null,
          });
        }
        summary.skipped += 1;
        continue;
      }

      // 2. Move date sanity: never open a thread about a past move.
      const desired = p.dates?.desiredFrom ?? null;
      if (desired && desired.slice(0, 10) < todayKey) {
        if (await claimLead(lead.rvId, nowIso, staleCutoffIso)) {
          await markLead(lead.rvId, { status: "skipped_past_date", at: nowIso });
        }
        summary.skipped += 1;
        continue;
      }

      // 3. Existing WhatsApp thread with this number on the outreach account?
      // Then we are already in contact; the reply agent owns it.
      const waId = e164.slice(1);
      const [existingConv] = await db
        .select({ id: inboxConversations.id })
        .from(inboxConversations)
        .where(
          and(
            eq(inboxConversations.channelAccountId, account.id),
            or(
              eq(inboxConversations.externalThreadId, waId),
              sql`${inboxConversations.externalThreadId} LIKE ${waId + "@%"}`
            )
          )
        )
        .limit(1);
      if (existingConv) {
        if (await claimLead(lead.rvId, nowIso, staleCutoffIso)) {
          await markLead(lead.rvId, {
            status: "skipped_existing_conversation",
            at: nowIso,
            conversationId: existingConv.id,
          });
        }
        summary.skipped += 1;
        continue;
      }

      // 4. Atomic claim. Whoever wins this UPDATE sends; everyone else stops.
      if (!(await claimLead(lead.rvId, nowIso, staleCutoffIso))) continue;
      processed += 1;
      summary.candidates += 1;

      const fullName =
        `${p.client?.firstName ?? ""} ${p.client?.lastName ?? ""}`.trim() || "Unbekannt";
      const brand = await resolveBrandSignature(
        workspaceId,
        account.operatingCompanyRecordId,
        await getAgentSignature(workspaceId)
      );
      const mode = dryRun ? "dry_run" : "live";

      // ── WABA path: fixed approved template, no LLM. The strategic dialogue
      // starts when the customer replies (24h window opens, reply agent takes
      // over). Legally the cleanest channel.
      if (isWaba) {
        const bodyParams = buildTemplateParams(
          await getFirstContactTemplateParams(workspaceId),
          p,
          fullName
        );
        const preview = `[Template ${templateName}] ${bodyParams.join(" · ")}`;
        if (dryRun) {
          await markLead(lead.rvId, { status: "dry_run", at: nowIso, channel: "waba" });
          await emitEvent({
            workspaceId,
            recordId: lead.recordId,
            objectSlug: "deals",
            eventType: "agent.action",
            payload: { mode, action: "first_contact", channel: "whatsapp", message: preview, reason: "Vorschau (Testlauf): WABA-Template-Erstkontakt" },
            actorId: null,
          });
          summary.dryRunPreviews += 1;
          continue;
        }
        await sendWhatsAppTemplate({
          workspaceId,
          channelAccountId: account.id,
          toPhone: e164,
          customerName: fullName,
          templateName,
          languageCode: "de",
          bodyParams,
          dealRecordId: lead.recordId,
        });
        await markLead(lead.rvId, { status: "sent", at: nowIso, channel: "waba" });
        await emitEvent({
          workspaceId,
          recordId: lead.recordId,
          objectSlug: "deals",
          eventType: "agent.action",
          payload: { mode, action: "first_contact", channel: "whatsapp", message: preview, reason: "WABA-Template-Erstkontakt gesendet" },
          actorId: null,
        });
        await notifyOwners(workspaceId, lead.recordId, fullName, false);
        summary.sent += 1;
        continue;
      }

      // ── Baileys path: free-form strategic opener, composed per lead.
      const { facts, missing } = analyzeLead(p);
      const [slotA, slotB] = proposeCallSlots(now);
      const todayStr = now.toLocaleDateString("de-DE", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const anrede = p.client?.salutation ?? "";
      const prompt = [
        `# Lead-Daten aus der ImmoScout24-Anfrage`,
        `Name: ${anrede ? anrede + " " : ""}${fullName}`,
        ...facts.map((f) => `- ${f}`),
        missing.length
          ? `\n# Noch fehlende Angaben für ein Festpreisangebot\n${missing.map((m) => `- ${m}`).join("\n")}`
          : `\n# Es liegen bereits alle wichtigen Angaben vor.`,
        `\n# Vorgegebene Telefon-Zeitfenster (nur diese verwenden)`,
        `- Option A: ${slotA}`,
        `- Option B: ${slotB}`,
        `\nSchreibe jetzt die Erstnachricht und liefere das JSON.`,
      ].join("\n");

      const result = await runAITask({
        workspaceId,
        taskSlug: AI_TASK_SLUGS.LEAD_FIRST_CONTACT,
        system: `Heute ist ${todayStr}. Du schreibst im Namen von ${brand}.\n\n${FIRST_CONTACT_SYSTEM}`,
        prompt,
        schema: FirstContactSchema,
      });
      if (!result.ok || !result.output.message_de.trim()) {
        await markLead(lead.rvId, { status: "error", at: nowIso, error: "llm_failed" });
        summary.errors += 1;
        continue;
      }

      const sanitized = stripDashes(result.output.message_de.trim());
      // Deterministic guard: a first message with a price never leaves the house.
      if (PRICE_RE.test(sanitized)) {
        await markLead(lead.rvId, { status: "blocked_price", at: nowIso });
        await emitEvent({
          workspaceId,
          recordId: lead.recordId,
          objectSlug: "deals",
          eventType: "agent.action",
          payload: { mode, action: "first_contact", channel: "whatsapp", message: sanitized, reason: "BLOCKIERT: Nachricht enthielt einen Preis" },
          actorId: null,
        });
        await notifyOwners(workspaceId, lead.recordId, fullName, true);
        summary.blocked += 1;
        continue;
      }

      const [discloseAi, disclosure] = await Promise.all([
        isDiscloseAiEnabled(workspaceId),
        getAgentDisclosure(workspaceId),
      ]);
      const humanized = await humanizeGerman(sanitized);
      let outgoing = withDisclosure(appendSignature(humanized, brand), disclosure, discloseAi);
      outgoing = `${outgoing}\n\n${OPT_OUT_LINE}`;

      if (dryRun) {
        await markLead(lead.rvId, { status: "dry_run", at: nowIso, channel: "baileys" });
        await emitEvent({
          workspaceId,
          recordId: lead.recordId,
          objectSlug: "deals",
          eventType: "agent.action",
          payload: { mode, action: "first_contact", channel: "whatsapp", message: outgoing, reason: result.output.reason || "Vorschau (Testlauf)" },
          actorId: null,
        });
        summary.dryRunPreviews += 1;
        continue;
      }

      try {
        await sendBaileysFirstMessage({
          workspaceId,
          channelAccountId: account.id,
          toPhone: e164,
          customerName: fullName,
          body: outgoing,
          dealRecordId: lead.recordId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markLead(lead.rvId, { status: "error", at: nowIso, error: msg.slice(0, 300) });
        await notifyOwners(workspaceId, lead.recordId, fullName, true);
        summary.errors += 1;
        continue;
      }

      await markLead(lead.rvId, { status: "sent", at: nowIso, channel: "baileys" });
      await emitEvent({
        workspaceId,
        recordId: lead.recordId,
        objectSlug: "deals",
        eventType: "agent.action",
        payload: { mode, action: "first_contact", channel: "whatsapp", message: outgoing, reason: result.output.reason || "Erstkontakt gesendet" },
        actorId: null,
      });
      await notifyOwners(workspaceId, lead.recordId, fullName, false);
      summary.sent += 1;
    } catch (err) {
      console.error("[agent-first-contact] lead failed:", lead.recordId, err);
      summary.errors += 1;
    }
  }
}

/** Push the owner on every live send/failure: trust through visibility. */
async function notifyOwners(
  workspaceId: string,
  dealRecordId: string,
  customerName: string,
  failed: boolean
): Promise<void> {
  try {
    const owners = await ownerUserIds(workspaceId);
    if (owners.length === 0) return;
    await sendPush(
      {
        title: failed ? "Erstkontakt fehlgeschlagen" : "Erstkontakt gesendet",
        body: failed
          ? `${customerName}: bitte manuell kontaktieren.`
          : `Neuer ImmoScout-Lead ${customerName} wurde per WhatsApp begrüßt.`,
        url: `/objects/deals/${dealRecordId}`,
        tag: `agent-firstcontact-${dealRecordId}`,
      },
      { workspaceId, userIds: owners }
    );
  } catch (err) {
    console.error("[agent-first-contact] push failed (non-blocking):", err);
  }
}

/** Entry point for the first-contact cron. */
export async function runAgentFirstContact(): Promise<FirstContactRunSummary> {
  const now = new Date();
  const deadlineMs = now.getTime() + 240_000;
  const summary: FirstContactRunSummary = {
    enabledWorkspaces: 0,
    candidates: 0,
    sent: 0,
    dryRunPreviews: 0,
    skipped: 0,
    blocked: 0,
    errors: 0,
    outsideWindow: 0,
    capReached: 0,
  };

  const wsRows = (await db.execute<{ id: string }>(
    sql`SELECT id FROM workspaces`
  )) as unknown as Array<{ id: string }>;

  for (const w of wsRows) {
    if (Date.now() > deadlineMs) break;
    try {
      await runForWorkspace(w.id, now, deadlineMs, summary);
    } catch (err) {
      console.error("[agent-first-contact] workspace failed:", w.id, err);
      summary.errors += 1;
    }
  }
  return summary;
}
