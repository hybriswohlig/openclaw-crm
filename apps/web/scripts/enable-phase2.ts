/**
 * Phase-2 switch (docs/ai-sales-agent-plan.md): approval queue is live in the
 * inbox; the operator sends every message. This script only flips the
 * §7-UWG-safe opt-out line ON (appended to PROACTIVE approved sends:
 * follow-ups / first contact). Engines stay in dry-run — autonomy is
 * unchanged; Send remains a human tap.
 *
 *   pnpm agent:enable-phase2 [--apply]
 */
import "./_load-env";
import { db } from "@/db";
import { workspaces } from "@/db/schema/workspace";
import { getAgentSettings, setAgentSettings } from "@/services/agent/agent-config";

const APPLY = process.argv.includes("--apply");

async function main(): Promise<void> {
  const all = await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces);
  for (const ws of all) {
    const before = await getAgentSettings(ws.id);
    console.log(`WORKSPACE ${ws.name ?? ws.id}`);
    console.log(`  optOutLine currently: ${before.optOutLine}`);
    if (!APPLY) {
      console.log("  would set: optOutLine=true (STOP-Zeile an proaktiven Sends)");
      continue;
    }
    await setAgentSettings(ws.id, { optOutLine: true });
    console.log("  set: optOutLine=true");
  }
  console.log(
    APPLY
      ? "\nPhase 2 armed: STOP/opt-out line ON. Engines remain dry-run — every send is a human tap in the inbox."
      : "\nDRY RUN — re-run with --apply."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("enable-phase2 failed:", err);
  process.exit(1);
});
