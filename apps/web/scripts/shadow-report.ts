/**
 * Phase-1 SHADOW report (docs/ai-sales-agent-plan.md, Phase 1).
 *
 * Aggregates the shadow instrumentation rows written by
 * src/services/agent/agent-shadow.ts (agent_events eventType 'shadow_gate' /
 * 'heartbeat', agent_drafts promptVersion 'shadow-v1') into a per-workspace
 * console report and one eval_runs row (suite 'shadow-report').
 *
 * Phase-1 EXIT METRIC — "eligibility false-passes" must be 0:
 * 'legacy_block_gate_allow' rows where the legacy engine blocked for a
 * must-not-contact reason (skip_advanced_stage / skip_decided_stage /
 * skip_suppressed) but the new gate would have ALLOWED. The script exits
 * non-zero ONLY when that count is > 0, so it doubles as a CI/cron gate.
 *
 *   pnpm agent:shadow-report [--days N]   (default 7)
 */
import "./_load-env";
import { db } from "@/db";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { agentDrafts, agentEvents, evalRuns, qualificationSlots } from "@/db/schema/agent";
import { inboxConversations } from "@/db/schema/inbox";
import { workspaces } from "@/db/schema/workspace";

const SHADOW_ENGINES = ["reply", "followup", "first_contact"] as const;
type ShadowEngine = (typeof SHADOW_ENGINES)[number];
// Liveness thresholds are cadence-aware: reply/first-contact crons run every
// 1-2 min, but followup is a DAILY 08:00 cron — consecutive healthy heartbeats
// are ~12 in-window hours apart, so a 2h bar would always false-alarm.
const GAP_THRESHOLD_HOURS: Record<ShadowEngine, number> = {
  reply: 2,
  first_contact: 2,
  followup: 26,
};

/** Legacy skip reasons that mean "must not contact" — a gate ALLOW here is a false-pass. */
const MUST_NOT_CONTACT_ACTIONS = new Set([
  "skip_advanced_stage",
  "skip_decided_stage",
  "skip_suppressed",
]);

/** Shape written by recordShadowGate (agent-shadow.ts). Defensive: jsonb is untyped. */
interface ShadowGateResults {
  legacy?: { action?: string; wouldSend?: boolean };
  gate?: { allowed?: boolean; reasons?: string[] };
  divergence?: string;
  messageClass?: string;
}

interface FalsePass {
  eventId: number;
  engine: string;
  legacyAction: string;
  gateReasons: string[];
  dealRecordId: string | null;
  conversationId: string | null;
  at: string;
}

