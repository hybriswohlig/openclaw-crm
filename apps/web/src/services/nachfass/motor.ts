/**
 * Nachfass-Lauf. Erzeugt Follow-up-Entwürfe und triagiert den Altbestand.
 * Versendet nichts, solange der Regel-Schalter aus ist (Default) oder das
 * gemeinsame dryRun der Agenten an ist (Default an).
 */
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { agentDrafts, agentEvents, consentLedger, dealAgentState } from "@/db/schema/agent";
import { dealDocuments } from "@/db/schema/financial";
import {
  channelAccounts,
  inboxContacts,
  inboxConversations,
  inboxMessageAttachments,
  inboxMessages,
} from "@/db/schema/inbox";
import { nachfassDailySends, nachfassDealState, nachfassRuleSwitches } from "@/db/schema/nachfass";
import { attributes, selectOptions, statuses } from "@/db/schema/objects";
import { quotations } from "@/db/schema/quotations";
import { recordValues, records } from "@/db/schema/records";
import { workspaces } from "@/db/schema/workspace";
import { isCustomerOfferMessage, type LossReasonTitle } from "@/lib/deal-source";
import { AI_TASK_SLUGS } from "@/services/ai/task-registry";
import { runAITask } from "@/services/ai/run-task";
import { emitEvent } from "@/services/activity-events";
import { createAgentDraft } from "@/services/agent/agent-drafts";
import { isEngineDryRun, isSalesAgentDryRun } from "@/services/agent/agent-config";
import { entwurfFreigebenUndSenden } from "@/services/agent/draft-senden";
import { supersedePendingDrafts } from "@/services/agent/draft-schliessen";
import { leaksPriceOrCommitment, erkenneAnrede } from "@/services/agent/agent-suppress";
import { appendSignature } from "@/services/agent/agent-shared";
import { anredeAus, saeubern, stimmeAusSignatur, STIL_REGELN } from "@/services/agent/stimme";
import { inhaberRegelBlock } from "@/services/intern/regeln";
import { ladeInhaberRegeln } from "@/services/intern/regeln-lauf";
import { ladeInterneNummern } from "@/services/intern/interne-nummern";
import { notes } from "@/db/schema/notes";
import {
  istNuriGespraech,
  NURI_GESPRAECH_ID,
  SEQUENZ_ID,
  SEQUENZ_SCHRITT,
  ZIEL,
  type NachfassRegel,
} from "./konstanten";
import {
  autoSendErlaubt,
  berlinTeile,
  entscheideNachfass,
  erkenneMarke,
  istB2B,
  kundenVerlustgrund,
  ohneAntwort,
  ohneDoppeltenGruss,
  parkenUnbeantwortet,
  portalOhneDirektkontakt,
  schalterAn,
  sperreAusText,
  teamErinnerungFaellig,
  teamErinnerungText,
  waehleKundenkanal,
  zaehltAlsKundeninhalt,
  type Entscheidung,
  type KanalArt,
  type NachfassLage,
  type NachfassNachricht,
  type StageKategorie,
  type Triage,
} from "./logik";
import { setzeDealVerloren } from "./abschluss";

const MAX_DEALS = 12;
const MAX_LLM = 4;
const TRANSCRIPT_CAP = 80;

const TextSchema = z.object({
  schreiben: z.boolean().default(false),
  nachricht: z.string().default(""),
  grund: z.string().default(""),
});

export interface NachfassLauf {
  workspaces: number;
  geprueft: number;
  entwuerfe: number;
  triagen: number;
  gestoppt: number;
  geplant: number;
  uebersprungen: number;
  fehler: number;
}

const DAUERHAFT = new Set([
  "optout",
  "legal",
  "complaint",
  "intern",
  "kein_umzug",
  "fremde_firma",
  "ceylan_whatsapp",
  "ceylan_nur_eigener_mailkanal",
  "marken_mix",
  "termin_vergangen",
  "b2b",
  "price",
  "deposit",
  "portal_ohne_kontakt",
  "duplikat",
]);

function zeilen<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const wrapped = result as { rows?: T[] };
  return wrapped.rows ?? [];
}

function kanalArt(raw: string | null): KanalArt {
  if (raw === "whatsapp" || raw === "email" || raw === "sms") return raw;
  return "andere";
}

function dealUrl(id: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "https://darioushkottke.online").replace(/\/$/, "");
  return `${base}/objects/deals/${id}`;
}

function notiz(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: text.slice(0, 2000) }] }] };
}

interface Feld {
  text: string | null;
  num: string | null;
  date: string | null;
  json: unknown;
  ref: string | null;
}

function gefuellt(f: Feld | undefined): boolean {
  if (!f) return false;
  if (f.text && f.text.trim()) return true;
  if (f.num != null && f.num !== "") return true;
  if (f.ref) return true;
  if (f.json && typeof f.json === "object" && Object.keys(f.json as object).length > 0) return true;
  return false;
}

