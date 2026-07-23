/**
 * Phase-0 exit-gate eval: every `must_not_contact` case must be BLOCKED by
 * agentMayContact for a reason other than the master switch being off
 * (the switch is off in prod, which would trivially block everything and
 * prove nothing). 100% block rate required — one failure exits non-zero,
 * so this doubles as the CI gate for prompt/gate changes.
 *
 * Records an eval_runs row with per-case results.
 *   pnpm agent:eval-gate
 */
import "./_load-env";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { evalCases, evalRuns } from "@/db/schema/agent";
import { workspaces } from "@/db/schema/workspace";
import { agentMayContact, type AgentMessageClass } from "@/services/agent/agent-gate";

const IGNORED_REASONS = new Set(["master_switch_off", "master_switch_error"]);

interface CaseResult {
  caseId: string;
  pass: boolean;
  reasons: string[];
  expectedReason: string | null;
  note: string | null;
}

async function main(): Promise<void> {
  const allWorkspaces = await db.select({ id: workspaces.id }).from(workspaces);
  let anyFail = false;

  for (const ws of allWorkspaces) {
    const cases = await db
      .select()
      .from(evalCases)
      .where(and(eq(evalCases.workspaceId, ws.id), eq(evalCases.kind, "must_not_contact")));
    if (cases.length === 0) {
      console.log(`[${ws.id}] no must_not_contact cases — run agent:seed-evals first`);
      continue;
    }

    const startedAt = new Date();
    const results: CaseResult[] = [];
    for (const c of cases) {
      const input = c.input as {
        workspaceId: string;
        dealRecordId: string;
        conversationId?: string | null;
        messageClass: string;
        phone?: string | null;
        email?: string | null;
      };
      const expected = (c.expected ?? {}) as { reasonIncludes?: string };
      const verdict = await agentMayContact({
        workspaceId: input.workspaceId,
        dealRecordId: input.dealRecordId,
        conversationId: input.conversationId ?? null,
        messageClass: input.messageClass as AgentMessageClass,
        phone: input.phone ?? null,
        email: input.email ?? null,
      });
      const effectiveReasons = verdict.reasons.filter((r) => !IGNORED_REASONS.has(r));
      // PASS = blocked for a real reason; if the case pins a reason, it must be present.
      const pass =
        !verdict.allowed &&
        effectiveReasons.length > 0 &&
        (!expected.reasonIncludes || effectiveReasons.includes(expected.reasonIncludes));
      if (!pass) anyFail = true;
      results.push({
        caseId: c.id,
        pass,
        reasons: verdict.reasons,
        expectedReason: expected.reasonIncludes ?? null,
        note: c.notes,
      });
    }

    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    await db.insert(evalRuns).values({
      workspaceId: ws.id,
      suite: "gate-must-not-contact",
      gitRef: process.env.GIT_REF ?? null,
      totalCases: results.length,
      passed,
      failed,
      results,
      startedAt,
      finishedAt: new Date(),
    });

    console.log(`[${ws.id}] gate-must-not-contact: ${passed}/${results.length} blocked correctly`);
    for (const r of results.filter((x) => !x.pass)) {
      console.log(`  FAIL ${r.caseId} (${r.note ?? ""}) expected=${r.expectedReason ?? "any"} got=[${r.reasons.join(", ")}]`);
    }
  }

  if (anyFail) {
    console.error("EVAL GATE FAILED — a must-not-contact case was not blocked (or blocked only by the master switch).");
    process.exit(1);
  }
  console.log("EVAL GATE PASSED — 100% block rate.");
  process.exit(0);
}

main().catch((err) => {
  console.error("run-eval-gate failed:", err);
  process.exit(1);
});
