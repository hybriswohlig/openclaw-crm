/**
 * Phase 3 of the WhatsApp LID conversation-split fix (see 841f380 for the
 * Phase 1+2 live-path fix): repair the production data the bug left behind.
 *
 * DRY-RUN by default — pass --apply to mutate. --apply additionally requires
 * --bridge-stopped: stop the Baileys bridge on the VPS first (or set the
 * channel accounts inactive), otherwise a message arriving mid-merge can be
 * cascade-deleted with the absorbed conversation row. With the bridge
 * stopped, WhatsApp queues messages server-side and delivers on reconnect.
 *
 * Safety rails (each one earned in adversarial review):
 *   - pg advisory lock on a dedicated connection: one --apply at a time
 *   - bare-digit thread keys are only treated as LIDs with corroboration
 *     (an auth-state/message/person mapping OR an @lid sibling thread) —
 *     a 13-15 digit landline wa_id must never be re-keyed to a fake @lid
 *   - groups that share conversations or resolve to the same phone are
 *     coalesced; the re-key target prefers the CURRENT LID (forward
 *     keystore entry), else the most recently active @lid thread
 *   - inside the transaction every conversation row is re-selected FOR
 *     UPDATE (stale snapshots are discarded; vanished rows skipped)
 *   - attachments are re-homed BEFORE any message/conversation delete
 *     (both FKs cascade) — echo duplicates donate their attachments to the
 *     surviving copy instead of being destroyed with it
 *   - duplicate deals are soft-deleted (records.deleted_at +
 *     merged_into_record_id, reversible) only when nothing real references
 *     them; ALL rows pointing at a dup deal are re-pointed to the survivor
 *     first; groups with manual-review deals are NOT applied at all
 *   - person merges go through mergePersons (snapshot, splittable), into
 *     the OLDEST person (same rule as the live D1 merge), and run BEFORE
 *     orphaned LID contacts are deleted (a crash in between must not
 *     orphan an unmergeable person)
 *   - aiNeedsReply is never touched; unread counts are recounted from the
 *     merged messages, not summed from snapshots
 *   - the global identifier cleanup only runs on a full run (not --lid)
 *     and dumps full rows before the (deliberate, provably-corrupt-only)
 *     hard delete
 *
 * Run dry-run:  pnpm --filter @openclaw-crm/web exec tsx scripts/repair-lid-splits.ts
 * Run apply:    ... tsx scripts/repair-lid-splits.ts --apply --bridge-stopped
 * One group:    ... tsx scripts/repair-lid-splits.ts --lid 86505372536889
 */
import "./_load-env";
import postgres from "postgres";
import { db } from "@/db";
import { normalizeDatabaseUrl } from "@/db/normalize-database-url";
import {
  channelAccounts,
  inboxConversations,
  inboxMessages,
  inboxMessageAttachments,
  inboxContacts,
} from "@/db/schema/inbox";
import { personIdentifiers } from "@/db/schema/identity";
import { records } from "@/db/schema/records";
import { activityEvents } from "@/db/schema/activity";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canonicalizePhone } from "@/lib/identity/canonical";
import { mergePersons } from "@/services/person-merge";

const APPLY = process.argv.includes("--apply");
const BRIDGE_STOPPED = process.argv.includes("--bridge-stopped");
const IGNORE_AUTH_STATE = process.argv.includes("--ignore-auth-state");
const ONLY_LID = (() => {
  const i = process.argv.indexOf("--lid");
  if (i < 0) return null;
  const raw = (process.argv[i + 1] ?? "").replace(/@(?:hosted\.)?lid$/, "");
  if (!/^\d{6,20}$/.test(raw)) {
    console.error(`--lid muss 6-20 Ziffern sein (mit oder ohne @lid): ${process.argv[i + 1]}`);
    process.exit(1);
  }
  return raw;
})();

type Conv = typeof inboxConversations.$inferSelect;
type Contact = typeof inboxContacts.$inferSelect;
type Rows = Array<Record<string, unknown>>;

const log = (...a: unknown[]) => console.log(...a);

function digitsOf(jidOrUser: string | null | undefined): string {
  if (!jidOrUser) return "";
  return jidOrUser.replace(/@.*$/, "").replace(/:.*$/, "").replace(/\D+/g, "");
}

/** 13-20 digits that do NOT canonicalize as a phone. NOT proof of a LID on
 *  its own (a 13-15 digit landline wa_id fails the mobile gate too) — bare
 *  keys additionally need corroboration before they are treated as LIDs. */
function looksLikeLid(digits: string): boolean {
  return /^\d{13,20}$/.test(digits) && canonicalizePhone(digits) === null;
}

// ─── Step 1: LID -> PN evidence ───────────────────────────────────────────────

interface LidEvidence {
  pn: string;
  source: string;
}

interface AccountLidInfo {
  /** lidDigits -> evidence (reverse entries, messages, person graph). */
  reverse: Map<string, LidEvidence>;
  /** pnDigits -> CURRENT lidDigits (forward keystore entries — Baileys
   *  overwrites these on LID change, unlike the never-deleted reverse ones). */
  forward: Map<string, string>;
}