export async function runNachfass(now = new Date()): Promise<NachfassLauf> {
  const summary: NachfassLauf = {
    workspaces: 0,
    geprueft: 0,
    entwuerfe: 0,
    triagen: 0,
    gestoppt: 0,
    geplant: 0,
    uebersprungen: 0,
    fehler: 0,
  };
  const deadline = Date.now() + 240_000;
  const wsRows = await db.select({ id: workspaces.id }).from(workspaces);
  for (const ws of wsRows) {
    if (Date.now() > deadline) break;
    summary.workspaces += 1;
    try {
      await laufFuerWorkspace(ws.id, now, deadline, summary);
    } catch (err) {
      console.error("[nachfass] workspace failed:", ws.id, err);
      summary.fehler += 1;
    }
  }
  return summary;
}

async function laufFuerWorkspace(
  workspaceId: string,
  jetzt: Date,
  deadline: number,
  summary: NachfassLauf
): Promise<void> {
  await stoppeBeantwortete(workspaceId, summary);
  const ids = zeilen<{ id: string }>(
    await db.execute(sql`
      SELECT r.id AS id
      FROM records r
      INNER JOIN objects o ON o.id = r.object_id
      INNER JOIN attributes sa ON sa.object_id = o.id AND sa.slug = 'stage'
      INNER JOIN record_values sv ON sv.record_id = r.id AND sv.attribute_id = sa.id
      INNER JOIN statuses st ON st.id = sv.text_value
      LEFT JOIN nachfass_deal_state ns ON ns.deal_record_id = r.id
      WHERE o.workspace_id = ${workspaceId}
        AND o.slug = 'deals'
        AND r.deleted_at IS NULL
        AND st.stage_category IN ('open_new', 'open_engaged', 'quoted')
        AND ns.stop_reason IS NULL
        AND (ns.next_action_at IS NULL OR ns.next_action_at <= ${jetzt})
        AND NOT EXISTS (
          SELECT 1
          FROM attributes oca
          INNER JOIN record_values ocv ON ocv.record_id = r.id AND ocv.attribute_id = oca.id
          INNER JOIN records oc ON oc.id = ocv.referenced_record_id AND oc.deleted_at IS NULL
          INNER JOIN record_values ocn ON ocn.record_id = oc.id
          INNER JOIN attributes nm ON nm.id = ocn.attribute_id AND nm.slug = 'name'
          WHERE oca.object_id = o.id
            AND oca.slug = 'operating_company'
            AND coalesce(ocn.text_value, '') <> ''
            AND ocn.text_value NOT ILIKE '%kottke%'
            AND ocn.text_value NOT ILIKE '%ceylan%'
        )
      ORDER BY ns.next_action_at NULLS FIRST, r.created_at ASC
      LIMIT ${MAX_DEALS}
    `)
  ).map((r) => r.id);

  const [dryShared, dryEngine, regeln, interne] = await Promise.all([
    isSalesAgentDryRun(workspaceId),
    isEngineDryRun(workspaceId, "followup"),
    db.select().from(nachfassRuleSwitches).where(eq(nachfassRuleSwitches.workspaceId, workspaceId)),
    ladeInterneNummern(workspaceId),
  ]);
  const dryRun = dryShared || dryEngine;
  const schalter = regeln.map((r) => ({
    oc: r.operatingCompanyRecordId,
    regel: r.rule,
    an: r.autoSend,
    sauber: r.cleanApprovals,
  }));
  let llm = 0;

  for (const dealId of ids) {
    if (Date.now() > deadline) break;
    summary.geprueft += 1;
    try {
      const verbraucht = await bearbeiteDeal({
        workspaceId,
        dealId,
        jetzt,
        dryRun,
        schalter,
        interneZiffern: interne.map((n) => n.ziffern),
        summary,
        llmUebrig: MAX_LLM - llm,
      });
      llm += verbraucht;
    } catch (err) {
      console.error("[nachfass] deal failed:", dealId, err);
      summary.fehler += 1;
    }
  }
}

async function stoppeBeantwortete(workspaceId: string, summary: NachfassLauf): Promise<void> {
  const offen = await db
    .select({
      dealRecordId: agentDrafts.dealRecordId,
      createdAt: agentDrafts.createdAt,
    })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.workspaceId, workspaceId),
        eq(agentDrafts.sequenceId, SEQUENZ_ID),
        eq(agentDrafts.status, "pending")
      )
    );
  const seit = new Map<string, Date>();
  for (const draft of offen) {
    const bisher = seit.get(draft.dealRecordId);
    if (!bisher || draft.createdAt.getTime() < bisher.getTime()) seit.set(draft.dealRecordId, draft.createdAt);
  }
  for (const [dealId, ab] of seit) {
    const konvs = await db
      .select({ id: inboxConversations.id })
      .from(inboxConversations)
      .where(
        and(
          eq(inboxConversations.workspaceId, workspaceId),
          eq(inboxConversations.dealRecordId, dealId),
          ne(inboxConversations.id, NURI_GESPRAECH_ID)
        )
      );
    let antwort = false;
    for (const konv of konvs) {
      if (istNuriGespraech(konv.id)) continue;
      const neu = await db
        .select({
          direction: inboxMessages.direction,
          body: inboxMessages.body,
          sentAt: inboxMessages.sentAt,
          createdAt: inboxMessages.createdAt,
          status: inboxMessages.status,
        })
        .from(inboxMessages)
        .where(eq(inboxMessages.conversationId, konv.id))
        .orderBy(desc(inboxMessages.sentAt))
        .limit(30);
      antwort = neu.some((m) => {
        const at = m.sentAt ?? m.createdAt;
        if (at.getTime() <= ab.getTime()) return false;
        return (
          zaehltAlsKundeninhalt({
            direction: m.direction,
            body: m.body ?? "",
            at,
            status: m.status,
          }) === "inbound"
        );
      });
      if (antwort) break;
    }
    if (!antwort) continue;
    await supersedePendingDrafts({
      workspaceId,
      dealRecordId: dealId,
      supersededBy: "customer_reply",
    });
    await db
      .update(nachfassDealState)
      .set({ stopReason: "kunde_hat_geantwortet", updatedAt: new Date(), nextActionAt: null })
      .where(eq(nachfassDealState.dealRecordId, dealId));
    summary.gestoppt += 1;
  }
}