function parseDays(argv: string[]): number {
  const idx = argv.indexOf("--days");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number.parseInt(argv[idx + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const kv = argv.find((a) => a.startsWith("--days="));
  if (kv) {
    const n = Number.parseInt(kv.slice("--days=".length), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 7;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Send window (Mon–Sat 08–20, Sun 10–19, Europe/Berlin; coarse) ────────────
const berlinFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  weekday: "short",
  hour: "numeric",
  hourCycle: "h23",
});

function isInSendWindow(d: Date): boolean {
  const parts = berlinFmt.formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  if (weekday === "Sun") return hour >= 10 && hour < 19;
  return hour >= 8 && hour < 20;
}

/** In-window hours between two instants, sampled in 10-minute steps (coarse by design). */
function inWindowHours(start: Date, end: Date): number {
  if (end.getTime() <= start.getTime()) return 0;
  const stepMs = 10 * 60_000;
  let minutes = 0;
  for (let t = start.getTime() + stepMs / 2; t < end.getTime(); t += stepMs) {
    if (isInSendWindow(new Date(t))) minutes += 10;
  }
  return minutes / 60;
}

function pct(part: number, total: number): string {
  return total > 0 ? `${((100 * part) / total).toFixed(1)}%` : "n/a";
}

async function main(): Promise<void> {
  const days = parseDays(process.argv.slice(2));
  const since = new Date(Date.now() - days * 86_400_000);
  const now = new Date();
  let anyFalsePass = false;

  console.log(`SHADOW REPORT — window: last ${days} day(s) (since ${since.toISOString()})`);

  const allWorkspaces = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces);

  for (const ws of allWorkspaces) {
    const startedAt = new Date();
    console.log(`\n${"=".repeat(78)}`);
    console.log(`WORKSPACE ${ws.name} (${ws.id})`);
    console.log("=".repeat(78));

    // ── Load shadow_gate rows ────────────────────────────────────────────────
    const gateRows = await db
      .select({
        id: agentEvents.id,
        engine: agentEvents.engine,
        dealRecordId: agentEvents.dealRecordId,
        conversationId: agentEvents.conversationId,
        gateResults: agentEvents.gateResults,
        createdAt: agentEvents.createdAt,
      })
      .from(agentEvents)
      .where(
        and(
          eq(agentEvents.workspaceId, ws.id),
          eq(agentEvents.eventType, "shadow_gate"),
          gte(agentEvents.createdAt, since)
        )
      );

    // (a) Per-engine totals + divergence counts.
    const perEngine = new Map<
      string,
      { total: number; agree: number; legacySendGateBlock: number; legacyBlockGateAllow: number; other: number }
    >();
    // (b) Eligibility false-passes.
    const falsePasses: FalsePass[] = [];
    // (c) legacy_send_gate_block buckets by gate-reason combination.
    const blockBuckets = new Map<string, number>();
    let consentOnlyBlocks = 0;
    let agreeTotal = 0;

    for (const row of gateRows) {
      const gr = (row.gateResults ?? {}) as ShadowGateResults;
      const divergence = gr.divergence ?? "unknown";
      const legacyAction = gr.legacy?.action ?? "unknown";
      const reasons = Array.isArray(gr.gate?.reasons) ? gr.gate.reasons : [];

      const stats = perEngine.get(row.engine) ?? {
        total: 0,
        agree: 0,
        legacySendGateBlock: 0,
        legacyBlockGateAllow: 0,
        other: 0,
      };
      stats.total += 1;
      if (divergence === "agree") {
        stats.agree += 1;
        agreeTotal += 1;
      } else if (divergence === "legacy_send_gate_block") {
        stats.legacySendGateBlock += 1;
        const consentOnly = reasons.length > 0 && reasons.every((r) => r === "no_proactive_consent");
        if (consentOnly) {
          consentOnlyBlocks += 1;
        } else {
          const key = `${row.engine} :: ${[...reasons].sort().join("+") || "(no reasons recorded)"}`;
          blockBuckets.set(key, (blockBuckets.get(key) ?? 0) + 1);
        }
      } else if (divergence === "legacy_block_gate_allow") {
        stats.legacyBlockGateAllow += 1;
        if (MUST_NOT_CONTACT_ACTIONS.has(legacyAction)) {
          falsePasses.push({
            eventId: row.id,
            engine: row.engine,
            legacyAction,
            gateReasons: reasons,
            dealRecordId: row.dealRecordId,
            conversationId: row.conversationId,
            at: row.createdAt.toISOString(),
          });
        }
      } else {
        stats.other += 1;
      }
      perEngine.set(row.engine, stats);
    }

    console.log(`\n[a] shadow_gate rows: ${gateRows.length}`);
    if (gateRows.length === 0) {
      console.log("    (no shadow_gate rows in window — is shadow mode enabled? pnpm agent:enable-shadow)");
    }
    for (const [engine, s] of [...perEngine.entries()].sort()) {
      console.log(
        `    ${engine.padEnd(13)} total=${s.total}  agree=${s.agree} (${pct(s.agree, s.total)})  ` +
          `legacy_send_gate_block=${s.legacySendGateBlock}  legacy_block_gate_allow=${s.legacyBlockGateAllow}` +
          (s.other > 0 ? `  unknown_divergence=${s.other}` : "")
      );
    }

    // (b) CRITICAL section.
    console.log(`\n[b] CRITICAL — eligibility false-passes (Phase-1 exit metric, must be 0): ${falsePasses.length}`);
    if (falsePasses.length === 0) {
      console.log("    OK — the new gate never allowed a must-not-contact deal (advanced/decided stage, suppressed).");
    } else {
      anyFalsePass = true;
      for (const fp of falsePasses) {
        console.log(
          `    FALSE-PASS event=${fp.eventId} engine=${fp.engine} legacyAction=${fp.legacyAction} ` +
            `deal=${fp.dealRecordId ?? "-"} conversation=${fp.conversationId ?? "-"} ` +
            `gateReasons=[${fp.gateReasons.join(", ")}] at=${fp.at}`
        );
      }
    }

    // (c) Gate-stricter divergences by reason.
    const gateBlockTotal = [...perEngine.values()].reduce((n, s) => n + s.legacySendGateBlock, 0);
    console.log(`\n[c] legacy_send_gate_block (gate stricter than legacy): ${gateBlockTotal}`);
    console.log(
      `    consent-only blocks (reason = no_proactive_consent only): ${consentOnlyBlocks} — INFORMATIONAL, ` +
        `expected while the consent ledger is empty (followup/first_contact mass-block on consent).`
    );
    if (blockBuckets.size === 0) {
      console.log("    no other gate-block buckets.");
    } else {
      for (const [key, count] of [...blockBuckets.entries()].sort((x, y) => y[1] - x[1])) {
        console.log(`    ${String(count).padStart(5)}  ${key}`);
      }
    }

    // (d) Drafts.
    const draftRows = await db
      .select({
        id: agentDrafts.id,
        messageClass: agentDrafts.messageClass,
        dealRecordId: agentDrafts.dealRecordId,
        filterVerdicts: agentDrafts.filterVerdicts,
      })
      .from(agentDrafts)
      .where(
        and(
          eq(agentDrafts.workspaceId, ws.id),
          eq(agentDrafts.promptVersion, "shadow-v1"),
          gte(agentDrafts.createdAt, since)
        )
      );
    const byClass = new Map<string, number>();
    const priceHits: { id: string; messageClass: string; dealRecordId: string }[] = [];
    for (const d of draftRows) {
      byClass.set(d.messageClass, (byClass.get(d.messageClass) ?? 0) + 1);
      const fv = (d.filterVerdicts ?? {}) as { priceOrCommitmentLeak?: boolean };
      if (fv.priceOrCommitmentLeak === true) {
        priceHits.push({ id: d.id, messageClass: d.messageClass, dealRecordId: d.dealRecordId });
      }
    }
    console.log(`\n[d] shadow drafts (promptVersion shadow-v1): ${draftRows.length}`);
    for (const [cls, count] of [...byClass.entries()].sort()) {
      console.log(`    ${cls.padEnd(15)} ${count}`);
    }
    console.log(
      `    price/commitment filter hits: ${priceHits.length}/${draftRows.length} (${pct(priceHits.length, draftRows.length)})`
    );
    for (const hit of priceHits) {
      console.log(`      HIT draft=${hit.id} class=${hit.messageClass} deal=${hit.dealRecordId}`);
    }

    // (e) Heartbeats + liveness.
    const hbRows = await db
      .select({ engine: agentEvents.engine, createdAt: agentEvents.createdAt })
      .from(agentEvents)
      .where(
        and(
          eq(agentEvents.workspaceId, ws.id),
          eq(agentEvents.eventType, "heartbeat"),
          gte(agentEvents.createdAt, since)
        )
      )
      .orderBy(asc(agentEvents.createdAt));
    const hbByEngine = new Map<string, Date[]>();
    for (const hb of hbRows) {
      const list = hbByEngine.get(hb.engine) ?? [];
      list.push(hb.createdAt);
      hbByEngine.set(hb.engine, list);
    }
    console.log(`\n[e] heartbeats (liveness; send window Mon–Sat 08–20 / Sun 10–19 Berlin):`);
    const heartbeatSummary: Record<string, { count: number; maxGapHours: number; warning: boolean }> = {};
    const livenessWarnings: string[] = [];
    for (const engine of SHADOW_ENGINES) {
      const stamps = hbByEngine.get(engine) ?? [];
      // Longest in-window gap between consecutive heartbeats, PLUS the trailing
      // gap (last heartbeat → now) so a silently-dead engine is caught.
      let maxGap = 0;
      for (let i = 1; i < stamps.length; i += 1) {
        maxGap = Math.max(maxGap, inWindowHours(stamps[i - 1], stamps[i]));
      }
      if (stamps.length > 0) {
        maxGap = Math.max(maxGap, inWindowHours(stamps[stamps.length - 1], now));
      }
      const warning = stamps.length === 0 || maxGap > GAP_THRESHOLD_HOURS[engine];
      heartbeatSummary[engine] = {
        count: stamps.length,
        maxGapHours: Number(maxGap.toFixed(2)),
        warning,
      };
      const line =
        `    ${engine.padEnd(13)} count=${stamps.length}  longest in-window gap=` +
        (stamps.length > 0 ? `${maxGap.toFixed(2)}h` : "n/a");
      if (warning) {
        const why =
          stamps.length === 0
            ? "zero heartbeats"
            : `gap ${maxGap.toFixed(2)}h > ${GAP_THRESHOLD_HOURS[engine]}h`;
        livenessWarnings.push(`${engine}: ${why}`);
        console.log(`${line}  <-- LIVENESS WARNING (${why})`);
      } else {
        console.log(line);
      }
    }

    // (f) Slot coverage over lead-lane deals touched by the shadow gate.
    const touchedDeals = [
      ...new Set(gateRows.map((r) => r.dealRecordId).filter((d): d is string => d !== null)),
    ];
    const leadDeals = new Set<string>();
    for (const part of chunk(touchedDeals, 500)) {
      const convRows = await db
        .select({ dealRecordId: inboxConversations.dealRecordId })
        .from(inboxConversations)
        .where(
          and(
            eq(inboxConversations.workspaceId, ws.id),
            eq(inboxConversations.lane, "lead"),
            inArray(inboxConversations.dealRecordId, part)
          )
        );
      for (const c of convRows) {
        if (c.dealRecordId) leadDeals.add(c.dealRecordId);
      }
    }
    const dealsWithSlots = new Set<string>();
    const slotsByStatus = new Map<string, number>();
    for (const part of chunk([...leadDeals], 500)) {
      const slotRows = await db
        .select({ dealRecordId: qualificationSlots.dealRecordId, status: qualificationSlots.status })
        .from(qualificationSlots)
        .where(
          and(eq(qualificationSlots.workspaceId, ws.id), inArray(qualificationSlots.dealRecordId, part))
        );
      for (const s of slotRows) {
        dealsWithSlots.add(s.dealRecordId);
        slotsByStatus.set(s.status, (slotsByStatus.get(s.status) ?? 0) + 1);
      }
    }
    console.log(`\n[f] slot coverage:`);
    console.log(`    deals touched by shadow gate: ${touchedDeals.length}  (lead-lane: ${leadDeals.size})`);
    console.log(
      `    lead-lane touched deals with >=1 qualification slot: ${dealsWithSlots.size}/${leadDeals.size} ` +
        `(${pct(dealsWithSlots.size, leadDeals.size)})`
    );
    for (const [status, count] of [...slotsByStatus.entries()].sort()) {
      console.log(`    slots ${status.padEnd(10)} ${count}`);
    }

    // ── Persist one eval_runs row per workspace ──────────────────────────────
    const summary = {
      days,
      windowStart: since.toISOString(),
      shadowGateRows: gateRows.length,
      perEngine: Object.fromEntries(perEngine.entries()),
      eligibilityFalsePasses: falsePasses,
      legacySendGateBlock: {
        total: gateBlockTotal,
        consentOnlyBlocks,
        buckets: Object.fromEntries(blockBuckets.entries()),
      },
      drafts: {
        total: draftRows.length,
        byMessageClass: Object.fromEntries(byClass.entries()),
        priceLeakHits: priceHits,
        priceLeakRate: draftRows.length > 0 ? priceHits.length / draftRows.length : null,
      },
      heartbeats: heartbeatSummary,
      livenessWarnings,
      slotCoverage: {
        touchedDeals: touchedDeals.length,
        leadLaneTouchedDeals: leadDeals.size,
        leadLaneDealsWithSlots: dealsWithSlots.size,
        slotsByStatus: Object.fromEntries(slotsByStatus.entries()),
      },
    };
    await db.insert(evalRuns).values({
      workspaceId: ws.id,
      suite: "shadow-report",
      gitRef: process.env.GIT_REF ?? null,
      promptVersion: "shadow-v1",
      totalCases: gateRows.length,
      passed: agreeTotal + consentOnlyBlocks,
      failed: falsePasses.length,
      results: summary,
      startedAt,
      finishedAt: new Date(),
    });
    console.log(`\n    eval_runs row written (suite=shadow-report).`);
  }

  console.log(`\n${"=".repeat(78)}`);
  if (anyFalsePass) {
    console.error(
      "SHADOW REPORT: FAIL — eligibility false-passes > 0 (new gate allowed a must-not-contact deal). Phase 1 must not exit."
    );
    process.exit(1);
  }
  console.log("SHADOW REPORT: OK — 0 eligibility false-passes.");
  process.exit(0);
}

main().catch((err) => {
  console.error("shadow-report failed:", err);
  process.exit(1);
});