async function buildLidMaps(
  accounts: Array<typeof channelAccounts.$inferSelect>
): Promise<{ byAccount: Map<string, AccountLidInfo>; authStateFailures: number }> {
  const byAccount = new Map<string, AccountLidInfo>();
  let authStateFailures = 0;

  // getSecret lives in workspace-settings and needs SETTINGS_ENCRYPTION_KEY;
  // imported lazily so a missing key fails HERE with a clear message.
  const { getSecret } = await import("@/services/workspace-settings");

  for (const account of accounts) {
    const info: AccountLidInfo = { reverse: new Map(), forward: new Map() };
    byAccount.set(account.id, info);
    try {
      const raw = await getSecret(
        account.workspaceId,
        `baileys.auth_state.${account.id}`
      );
      if (raw) {
        const state = JSON.parse(raw) as {
          keys?: Record<string, Record<string, unknown>>;
        };
        const bucket = state.keys?.["lid-mapping"] ?? {};
        for (const [key, value] of Object.entries(bucket)) {
          if (typeof value !== "string") continue;
          if (key.endsWith("_reverse")) {
            const lid = digitsOf(key.slice(0, -"_reverse".length));
            const pn = digitsOf(value);
            if (lid && pn) info.reverse.set(lid, { pn, source: "auth-state" });
          } else {
            const pn = digitsOf(key);
            const lid = digitsOf(value);
            if (lid && pn) {
              info.forward.set(pn, lid);
              if (!info.reverse.has(lid)) {
                info.reverse.set(lid, { pn, source: "auth-state" });
              }
            }
          }
        }
      }
    } catch (err) {
      authStateFailures += 1;
      log(
        `  ! auth-state unlesbar fuer Account ${account.id} (${account.name}):`,
        err instanceof Error ? err.message : err
      );
    }
  }

  // Source 2: post-fix inbound messages in LID-keyed threads carry the
  // resolved phone as from_address while the thread key is the LID.
  const msgEvidence = (await db.execute(sql`
    SELECT c.channel_account_id AS account_id,
           c.external_thread_id AS thread_id,
           m.from_address AS from_address
    FROM inbox_conversations c
    JOIN inbox_messages m ON m.conversation_id = c.id
    WHERE c.external_thread_id ~ '@(hosted\\.)?lid$'
      AND m.direction = 'inbound'
      AND m.from_address IS NOT NULL
  `)) as unknown as Rows;
  for (const row of msgEvidence) {
    const info = byAccount.get(String(row.account_id));
    const lid = digitsOf(String(row.thread_id));
    const pn = digitsOf(String(row.from_address));
    if (!info || !lid || !pn || pn === lid) continue;
    if (canonicalizePhone(pn) === null) continue;
    if (!info.reverse.has(lid)) {
      info.reverse.set(lid, { pn, source: "message-from-address" });
    }
  }

  // Source 3: persons that carry BOTH a wa_lid and a phone identifier. Only
  // trusted when the person has EXACTLY ONE distinct WhatsApp-sourced phone
  // (a person can carry third-party numbers rescued from message text), and
  // only applied to accounts of the SAME workspace.
  const personEvidence = (await db.execute(sql`
    SELECT l.workspace_id AS workspace_id,
           l.value_canonical AS lid_canon,
           array_agg(DISTINCT p.value_canonical) AS pns
    FROM person_identifiers l
    JOIN person_identifiers p
      ON p.person_record_id = l.person_record_id
     AND p.workspace_id = l.workspace_id
    WHERE l.kind = 'wa_lid' AND p.kind = 'phone' AND p.source = 'whatsapp'
      AND l.value_canonical IS NOT NULL AND p.value_canonical IS NOT NULL
    GROUP BY l.workspace_id, l.value_canonical
  `)) as unknown as Rows;
  for (const row of personEvidence) {
    const pns = (row.pns as string[]) ?? [];
    if (pns.length !== 1) continue;
    const lid = digitsOf(String(row.lid_canon));
    const pn = digitsOf(String(pns[0]));
    if (!lid || !pn || canonicalizePhone(pn) === null) continue;
    for (const account of accounts) {
      if (account.workspaceId !== String(row.workspace_id)) continue;
      const info = byAccount.get(account.id)!;
      if (!info.reverse.has(lid)) {
        info.reverse.set(lid, { pn, source: "person-graph" });
      }
    }
  }

  return { byAccount, authStateFailures };
}

// ─── Step 2: group suspect conversations per (account, identity) ─────────────

interface RepairGroup {
  account: typeof channelAccounts.$inferSelect;
  /** All LIDs of this identity (re-registration can leave several). */
  lids: string[];
  /** The re-key target LID, when unambiguous. */
  targetLid: string | null;
  pn: string | null;
  pnSource: string | null;
  convIds: string[];
  contacts: Map<string, Contact>;
  manualReason: string | null;
}