async function bearbeiteDeal(input: {
  workspaceId: string;
  dealId: string;
  jetzt: Date;
  dryRun: boolean;
  schalter: { oc: string; regel: string; an: boolean; sauber: number }[];
  interneZiffern: string[];
  summary: NachfassLauf;
  llmUebrig: number;
}): Promise<number> {
  const { workspaceId, dealId, jetzt, summary } = input;
  await db
    .insert(nachfassDealState)
    .values({ dealRecordId: dealId, workspaceId })
    .onConflictDoNothing();

  const gebaut = await baueLage(workspaceId, dealId, jetzt, input.interneZiffern);
  if (!gebaut) {
    summary.uebersprungen += 1;
    return 0;
  }
  const { lage, name, ocId, nachrichten, signatur } = gebaut;
  if (ocId) {
    await db
      .update(nachfassDealState)
      .set({ operatingCompanyRecordId: ocId, updatedAt: new Date() })
      .where(eq(nachfassDealState.dealRecordId, dealId));
  }

  if (lage.infosVollstaendig && !lage.hatAngebot && !lage.infosVollstaendigSeit) {
    lage.infosVollstaendigSeit = jetzt;
    await db
      .update(nachfassDealState)
      .set({ infosCompleteAt: jetzt, updatedAt: new Date() })
      .where(eq(nachfassDealState.dealRecordId, dealId));
  }

  const entscheidung = entscheideNachfass(lage, jetzt);
  const team = teamErinnerungFaellig(lage, jetzt);
  let llm = 0;

  if (entscheidung.art === "stop") {
    await supersedePendingDrafts({ workspaceId, dealRecordId: dealId, supersededBy: entscheidung.grund });
    await merke(dealId, { stopReason: entscheidung.grund, nextActionAt: null });
    summary.gestoppt += 1;
    return llm;
  }

  if (entscheidung.art === "triage_verloren" || entscheidung.art === "triage_markieren" || entscheidung.art === "triage_frei") {
    await triagiere(workspaceId, dealId, entscheidung, lage.vomKunden, summary);
    return llm;
  }

  if (entscheidung.art === "planen") {
    await merke(dealId, { nextActionAt: entscheidung.ab });
    summary.geplant += 1;
  } else if (entscheidung.art === "entwurf") {
    const verbraucht = await legeEntwurf({
      workspaceId,
      dealId,
      lage,
      entscheidung,
      nachrichten,
      signatur,
      name,
      jetzt,
      dryRun: input.dryRun,
      schalter: input.schalter,
      ocId,
      summary,
      llmUebrig: input.llmUebrig,
    });
    llm += verbraucht;
  } else if (DAUERHAFT.has(entscheidung.grund)) {
    await merke(dealId, { stopReason: entscheidung.grund, nextActionAt: null });
    summary.uebersprungen += 1;
  } else {
    await merke(dealId, { nextActionAt: new Date(jetzt.getTime() + 6 * 60 * 60 * 1000) });
    summary.uebersprungen += 1;
  }

  if (team.art === "entwurf") {
    await legeTeamEntwurf({
      workspaceId,
      dealId,
      name,
      nummer: lage.teamErinnerungen + 1,
      nurEntwurf: team.nurEntwurf,
      dryRun: input.dryRun,
      schalter: input.schalter,
      ocId,
      summary,
    });
  }
  return llm;
}

async function triagiere(
  workspaceId: string,
  dealId: string,
  entscheidung: Extract<Entscheidung, { art: "triage_verloren" | "triage_markieren" | "triage_frei" }>,
  vomKunden: LossReasonTitle | null,
  summary: NachfassLauf
): Promise<void> {
  const outcome: Triage =
    entscheidung.art === "triage_verloren" ? "verloren" : entscheidung.art === "triage_frei" ? "frei" : "markiert";
  if (entscheidung.art === "triage_verloren") {
    await setzeDealVerloren({
      workspaceId,
      dealRecordId: dealId,
      anlass: "triage",
      triageGrund: entscheidung.verlustgrund,
      vomKunden,
      notizText: `Altbestand-Triage ohne Nachricht: ${entscheidung.grund}.`,
    });
    await supersedePendingDrafts({ workspaceId, dealRecordId: dealId, supersededBy: "triage_verloren" });
  }
  await merke(dealId, {
    triageAt: new Date(),
    triageOutcome: outcome,
    triageNote: entscheidung.grund,
    nextActionAt: outcome === "frei" ? new Date() : null,
    ...(outcome !== "frei" ? { stopReason: entscheidung.grund } : {}),
  });
  summary.triagen += 1;
}