async function collectGroups(
  accounts: Array<typeof channelAccounts.$inferSelect>,
  lidMaps: Map<string, AccountLidInfo>
): Promise<{ groups: RepairGroup[]; skippedBareKeys: string[] }> {
  const groups: RepairGroup[] = [];
  const skippedBareKeys: string[] = [];

  for (const account of accounts) {
    const info = lidMaps.get(account.id) ?? { reverse: new Map(), forward: new Map() };
    const convs = await db
      .select()
      .from(inboxConversations)
      .where(eq(inboxConversations.channelAccountId, account.id))
      .orderBy(asc(inboxConversations.createdAt));

    const byKey = new Map<string, Conv[]>();
    const byContact = new Map<string, Conv[]>();
    for (const c of convs) {
      const k = c.externalThreadId ?? "";
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(c);
      if (!byContact.has(c.contactId)) byContact.set(c.contactId, []);
      byContact.get(c.contactId)!.push(c);
    }

    // Suspects. Bare-digit keys need corroboration (see looksLikeLid).
    const lids = new Set<string>();
    for (const c of convs) {
      const key = c.externalThreadId ?? "";
      if (/@(?:hosted\.)?lid$/.test(key)) {
        lids.add(digitsOf(key));
      } else if (looksLikeLid(key)) {
        const corroborated =
          info.reverse.has(key) ||
          byKey.has(`${key}@lid`) ||
          byKey.has(`${key}@hosted.lid`);
        if (corroborated) lids.add(key);
        else
          skippedBareKeys.push(
            `${account.name}: Thread-Key ${key} (conv ${c.id.slice(0, 8)}) — 13+ Ziffern ohne LID-Beleg, manuell pruefen`
          );
      }
    }

    // Build one raw group per LID, then coalesce.
    interface RawGroup {
      lids: Set<string>;
      pn: string | null;
      pnSource: string | null;
      convIds: Set<string>;
      contactIds: Set<string>;
    }
    const raw: RawGroup[] = [];
    for (const lid of lids) {
      if (ONLY_LID && lid !== ONLY_LID) continue;
      const ev = info.reverse.get(lid) ?? null;
      const g: RawGroup = {
        lids: new Set([lid]),
        pn: ev?.pn ?? null,
        pnSource: ev?.source ?? null,
        convIds: new Set(),
        contactIds: new Set(),
      };
      const grab = (list: Conv[] | undefined) =>
        (list ?? []).forEach((c) => {
          g.convIds.add(c.id);
          g.contactIds.add(c.contactId);
        });
      grab(byKey.get(`${lid}@lid`));
      grab(byKey.get(`${lid}@hosted.lid`));
      grab(byKey.get(lid));
      if (g.pn) {
        grab(byKey.get(g.pn));
        grab(byKey.get(`${g.pn}@s.whatsapp.net`));
      }
      const keyContacts = await db
        .select()
        .from(inboxContacts)
        .where(
          and(
            eq(inboxContacts.workspaceId, account.workspaceId),
            inArray(inboxContacts.phone, [lid, ...(g.pn ? [g.pn] : [])])
          )
        );
      for (const ct of keyContacts) {
        g.contactIds.add(ct.id);
        grab(byContact.get(ct.id));
      }
      raw.push(g);
    }

    // Coalesce groups that share a conversation or resolve to the same pn
    // (a re-registered customer leaves stale reverse entries behind).
    const merged: RawGroup[] = [];
    for (const g of raw) {
      const hit = merged.find(
        (m) =>
          (g.pn && m.pn === g.pn) ||
          [...g.convIds].some((id) => m.convIds.has(id))
      );
      if (hit) {
        g.lids.forEach((l) => hit.lids.add(l));
        g.convIds.forEach((id) => hit.convIds.add(id));
        g.contactIds.forEach((id) => hit.contactIds.add(id));
        if (!hit.pn && g.pn) {
          hit.pn = g.pn;
          hit.pnSource = g.pnSource;
        }
      } else {
        merged.push(g);
      }
    }

    for (const g of merged) {
      // Re-key target: single LID, else the CURRENT one per forward keystore
      // entry, else the LID of the most recently active @lid thread.
      let targetLid: string | null = null;
      let manualReason: string | null = null;
      const lidList = [...g.lids];
      if (lidList.length === 1) {
        targetLid = lidList[0];
      } else {
        const fwd = g.pn ? info.forward.get(g.pn) : undefined;
        if (fwd && g.lids.has(fwd)) {
          targetLid = fwd;
        } else {
          let best: { lid: string; at: number } | null = null;
          for (const lid of lidList) {
            for (const c of [
              ...(byKey.get(`${lid}@lid`) ?? []),
              ...(byKey.get(`${lid}@hosted.lid`) ?? []),
            ]) {
              const at = c.lastMessageAt?.getTime() ?? 0;
              if (!best || at > best.at) best = { lid, at };
            }
          }
          if (best) targetLid = best.lid;
          else
            manualReason = `mehrere LIDs (${lidList.join(", ")}) ohne eindeutige aktuelle — manuell pruefen`;
        }
      }

      const contacts = new Map<string, Contact>();
      if (g.contactIds.size > 0) {
        const rows = await db
          .select()
          .from(inboxContacts)
          .where(inArray(inboxContacts.id, [...g.contactIds]));
        for (const r of rows) contacts.set(r.id, r);
      }

      groups.push({
        account,
        lids: lidList,
        targetLid,
        pn: g.pn,
        pnSource: g.pnSource,
        convIds: [...g.convIds],
        contacts,
        manualReason,
      });
    }
  }

  return { groups, skippedBareKeys };
}

// ─── Step 3: deal triage ──────────────────────────────────────────────────────

interface DealPlan {
  survivorDealId: string | null;
  duplicateDealIds: string[];
  auftraegeToSoftDelete: string[];
  manualReviewDealIds: string[];
  notes: string[];
}

// Derived caches/logs are never blockers (their rows are cleaned with the dup
// deal). Conversations + attachments are re-pointed wholesale by the repair.
const NON_BLOCKING_DEAL_TABLES = new Set([
  "inbox_conversations",
  "inbox_message_attachments",
  "deal_insights_refresh_log",
]);

async function planDeals(convs: Conv[]): Promise<DealPlan> {
  const plan: DealPlan = {
    survivorDealId: null,
    duplicateDealIds: [],
    auftraegeToSoftDelete: [],
    manualReviewDealIds: [],
    notes: [],
  };
  const rawDealIds = [
    ...new Set(convs.map((c) => c.dealRecordId).filter((d): d is string => !!d)),
  ];
  if (rawDealIds.length === 0) return plan;

  // Only live deals can survive; soft-deleted candidates (earlier runs)
  // resolve to their merge target when that is live.
  const dealRows = await db
    .select({
      id: records.id,
      createdAt: records.createdAt,
      deletedAt: records.deletedAt,
      mergedInto: records.mergedIntoRecordId,
    })
    .from(records)
    .where(inArray(records.id, rawDealIds))
    .orderBy(asc(records.createdAt));
  const live = dealRows.filter((d) => !d.deletedAt);
  for (const d of dealRows) {
    if (d.deletedAt && d.mergedInto && !live.some((l) => l.id === d.mergedInto)) {
      const [target] = await db
        .select({ id: records.id, createdAt: records.createdAt, deletedAt: records.deletedAt })
        .from(records)
        .where(eq(records.id, d.mergedInto))
        .limit(1);
      if (target && !target.deletedAt) {
        live.push({ ...target, mergedInto: null });
      }
    }
  }
  if (live.length === 0) {
    plan.notes.push("kein lebender Deal-Kandidat — Deal-Verknuepfung bleibt unveraendert");
    return plan;
  }
  const dealIds = live.map((d) => d.id);
  if (dealIds.length === 1) {
    plan.survivorDealId = dealIds[0];
    return plan;
  }

  // Survivor = the deal with the lead import payload, else oldest live.
  const withPayload = (await db.execute(sql`
    SELECT DISTINCT rv.record_id AS id
    FROM record_values rv
    JOIN attributes a ON a.id = rv.attribute_id
    WHERE rv.record_id IN ${dealIds}
      AND a.slug = 'moving_lead_payload'
      AND (rv.json_value IS NOT NULL OR rv.text_value IS NOT NULL)
  `)) as unknown as Rows;
  const payloadIds = new Set(withPayload.map((r) => String(r.id)));
  const orderedIds = live
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((d) => d.id);
  plan.survivorDealId =
    orderedIds.find((id) => payloadIds.has(id)) ?? orderedIds[0];
  if (payloadIds.size > 1) {
    plan.notes.push(
      `mehrere Deals mit Lead-Payload (${[...payloadIds].join(", ")}) — Survivor = aeltester davon`
    );
  }

  const dealColumnTables = (await db.execute(sql`
    SELECT table_name FROM information_schema.columns
    WHERE column_name = 'deal_record_id' AND table_schema = 'public'
  `)) as unknown as Rows;
  const tables = dealColumnTables
    .map((r) => String(r.table_name))
    .filter((t) => !NON_BLOCKING_DEAL_TABLES.has(t));

  for (const dealId of dealIds) {
    if (dealId === plan.survivorDealId) continue;
    const blockers: string[] = [];

    for (const t of tables) {
      const res = (await db.execute(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(t)} WHERE deal_record_id = ${dealId}`
      )) as unknown as Rows;
      const n = Number(res[0]?.n ?? 0);
      if (n > 0) blockers.push(`${t}:${n}`);
    }

    const refs = (await db.execute(sql`
      SELECT rv.record_id AS id, o.slug AS slug
      FROM record_values rv
      JOIN records r ON r.id = rv.record_id AND r.deleted_at IS NULL
      JOIN objects o ON o.id = r.object_id
      WHERE rv.referenced_record_id = ${dealId}
    `)) as unknown as Rows;
    const auftraege: string[] = [];
    for (const row of refs) {
      const slug = String(row.slug);
      if (slug === "auftraege") auftraege.push(String(row.id));
      else if (slug !== "deals") blockers.push(`${slug}:${String(row.id)}`);
    }

    if (blockers.length > 0) {
      plan.manualReviewDealIds.push(dealId);
      plan.notes.push(
        `Deal ${dealId} referenziert von: ${blockers.join(", ")} — Gruppe wird NICHT angewendet`
      );
    } else {
      plan.duplicateDealIds.push(dealId);
      plan.auftraegeToSoftDelete.push(...auftraege);
    }
  }
  return plan;
}

// ─── Identifier reconciliation (works with or without migration 0039) ────────

async function reconcileHardIdentifier(
  workspaceId: string,
  personRecordId: string,
  kind: "phone" | "wa_lid",
  canonical: string
): Promise<void> {
  const rows = await db
    .select()
    .from(personIdentifiers)
    .where(
      and(
        eq(personIdentifiers.workspaceId, workspaceId),
        eq(personIdentifiers.kind, kind),
        eq(personIdentifiers.valueCanonical, canonical)
      )
    )
    .orderBy(asc(personIdentifiers.createdAt));
  if (rows.length === 0) {
    await db.insert(personIdentifiers).values({
      workspaceId,
      personRecordId,
      kind,
      valueRaw: canonical,
      valueCanonical: canonical,
      source: "whatsapp",
      trust: "verified",
    });
    return;
  }
  // Already in the desired state -> true no-op (clean re-runs).
  if (rows.length === 1 && rows[0].personRecordId === personRecordId) return;
  // Keep the oldest row (matches migration 0039's dedupe rule), point it at
  // the survivor, drop newer duplicates so the unique index can always apply.
  const keep = rows[0];
  await db
    .update(personIdentifiers)
    .set({ personRecordId, lastSeen: new Date() })
    .where(eq(personIdentifiers.id, keep.id));
  if (rows.length > 1) {
    await db.delete(personIdentifiers).where(
      inArray(personIdentifiers.id, rows.slice(1).map((r) => r.id))
    );
  }
}

// ─── Step 4: execute one group ────────────────────────────────────────────────

interface GroupResult {
  lid: string;
  pn: string | null;
  action: string;
  details: string[];
  error?: string;
}

const processedConvIds = new Set<string>();

async function repairGroup(group: RepairGroup): Promise<GroupResult> {
  const details: string[] = [];
  const { account, pn, targetLid } = group;
  const lidLabel = targetLid ?? group.lids[0] ?? "?";

  if (group.manualReason) {
    return { lid: lidLabel, pn, action: "manual-review", details: [group.manualReason] };
  }
  if (!targetLid) {
    return { lid: lidLabel, pn, action: "manual-review", details: ["kein Re-Key-Ziel bestimmbar"] };
  }
  const lidThreadKey = `${targetLid}@lid`;

  const convIds = group.convIds.filter((id) => !processedConvIds.has(id));
  if (convIds.length === 0) {
    return { lid: lidLabel, pn, action: "noop", details: ["keine (verbleibenden) Konversationen"] };
  }

  // Fresh rows; the collect-phase snapshot is only used for grouping.
  const convs = await db
    .select()
    .from(inboxConversations)
    .where(inArray(inboxConversations.id, convIds))
    .orderBy(asc(inboxConversations.createdAt));
  if (convs.length === 0) {
    return { lid: lidLabel, pn, action: "noop", details: ["Konversationen bereits verschwunden"] };
  }
  convIds.forEach((id) => processedConvIds.add(id));

  const survivor = convs[0];
  const absorbed = convs.slice(1);

  const contactList = [...group.contacts.values()];
  const phoneContact = pn ? contactList.find((c) => c.phone === pn) ?? null : null;
  const lidContacts = contactList.filter((c) => group.lids.includes(c.phone ?? ""));
  const survivorContact =
    phoneContact ??
    group.contacts.get(survivor.contactId) ??
    contactList[0] ??
    null;

  const dealPlan = await planDeals(convs);

  // Person survivor = OLDEST live person (same rule as the live D1 merge).
  const personIds = [
    ...new Set(contactList.map((c) => c.crmRecordId).filter((p): p is string => !!p)),
  ];
  let survivorPerson: string | null = null;
  if (personIds.length > 0) {
    const personRows = await db
      .select({ id: records.id, deletedAt: records.deletedAt })
      .from(records)
      .where(inArray(records.id, personIds))
      .orderBy(asc(records.createdAt));
    survivorPerson = personRows.find((p) => !p.deletedAt)?.id ?? null;
  }

  const alreadyRepaired =
    absorbed.length === 0 &&
    survivor.externalThreadId === lidThreadKey &&
    (!survivorContact || survivor.contactId === survivorContact.id) &&
    (!dealPlan.survivorDealId || survivor.dealRecordId === dealPlan.survivorDealId) &&
    dealPlan.duplicateDealIds.length === 0;

  // Identity work can be pending even when the conversation itself is fine
  // (a thread already healed by the live path keeps its LID-digit contact
  // and gets no wa_lid identifier until the next message arrives).
  const contactNeedsFix = !!(
    pn &&
    !phoneContact &&
    survivorContact &&
    group.lids.includes(survivorContact.phone ?? "")
  );
  let personsPendingMerge = false;
  if (survivorPerson && personIds.length > 1) {
    const others = personIds.filter((p) => p !== survivorPerson);
    const live = await db
      .select({ id: records.id })
      .from(records)
      .where(and(inArray(records.id, others), isNull(records.deletedAt)))
      .limit(1);
    personsPendingMerge = live.length > 0;
  }
  const pnCanon = pn ? canonicalizePhone(pn) : null;
  let identifiersPending = false;
  if (survivorPerson) {
    const wanted: Array<["wa_lid" | "phone", string]> = [
      ["wa_lid", lidThreadKey],
      ...(pnCanon ? ([["phone", pnCanon]] as Array<["phone", string]>) : []),
    ];
    for (const [kind, canon] of wanted) {
      const rows = await db
        .select({ id: personIdentifiers.id, owner: personIdentifiers.personRecordId })
        .from(personIdentifiers)
        .where(
          and(
            eq(personIdentifiers.workspaceId, account.workspaceId),
            eq(personIdentifiers.kind, kind),
            eq(personIdentifiers.valueCanonical, canon)
          )
        )
        .limit(2);
      if (rows.length !== 1 || rows[0].owner !== survivorPerson) {
        identifiersPending = true;
      }
    }
  }
  const identityPending = contactNeedsFix || personsPendingMerge || identifiersPending;

  details.push(
    `account=${account.name}`,
    `pn=${pn ?? "UNAUFGELOEST"}${group.pnSource ? ` (${group.pnSource})` : ""}` +
      (group.lids.length > 1 ? ` lids=[${group.lids.join(", ")}] -> ${targetLid}` : ""),
    `convs=${convs.length} [${convs.map((c) => `${c.id.slice(0, 8)}:${c.externalThreadId}`).join(", ")}]`,
    `survivor=${survivor.id.slice(0, 8)} -> key ${lidThreadKey}`,
    `contact=${survivorContact ? `${survivorContact.id.slice(0, 8)} (phone=${survivorContact.phone})` : "KEINER"}${contactNeedsFix ? " -> wird auf PN umgestellt" : ""}`,
    `deal: survivor=${dealPlan.survivorDealId ?? "-"} dupes=${dealPlan.duplicateDealIds.length} auftraege=${dealPlan.auftraegeToSoftDelete.length} manual=${dealPlan.manualReviewDealIds.length}`,
    `persons=${personIds.length} -> survivor ${survivorPerson ?? "-"}${personsPendingMerge ? " (Merge ausstehend)" : ""}${identifiersPending ? " (Identifier ausstehend)" : ""}`,
    ...dealPlan.notes
  );

  if (dealPlan.manualReviewDealIds.length > 0) {
    return { lid: lidLabel, pn, action: "manual-review", details };
  }
  if (alreadyRepaired && !identityPending) {
    return { lid: lidLabel, pn, action: "bereits-repariert", details };
  }

  for (const c of absorbed) {
    const res = (await db.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (
               WHERE external_message_id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM inbox_messages s
                 WHERE s.conversation_id = ${survivor.id}
                   AND s.external_message_id = inbox_messages.external_message_id
               )
             )::int AS dupes
      FROM inbox_messages WHERE conversation_id = ${c.id}
    `)) as unknown as Rows;
    const row = res[0] ?? {};
    details.push(
      `  absorb ${c.id.slice(0, 8)} (${c.externalThreadId}): ${Number(row.total ?? 0)} Nachrichten, davon ${Number(row.dupes ?? 0)} Cross-Post-Duplikate`
    );
  }

  // Never mint an @lid key the system has never seen: rekey-only groups with
  // unresolved pn keep their existing keys unless one is already @lid-keyed.
  const hasLidKeyedConv = convs.some((c) =>
    /@(?:hosted\.)?lid$/.test(c.externalThreadId ?? "")
  );
  if (!pn && !hasLidKeyedConv) {
    details.push("kein PN und kein @lid-Thread — nichts zu tun (nur Beleg-Gruppe)");
    return { lid: lidLabel, pn, action: "noop", details };
  }

  if (!APPLY) {
    return {
      lid: lidLabel,
      pn,
      action: alreadyRepaired
        ? "identity-only"
        : absorbed.length > 0
          ? "merge"
          : "rekey+identity",
      details,
    };
  }

  // ── Apply ──────────────────────────────────────────────────────────────────
  if (alreadyRepaired) {
    // Conversation surgery is a no-op; only the identity layer needs work.
    if (contactNeedsFix && survivorContact) {
      await db
        .update(inboxContacts)
        .set({ phone: pn!, updatedAt: new Date() })
        .where(eq(inboxContacts.id, survivorContact.id));
      details.push(`  Kontakt ${survivorContact.id.slice(0, 8)}: phone ${survivorContact.phone} -> ${pn}`);
    }
  } else {
  await db.transaction(async (tx) => {
    // Lock every involved conversation row. Concurrent ingest (should the
    // bridge run despite --bridge-stopped) blocks on these locks and then
    // fails loudly on the FK instead of being silently cascade-deleted.
    const lockedRows = (await tx.execute(sql`
      SELECT id FROM inbox_conversations
      WHERE id IN ${convs.map((c) => c.id)}
      FOR UPDATE
    `)) as unknown as Rows;
    const lockedIds = new Set(lockedRows.map((r) => String(r.id)));
    if (!lockedIds.has(survivor.id)) {
      throw new Error("Survivor-Konversation existiert nicht mehr — erneut ausfuehren");
    }
    const absorbedLive = absorbed.filter((c) => lockedIds.has(c.id));

    for (const c of absorbedLive) {
      // 1. Re-home attachments of doomed echo duplicates onto the survivor's
      //    copy of the same message BEFORE the delete (FK cascades on
      //    message_id; file bytes live only in these rows).
      await tx.execute(sql`
        UPDATE inbox_message_attachments a
        SET message_id = s.id, conversation_id = ${survivor.id}
        FROM inbox_messages m
        JOIN inbox_messages s
          ON s.conversation_id = ${survivor.id}
         AND s.external_message_id = m.external_message_id
        WHERE a.message_id = m.id
          AND m.conversation_id = ${c.id}
          AND m.external_message_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM inbox_message_attachments sa
            WHERE sa.message_id = s.id
              AND (
                (sa.external_media_id IS NOT NULL AND sa.external_media_id = a.external_media_id)
                OR (sa.file_name = a.file_name AND sa.file_size = a.file_size)
              )
          )
      `);
      // 2. Drop the absorbed copy of cross-posted echoes.
      await tx.execute(sql`
        DELETE FROM inbox_messages m
        WHERE m.conversation_id = ${c.id}
          AND m.external_message_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM inbox_messages s
            WHERE s.conversation_id = ${survivor.id}
              AND s.external_message_id = m.external_message_id
          )
      `);
      // 3. Remaining attachments + messages move; then the row can die.
      await tx
        .update(inboxMessageAttachments)
        .set({
          conversationId: survivor.id,
          ...(dealPlan.survivorDealId
            ? { dealRecordId: dealPlan.survivorDealId }
            : {}),
        })
        .where(eq(inboxMessageAttachments.conversationId, c.id));
      await tx
        .update(inboxMessages)
        .set({ conversationId: survivor.id })
        .where(eq(inboxMessages.conversationId, c.id));
      await tx
        .delete(inboxConversations)
        .where(eq(inboxConversations.id, c.id));
    }

    // Survivor: re-key + recompute denormalized state from merged messages.
    const lastRes = (await tx.execute(sql`
      SELECT body, sent_at, direction FROM inbox_messages
      WHERE conversation_id = ${survivor.id}
      ORDER BY sent_at DESC NULLS LAST LIMIT 1
    `)) as unknown as Rows;
    const last = lastRes[0];
    const unreadRes = (await tx.execute(sql`
      SELECT count(*)::int AS n FROM inbox_messages
      WHERE conversation_id = ${survivor.id}
        AND direction = 'inbound' AND is_read = false
    `)) as unknown as Rows;
    const unread = Number(unreadRes[0]?.n ?? 0);
    const anyOpen = convs.some((c) => c.status === "open");
    const anyPaused = convs.some((c) => c.aiPaused);

    await tx
      .update(inboxConversations)
      .set({
        externalThreadId: lidThreadKey,
        ...(survivorContact ? { contactId: survivorContact.id } : {}),
        ...(dealPlan.survivorDealId
          ? { dealRecordId: dealPlan.survivorDealId }
          : {}),
        unreadCount: unread,
        ...(last
          ? {
              lastMessageAt:
                last.sent_at instanceof Date
                  ? last.sent_at
                  : new Date(String(last.sent_at)),
              lastMessagePreview: `${last.direction === "outbound" ? "Du: " : ""}${String(last.body ?? "")}`
                .slice(0, 120)
                .replace(/\s+/g, " "),
            }
          : {}),
        status: anyOpen ? "open" : survivor.status,
        // Widen only; aiNeedsReply is deliberately NOT touched (a repair run
        // must neither arm the agent nor drop a pending customer reply).
        aiPaused: survivor.aiPaused || anyPaused,
        updatedAt: new Date(),
      })
      .where(eq(inboxConversations.id, survivor.id));

    // Contact repair: no phone contact yet -> the LID contact becomes it.
    if (pn && !phoneContact && survivorContact && group.lids.includes(survivorContact.phone ?? "")) {
      await tx
        .update(inboxContacts)
        .set({ phone: pn, updatedAt: new Date() })
        .where(eq(inboxContacts.id, survivorContact.id));
    }

    // Duplicate deals: re-point EVERYTHING that references them (other
    // conversations on other accounts included), move the activity trail,
    // drop the insights cache row, then reversible soft-delete.
    for (const dupId of dealPlan.duplicateDealIds) {
      if (dealPlan.survivorDealId) {
        await tx
          .update(inboxConversations)
          .set({ dealRecordId: dealPlan.survivorDealId })
          .where(eq(inboxConversations.dealRecordId, dupId));
        await tx
          .update(inboxMessageAttachments)
          .set({ dealRecordId: dealPlan.survivorDealId })
          .where(eq(inboxMessageAttachments.dealRecordId, dupId));
        await tx
          .update(activityEvents)
          .set({ recordId: dealPlan.survivorDealId })
          .where(eq(activityEvents.recordId, dupId));
      }
      await tx.execute(
        sql`DELETE FROM deal_insights_refresh_log WHERE deal_record_id = ${dupId}`
      );
      await tx
        .update(records)
        .set({
          deletedAt: new Date(),
          mergedIntoRecordId: dealPlan.survivorDealId,
        })
        .where(and(eq(records.id, dupId), isNull(records.deletedAt)));
    }
    for (const auftragId of dealPlan.auftraegeToSoftDelete) {
      await tx
        .update(records)
        .set({ deletedAt: new Date() })
        .where(and(eq(records.id, auftragId), isNull(records.deletedAt)));
    }
  });
  }

  // Person merges AFTER the conversation transaction (mergePersons opens its
  // own transaction; snapshots make every merge splittable) but BEFORE any
  // contact deletion, so a crash here can always be repaired by a re-run.
  let mergeFailed = false;
  if (survivorPerson) {
    for (const personId of personIds) {
      if (personId === survivorPerson) continue;
      const [row] = await db
        .select({ deletedAt: records.deletedAt })
        .from(records)
        .where(eq(records.id, personId))
        .limit(1);
      if (!row || row.deletedAt) continue; // already merged earlier
      try {
        await mergePersons({
          workspaceId: account.workspaceId,
          survivorId: survivorPerson,
          absorbedId: personId,
          method: "deterministic",
          confidence: 1,
          evidence: {
            reason: "lid-split-repair",
            lid: lidThreadKey,
            pn,
            pnSource: group.pnSource,
          },
        });
        details.push(`  Person ${personId.slice(0, 8)} -> ${survivorPerson.slice(0, 8)} gemerged`);
      } catch (err) {
        mergeFailed = true;
        details.push(
          `  ! Person-Merge ${personId.slice(0, 8)} fehlgeschlagen: ${err instanceof Error ? err.message : err}`
        );
      }
    }
    await reconcileHardIdentifier(account.workspaceId, survivorPerson, "wa_lid", lidThreadKey);
    if (pnCanon) {
      await reconcileHardIdentifier(account.workspaceId, survivorPerson, "phone", pnCanon);
    }
  }

  // Orphaned LID-digit contacts go last, and only when their person landed.
  if (!mergeFailed) {
    for (const ct of lidContacts) {
      if (survivorContact && ct.id === survivorContact.id) continue;
      if (ct.crmRecordId && ct.crmRecordId !== survivorPerson) {
        const [p] = await db
          .select({ deletedAt: records.deletedAt })
          .from(records)
          .where(eq(records.id, ct.crmRecordId))
          .limit(1);
        if (p && !p.deletedAt) continue; // person not merged — keep the contact
      }
      const left = await db
        .select({ id: inboxConversations.id })
        .from(inboxConversations)
        .where(eq(inboxConversations.contactId, ct.id))
        .limit(1);
      if (left.length === 0) {
        await db.delete(inboxContacts).where(eq(inboxContacts.id, ct.id));
        details.push(`  Kontakt ${ct.id.slice(0, 8)} (LID-Ziffern) geloescht`);
      }
    }
  }

  return {
    lid: lidLabel,
    pn,
    action: mergeFailed
      ? "merged+MERGE-FEHLER"
      : alreadyRepaired
        ? "identity-only"
        : absorbed.length > 0
          ? "merged"
          : "rekeyed+identity",
    details,
  };
}