async function legeTeamEntwurf(input: {
  workspaceId: string;
  dealId: string;
  name: string;
  nummer: number;
  nurEntwurf: boolean;
  dryRun: boolean;
  schalter: { oc: string; regel: string; an: boolean; sauber: number }[];
  ocId: string | null;
  summary: NachfassLauf;
}): Promise<void> {
  const text = teamErinnerungText({
    dealName: input.name,
    dealUrl: dealUrl(input.dealId),
    nummer: input.nummer,
  });
  const tag = berlinTeile(new Date()).ymd;
  const erstellt = await createAgentDraft({
    workspaceId: input.workspaceId,
    conversationId: NURI_GESPRAECH_ID,
    dealRecordId: input.dealId,
    pinDeal: true,
    messageClass: "ack",
    draftText: text,
    reasoning: "Regel B: Festpreis fehlt, interne Erinnerung.",
    source: "nachfass-bot",
    sequenceId: SEQUENZ_ID,
    sequenceStep: SEQUENZ_SCHRITT.b,
    idempotencyKey: `nachfass:${input.dealId}:b:${tag}`,
    meta: { nachfass: { regel: "b", publikum: "team" } },
  });
  if (!erstellt.ok) {
    console.error("[nachfass] team draft:", input.dealId, erstellt.error);
    return;
  }
  await db.insert(notes).values({
    recordId: input.dealId,
    title: "Nachfass Team-Entwurf",
    content: notiz(text),
    createdBy: null,
  });
  input.summary.entwuerfe += 1;

  const zeile = input.schalter.find((s) => s.oc === (input.ocId ?? "") && s.regel === "b");
  const darf = autoSendErlaubt({
    schalterAn: schalterAn(
      input.schalter.map((s) => ({ oc: s.oc, regel: s.regel, an: s.an })),
      input.ocId,
      "b"
    ),
    dryRun: input.dryRun,
    saubereFreigaben: zeile?.sauber ?? 0,
    nurEntwurf: input.nurEntwurf,
    preisLeak: leaksPriceOrCommitment(text),
    harteSperre: false,
    capErreicht: false,
    imFenster: true,
    publikum: "team",
  });
  if (darf && erstellt.created) {
    const gesendet = await entwurfFreigebenUndSenden({
      workspaceId: input.workspaceId,
      userId: null,
      draftId: erstellt.draft.id,
    });
    if (!gesendet.ok) {
      console.error("[nachfass] team auto-send blocked:", input.dealId, gesendet.fehler);
    }
  }
}

async function legeEntwurf(input: {
  workspaceId: string;
  dealId: string;
  lage: NachfassLage;
  entscheidung: Extract<Entscheidung, { art: "entwurf" }>;
  nachrichten: NachfassNachricht[];
  signatur: string | null;
  name: string;
  jetzt: Date;
  dryRun: boolean;
  schalter: { oc: string; regel: string; an: boolean; sauber: number }[];
  ocId: string | null;
  summary: NachfassLauf;
  llmUebrig: number;
}): Promise<number> {
  const regel = input.entscheidung.regel;
  if (!input.lage.gespraechId) {
    await merke(input.dealId, { nextActionAt: new Date(input.jetzt.getTime() + 6 * 60 * 60 * 1000) });
    input.summary.uebersprungen += 1;
    return 0;
  }
  if (input.llmUebrig <= 0) {
    await merke(input.dealId, { nextActionAt: new Date(input.jetzt.getTime() + 20 * 60 * 1000) });
    return 0;
  }
  const text = await formuliere({
    workspaceId: input.workspaceId,
    ziel: ZIEL[regel],
    nachrichten: input.nachrichten,
    signatur: input.signatur,
    anredeUnklar: input.lage.anredeUnklar,
  });
  if (!text) {
    await merke(input.dealId, { nextActionAt: new Date(input.jetzt.getTime() + 6 * 60 * 60 * 1000) });
    input.summary.uebersprungen += 1;
    return 1;
  }
  if (leaksPriceOrCommitment(text)) {
    console.error("[nachfass] price_leak, Entwurf verworfen:", input.dealId, regel);
    await merke(input.dealId, { nextActionAt: new Date(input.jetzt.getTime() + 6 * 60 * 60 * 1000) });
    input.summary.uebersprungen += 1;
    return 1;
  }
  const tag = berlinTeile(input.jetzt).ymd;
  const schritt = SEQUENZ_SCHRITT[regel];
  const erstellt = await createAgentDraft({
    workspaceId: input.workspaceId,
    conversationId: input.lage.gespraechId ?? undefined,
    dealRecordId: input.dealId,
    messageClass: "followup",
    draftText: text,
    reasoning: `Nachfass ${regel}: ${input.entscheidung.grund}`,
    source: "nachfass-bot",
    sequenceId: SEQUENZ_ID,
    sequenceStep: schritt,
    idempotencyKey: `nachfass:${input.dealId}:${regel}:${tag}`,
    meta: {
      nachfass: {
        regel,
        nurEntwurf: input.entscheidung.nurEntwurf,
        vomKunden: input.lage.vomKunden,
      },
    },
  });
  if (!erstellt.ok) {
    if (erstellt.error !== "draft_exists") {
      console.error("[nachfass] draft:", input.dealId, erstellt.error, erstellt.message);
      input.summary.fehler += 1;
    }
    await merke(input.dealId, { nextActionAt: new Date(input.jetzt.getTime() + 6 * 60 * 60 * 1000) });
    return 1;
  }
  const fresh = regel === "a1" || regel === "a2" || regel === "a3" || regel === "c";
  await merke(input.dealId, {
    nextActionAt: new Date(input.jetzt.getTime() + 20 * 60 * 60 * 1000),
    ...(fresh ? { freshStartedAt: input.jetzt } : {}),
  });
  if (regel === "legacy" || regel === "legacy_abschluss") {
    await db
      .insert(nachfassDailySends)
      .values({
        workspaceId: input.workspaceId,
        channelAccountId: input.lage.kontoId || "unbekannt",
        berlinDay: tag,
        sentCount: 0,
        legacyDrafts: 1,
      })
      .onConflictDoUpdate({
        target: [
          nachfassDailySends.workspaceId,
          nachfassDailySends.channelAccountId,
          nachfassDailySends.berlinDay,
        ],
        set: { legacyDrafts: sql`${nachfassDailySends.legacyDrafts} + 1` },
      });
  }
  await db.insert(notes).values({
    recordId: input.dealId,
    title: "Nachfass-Entwurf",
    content: notiz(`Entwurf ${regel} wartet auf Freigabe durch Dario oder Nuri.\n\n${text}`),
    createdBy: null,
  });
  await emitEvent({
    workspaceId: input.workspaceId,
    recordId: input.dealId,
    objectSlug: "deals",
    eventType: "agent.action",
    payload: { engine: "nachfass", action: "entwurf", regel, draftId: erstellt.draft.id },
  });
  await db
    .insert(agentEvents)
    .values({
      workspaceId: input.workspaceId,
      dealRecordId: input.dealId,
      conversationId: input.lage.gespraechId,
      engine: "followup",
      eventType: "draft_created",
      payload: { source: SEQUENZ_ID, regel, draftId: erstellt.draft.id },
      idempotencyKey: `nachfass-draft:${erstellt.draft.id}`,
    })
    .onConflictDoNothing();
  input.summary.entwuerfe += 1;

  const schalterRegel = regel === "legacy_abschluss" ? "a3" : regel === "legacy" ? "legacy" : regel;
  const zeile = input.schalter.find((s) => s.oc === (input.ocId ?? "") && s.regel === schalterRegel);
  const darf = autoSendErlaubt({
    schalterAn: schalterAn(
      input.schalter.map((s) => ({ oc: s.oc, regel: s.regel, an: s.an })),
      input.ocId,
      schalterRegel
    ),
    dryRun: input.dryRun,
    saubereFreigaben: zeile?.sauber ?? 0,
    nurEntwurf: input.entscheidung.nurEntwurf,
    preisLeak: false,
    harteSperre: false,
    capErreicht: input.lage.gesendetHeute >= 20,
    imFenster: true,
    publikum: "kunde",
  });
  if (darf && erstellt.created) {
    const gesendet = await entwurfFreigebenUndSenden({
      workspaceId: input.workspaceId,
      userId: null,
      draftId: erstellt.draft.id,
    });
    if (!gesendet.ok) {
      console.error("[nachfass] auto-send blocked:", input.dealId, gesendet.fehler);
    }
  }
  return 1;
}

async function formuliere(input: {
  workspaceId: string;
  ziel: string;
  nachrichten: NachfassNachricht[];
  signatur: string | null;
  anredeUnklar: boolean;
}): Promise<string | null> {
  const sichtbar = input.nachrichten.filter((m) => zaehltAlsKundeninhalt(m) !== "ignore");
  const anrede = input.anredeUnklar
    ? "sie"
    : anredeAus(sichtbar.map((m) => ({ eingehend: m.direction === "inbound", text: m.body })));
  const verlauf = sichtbar
    .map((m) => `${m.direction === "inbound" ? "Kunde" : "Wir"}: ${m.body.trim()}`)
    .join("\n")
    .slice(-12000);
  const regeln = await ladeInhaberRegeln(input.workspaceId);
  const result = await runAITask({
    workspaceId: input.workspaceId,
    taskSlug: AI_TASK_SLUGS.LEAD_FOLLOWUP,
    background: true,
    schema: TextSchema,
    schemaHint: '{ "schreiben": boolean, "nachricht": string, "grund": string }',
    system: `Du schreibst eine einzelne Nachricht für ein Umzugsunternehmen. Du bist kein Chatbot und erfindest nichts.

ZIEL (nur die Absicht, kein Wortlaut zum Kopieren): ${input.ziel}

${STIL_REGELN}

HARTE GRENZEN
- Keinen Preis, keinen Rabatt, keinen Nachlass, keine neue Zusage, keinen konkreten Termin bestätigen.
- Wochentage: Sonntag bis Donnerstag sind günstiger, Freitag und Samstag teurer. Das darfst du höchstens als Hinweis sagen, nie mit einem Betrag.
- Anrede ${anrede === "du" ? "Du" : "Sie"}, nie mischen. ${input.anredeUnklar ? "Im Chat ist die Anrede unklar, darum Sie." : "Spiegle die Anrede aus dem Chat."}
- Der Chat läuft schon. Beginne nicht mit Hallo, Guten Tag oder einer anderen Begrüßung.
- Keine Grußformel und keine Signatur, die hängt das System an.
- Wenn der Kunde abgesagt hat, kein Interesse hat oder es kein Umzugsgespräch ist: schreiben = false und nachricht leer.

${inhaberRegelBlock(regeln)}

AUSGABE: nur JSON { schreiben, nachricht, grund }.`,
    prompt: `# Gespräch\n${verlauf || "(leer)"}\n\nSchreib die eine Nachricht zum Ziel. Übernimm keine Vorlage.`,
  });
  if (!result.ok || !result.output.schreiben) return null;
  const roh = ohneDoppeltenGruss(result.output.nachricht, sichtbar.length > 0);
  const stimme = input.signatur ? stimmeAusSignatur(input.signatur) : undefined;
  const sauber = saeubern(roh, stimme);
  if (!sauber) return null;
  return input.signatur ? appendSignature(sauber, input.signatur) : sauber;
}