// ─── Step 5: global identifier cleanup ────────────────────────────────────────

async function cleanupIdentifiers(corroboratedLids: Set<string>): Promise<string[]> {
  const out: string[] = [];
  const rows = await db
    .select()
    .from(personIdentifiers)
    .where(eq(personIdentifiers.kind, "phone"));

  const toDelete: typeof rows = [];
  const suspicious: string[] = [];
  for (const row of rows) {
    const canon = row.valueCanonical ?? "";
    if (!canon) continue;
    const digits = digitsOf(canon);
    const isKnownLidDerived = [...corroboratedLids].some(
      (lid) => lid.length >= 13 && (digits === lid || digits === `49${lid}`)
    );
    if (canonicalizePhone(canon) === null || isKnownLidDerived) {
      toDelete.push(row);
    } else if (/^\+4949\d{6,}/.test(canon)) {
      suspicious.push(`${row.id.slice(0, 8)}: ${canon}`);
    }
  }
  for (const row of toDelete) {
    // Full row into the run log — the delete is a hard delete by design
    // (these keys are provably corrupt), the log is the recovery trail.
    out.push(`  loesche korrupten phone-Identifier: ${JSON.stringify(row)}`);
  }
  if (APPLY && toDelete.length > 0) {
    await db.delete(personIdentifiers).where(
      inArray(personIdentifiers.id, toDelete.map((r) => r.id))
    );
  }
  if (suspicious.length > 0) {
    out.push(
      `  VERDAECHTIG (+4949..., manuell pruefen, nicht angefasst): ${suspicious.join("; ")}`
    );
  }
  return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(
    `LID-Split-Reparatur — ${APPLY ? "APPLY" : "DRY-RUN"}${ONLY_LID ? ` (nur LID ${ONLY_LID})` : ""}`
  );
  log("");

  let lockSql: postgres.Sql | null = null;
  if (APPLY) {
    if (!BRIDGE_STOPPED) {
      log(
        "--apply verlangt --bridge-stopped: erst die Baileys-Bridge auf dem VPS stoppen\n" +
          "(WhatsApp puffert eingehende Nachrichten serverseitig und liefert sie nach dem Neustart)."
      );
      process.exit(1);
    }
    // One apply run at a time, on a dedicated single connection so the
    // session-scoped advisory lock cannot hop pool connections.
    lockSql = postgres(normalizeDatabaseUrl(process.env.DATABASE_URL)!, {
      max: 1,
      ssl: "require",
    });
    const lockRes =
      await lockSql`select pg_try_advisory_lock(hashtext('repair-lid-splits')) as got`;
    if (!lockRes[0]?.got) {
      log("Ein anderer Reparatur-Lauf haelt den Lock — Abbruch.");
      process.exit(2);
    }
  }

  const accounts = await db
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.channelType, "whatsapp"),
        isNull(channelAccounts.waPhoneNumberId)
      )
    );
  log(`Baileys-Accounts: ${accounts.length}`);

  const { byAccount: lidMaps, authStateFailures } = await buildLidMaps(accounts);
  for (const account of accounts) {
    const m = lidMaps.get(account.id);
    log(
      `  ${account.name}: ${m?.reverse.size ?? 0} LID->PN-Mappings, ${m?.forward.size ?? 0} Forward-Eintraege`
    );
  }
  if (APPLY && authStateFailures > 0 && !IGNORE_AUTH_STATE) {
    log(
      `\nauth-state unlesbar fuer ${authStateFailures} Account(s) — die staerkste Beweisquelle fehlt.\n` +
        "SETTINGS_ENCRYPTION_KEY pruefen oder bewusst mit --ignore-auth-state fortfahren."
    );
    process.exit(1);
  }
  log("");

  const { groups, skippedBareKeys } = await collectGroups(accounts, lidMaps);
  log(`Reparatur-Gruppen: ${groups.length}`);
  for (const s of skippedBareKeys) log(`  ! ${s}`);
  log("");

  const results: GroupResult[] = [];
  for (const group of groups) {
    try {
      results.push(await repairGroup(group));
    } catch (err) {
      results.push({
        lid: group.targetLid ?? group.lids[0] ?? "?",
        pn: group.pn,
        action: "FEHLER",
        details: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const r of results) {
    log(`[${r.action}] LID ${r.lid}${r.error ? ` — FEHLER: ${r.error}` : ""}`);
    for (const d of r.details) log(`  ${d}`);
    log("");
  }

  if (ONLY_LID) {
    log("Identifier-Bereinigung: uebersprungen (--lid Canary, nur im Volllauf)");
  } else {
    const corroboratedLids = new Set(groups.flatMap((g) => g.lids));
    log("Identifier-Bereinigung:");
    const cleanup = await cleanupIdentifiers(corroboratedLids);
    cleanup.forEach((l) => log(l));
    if (cleanup.length === 0) log("  nichts zu tun");
  }
  log("");

  const merged = results.filter((r) => r.action.startsWith("merged") || r.action === "merge").length;
  const manual = results.filter((r) => r.action === "manual-review").length;
  const failed = results.filter((r) => r.action === "FEHLER").length;
  const unresolved = results.filter((r) => !r.pn).length;
  log(
    `Fertig. ${merged} Merges, ${manual} manuelle Pruefung, ${failed} Fehler, ` +
      `${unresolved} LIDs ohne PN-Aufloesung (bleiben wie sie sind, heilen sobald die Bridge ein Mapping lernt).`
  );
  if (!APPLY) log("\nDRY-RUN — nichts veraendert. Mit --apply --bridge-stopped ausfuehren.");

  if (lockSql) await lockSql.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("repair-lid-splits failed:", err);
  process.exit(1);
});