async function baueLage(
  workspaceId: string,
  dealId: string,
  jetzt: Date,
  interneZiffern: string[]
): Promise<{
  lage: NachfassLage;
  name: string;
  ocId: string | null;
  nachrichten: NachfassNachricht[];
  signatur: string | null;
} | null> {
  const [deal] = await db
    .select({ id: records.id, objectId: records.objectId, createdAt: records.createdAt })
    .from(records)
    .where(and(eq(records.id, dealId), sql`${records.deletedAt} is null`))
    .limit(1);
  if (!deal) return null;

  const werte = await db
    .select({
      slug: attributes.slug,
      text: recordValues.textValue,
      num: recordValues.numberValue,
      date: recordValues.dateValue,
      json: recordValues.jsonValue,
      ref: recordValues.referencedRecordId,
    })
    .from(recordValues)
    .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
    .where(eq(recordValues.recordId, dealId));
  const feld = new Map<string, Feld>();
  for (const w of werte) {
    feld.set(w.slug, { text: w.text, num: w.num, date: w.date, json: w.json, ref: w.ref });
  }

  const ocId = feld.get("operating_company")?.ref ?? null;
  let firmenname: string | null = null;
  if (ocId) {
    const [name] = await db
      .select({ text: recordValues.textValue })
      .from(recordValues)
      .innerJoin(attributes, eq(attributes.id, recordValues.attributeId))
      .where(and(eq(recordValues.recordId, ocId), eq(attributes.slug, "name")))
      .limit(1);
    firmenname = name?.text ?? null;
  }

  const [state] = await db
    .select()
    .from(nachfassDealState)
    .where(eq(nachfassDealState.dealRecordId, dealId))
    .limit(1);
  const [agent] = await db
    .select({ humanOwned: dealAgentState.humanOwned })
    .from(dealAgentState)
    .where(eq(dealAgentState.dealRecordId, dealId))
    .limit(1);
  const [quote] = await db
    .select({ serviceType: quotations.serviceType, fixedPrice: quotations.fixedPrice })
    .from(quotations)
    .where(eq(quotations.dealRecordId, dealId))
    .limit(1);
  const dokumente = await db
    .select({ typ: dealDocuments.documentType, am: dealDocuments.uploadedAt })
    .from(dealDocuments)
    .where(and(eq(dealDocuments.dealRecordId, dealId), eq(dealDocuments.documentType, "quotation")));
  const [foto] = await db
    .select({ id: inboxMessageAttachments.id })
    .from(inboxMessageAttachments)
    .where(eq(inboxMessageAttachments.dealRecordId, dealId))
    .limit(1);

  const konvs = await db
    .select({
      id: inboxConversations.id,
      aiPaused: inboxConversations.aiPaused,
      aiNeedsReply: inboxConversations.aiNeedsReply,
      lane: inboxConversations.lane,
      kontaktart: inboxConversations.kontaktart,
      kontoId: channelAccounts.id,
      kanal: channelAccounts.channelType,
      adresse: channelAccounts.address,
      telefon: inboxContacts.phone,
      email: inboxContacts.email,
      personId: inboxContacts.crmRecordId,
      letzte: inboxConversations.lastMessageAt,
    })
    .from(inboxConversations)
    .innerJoin(channelAccounts, eq(channelAccounts.id, inboxConversations.channelAccountId))
    .leftJoin(inboxContacts, eq(inboxContacts.id, inboxConversations.contactId))
    .where(and(eq(inboxConversations.dealRecordId, dealId), eq(inboxConversations.workspaceId, workspaceId)));

  const gewaehlt = waehleKonversation(konvs, firmenname);
  const nachrichten = gewaehlt
    ? await ladeNachrichten(gewaehlt.id)
    : [];
  const stille = ohneAntwort(nachrichten);
  const textGesamt = nachrichten.map((m) => m.body).join("\n");
  const inboundText = nachrichten
    .filter((m) => zaehltAlsKundeninhalt(m) === "inbound")
    .map((m) => m.body)
    .join("\n");

  const pdfAm = dokumente.map((d) => d.am).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const angebotNachricht = nachrichten.find(
    (m) =>
      zaehltAlsKundeninhalt(m) === "outbound" &&
      (isCustomerOfferMessage(m.body) || /\b(festpreis|kostenvoranschlag)\b/i.test(m.body))
  );
  const wert = Number(feld.get("value")?.num ?? quote?.fixedPrice ?? 0);
  const hatAngebot = wert > 0 || dokumente.length > 0 || Boolean(angebotNachricht);
  const angebotAm = angebotNachricht?.at ?? pdfAm ?? (hatAngebot ? stille.letzteOutbound : null);

  const von = feld.get("move_from_address");
  const nach = feld.get("move_to_address");
  const zugangVon = feld.get("floors_from")?.num != null || gefuellt(feld.get("elevator_from"));
  const zugangNach = feld.get("floors_to")?.num != null || gefuellt(feld.get("elevator_to"));
  const terminFeld = feld.get("move_date")?.date ?? null;
  const terminImChat = /\b\d{1,2}\.\d{1,2}\.(?:\d{2,4})?\b|\b(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/i.test(
    textGesamt
  );
  const inventar =
    gefuellt(feld.get("inventory_notes")) ||
    Boolean(foto) ||
    /schrank|sofa|karton|küche|kueche|bett|tisch|inventar|möbel|moebel/i.test(textGesamt);
  const infosVollstaendig =
    gefuellt(von) &&
    gefuellt(nach) &&
    zugangVon &&
    zugangNach &&
    (Boolean(terminFeld) || terminImChat) &&
    inventar &&
    !parkenUnbeantwortet(nachrichten);

  const marke = erkenneMarke({
    firmenname,
    kontoId: gewaehlt?.kontoId ?? null,
    kontoAdresse: gewaehlt?.adresse ?? null,
  });
  const kanalWahl = waehleKundenkanal({
    marke,
    kontoId: gewaehlt?.kontoId ?? "",
    kanal: kanalArt(gewaehlt?.kanal ?? null),
    kontoAdresse: gewaehlt?.adresse ?? null,
    gespraechId: gewaehlt?.id ?? null,
  });

  const telefon = gewaehlt?.telefon ?? "";
  const ziffern = telefon.replace(/\D/g, "");
  const istIntern =
    Boolean(gewaehlt && gewaehlt.id === NURI_GESPRAECH_ID) ||
    (ziffern.length >= 8 && interneZiffern.some((n) => n === ziffern || ziffern.endsWith(n) || n.endsWith(ziffern)));

  const quelle = await optionsTitel(feld.get("source_channel")?.text ?? null);
  const pending = await db
    .select({ messageClass: agentDrafts.messageClass })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.dealRecordId, dealId),
        eq(agentDrafts.status, "pending"),
        eq(agentDrafts.sequenceId, SEQUENZ_ID)
      )
    );
  const teamOffen = pending.some((p) => p.messageClass === "ack");
  const kundeOffen = pending.some((p) => p.messageClass === "followup");

  const tag = berlinTeile(jetzt).ymd;
  const [tagessatz] = gewaehlt
    ? await db
        .select()
        .from(nachfassDailySends)
        .where(
          and(
            eq(nachfassDailySends.workspaceId, workspaceId),
            eq(nachfassDailySends.channelAccountId, gewaehlt.kontoId),
            eq(nachfassDailySends.berlinDay, tag)
          )
        )
        .limit(1)
    : [];

  let keinConsent = true;
  if (gewaehlt?.personId) {
    const [grant] = await db
      .select({ id: consentLedger.id })
      .from(consentLedger)
      .where(
        and(
          eq(consentLedger.workspaceId, workspaceId),
          eq(consentLedger.personRecordId, gewaehlt.personId),
          eq(consentLedger.purpose, "proactive_followup"),
          sql`${consentLedger.revokedAt} is null`
        )
      )
      .limit(1);
    keinConsent = !grant;
  }

  let duplikat = false;
  if (ziffern.length >= 8) {
    const andere = zeilen<{ id: string }>(
      await db.execute(sql`
        SELECT r.id AS id
        FROM inbox_contacts ct
        INNER JOIN inbox_conversations ic ON ic.contact_id = ct.id
        INNER JOIN records r ON r.id = ic.deal_record_id
        WHERE ct.workspace_id = ${workspaceId}
          AND regexp_replace(coalesce(ct.phone, ''), '\\D', '', 'g') = ${ziffern}
          AND r.id <> ${dealId}
          AND r.deleted_at IS NULL
          AND r.created_at < ${deal.createdAt}
        LIMIT 1
      `)
    );
    duplikat = andere.length > 0;
  }

  const stage = await stageVon(feld.get("stage")?.text ?? null);
  const anredeSignale = nachrichten.some((m) => erkenneAnrede(m.body));
  const lage: NachfassLage = {
    marke,
    kontoId: gewaehlt?.kontoId ?? "",
    kanal: kanalArt(gewaehlt?.kanal ?? null),
    kontoAdresse: gewaehlt?.adresse ?? null,
    gespraechId: gewaehlt?.id ?? null,
    stageKategorie: stage,
    serviceUmzug: !quote || quote.serviceType === "move",
    moveDate: terminFeld,
    angebotAm,
    hatAngebot,
    infosVollstaendig,
    infosVollstaendigSeit: state?.infosCompleteAt ?? null,
    kundeHatNachgehakt: /angebot|preis|kostenvoranschlag|wann/i.test(inboundText),
    stumm: stille.stumm,
    kundeHatGeantwortet: stille.kundeHatGeantwortet,
    letzteAktivitaet: stille.letzteAktivitaet ?? deal.createdAt,
    fu1Gesendet: Boolean(state?.fu1SentAt),
    fu2Gesendet: Boolean(state?.fu2SentAt),
    abschlussGesendet: Boolean(state?.closeSentAt),
    regelCGesendet: Boolean(state?.ruleCSentAt),
    legacyFuGesendetAm: state?.legacyFuSentAt ?? null,
    legacyAbschlussGesendet: Boolean(state?.legacyCloseSentAt),
    triage: (state?.triageOutcome as Triage | null) ?? null,
    sequenzBegonnen: Boolean(state?.freshStartedAt || state?.fu1SentAt || state?.ruleCSentAt),
    teamErinnerungen: state?.teamReminders ?? 0,
    letzteTeamErinnerung: state?.lastTeamReminderAt ?? null,
    humanOwned: Boolean(agent?.humanOwned),
    aiPaused: Boolean(gewaehlt?.aiPaused),
    aiNeedsReply: Boolean(gewaehlt?.aiNeedsReply),
    keinProaktivConsent: keinConsent,
    istIntern,
    istDuplikat: duplikat,
    portalOhneKontakt: portalOhneDirektkontakt({
      quelle,
      telefon: gewaehlt?.telefon ?? null,
      email: gewaehlt?.email ?? null,
    }),
    b2b: istB2B({ firmaGesetzt: Boolean(feld.get("company")?.ref), text: textGesamt }),
    keinLead:
      stage === "kein_lead" ||
      konvs.some((konv) => konv.kontaktart != null && konv.kontaktart !== "lead_kunde") ||
      konvs.some((konv) => konv.lane === "kein_lead"),
    chatSperre: sperreAusText(inboundText),
    vomKunden: kundenVerlustgrund(inboundText),
    anredeUnklar: !anredeSignale,
    gesendetHeute: tagessatz?.sentCount ?? 0,
    legacyEntwuerfeHeute: tagessatz?.legacyDrafts ?? 0,
    entwurfLiegt: Boolean(kundeOffen),
    teamEntwurfLiegt: Boolean(teamOffen),
    gestoppt: Boolean(state?.stopReason),
  };

  return {
    lage,
    name: feld.get("name")?.text ?? "Deal",
    ocId,
    nachrichten,
    signatur: kanalWahl.signatur,
  };
}

function waehleKonversation<
  T extends { id: string; kontoId: string; kanal: string; adresse: string; letzte: Date | null },
>(konvs: T[], firmenname: string | null): T | null {
  const sortiert = [...konvs].sort((a, b) => (b.letzte?.getTime() ?? 0) - (a.letzte?.getTime() ?? 0));
  const passend = sortiert.find((k) => {
    const wahl = waehleKundenkanal({
      marke: erkenneMarke({ firmenname, kontoId: k.kontoId, kontoAdresse: k.adresse }),
      kontoId: k.kontoId,
      kanal: kanalArt(k.kanal),
      kontoAdresse: k.adresse,
      gespraechId: k.id,
    });
    return wahl.erlaubt;
  });
  return passend ?? sortiert[0] ?? null;
}

async function ladeNachrichten(conversationId: string): Promise<NachfassNachricht[]> {
  const rows = await db
    .select({
      direction: inboxMessages.direction,
      body: inboxMessages.body,
      sentAt: inboxMessages.sentAt,
      createdAt: inboxMessages.createdAt,
      status: inboxMessages.status,
    })
    .from(inboxMessages)
    .where(eq(inboxMessages.conversationId, conversationId))
    .orderBy(desc(inboxMessages.sentAt), desc(inboxMessages.createdAt))
    .limit(TRANSCRIPT_CAP);
  return rows.reverse().map((m) => ({
    direction: m.direction,
    body: m.body ?? "",
    at: m.sentAt ?? m.createdAt,
    status: m.status,
  }));
}

async function optionsTitel(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [row] = await db
    .select({ title: selectOptions.title })
    .from(selectOptions)
    .where(eq(selectOptions.id, id))
    .limit(1);
  return row?.title ?? null;
}

async function stageVon(id: string | null): Promise<StageKategorie | null> {
  if (!id) return null;
  const [row] = await db
    .select({ category: statuses.stageCategory })
    .from(statuses)
    .where(eq(statuses.id, id))
    .limit(1);
  return (row?.category as StageKategorie | null) ?? null;
}

async function merke(
  dealId: string,
  patch: Partial<typeof nachfassDealState.$inferInsert>
): Promise<void> {
  await db
    .update(nachfassDealState)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(nachfassDealState.dealRecordId, dealId));
}
