/**
 * Enable Phase-1 SHADOW MODE (docs/ai-sales-agent-plan.md, Phase 1).
 *
 * Idempotent. For every workspace it turns the agent control plane ON but with
 * dry-run EXPLICITLY true everywhere, so all three engines run their decision
 * paths (shadow_gate rows, drafts, heartbeats) while NOTHING is ever sent:
 *
 *   - sales_agent_enabled            = true
 *   - sales_agent_dry_run            = true  (explicit, not just the default)
 *   - per-engine dry-run keys        = true  (reply / followup / first_contact,
 *                                      explicit via setEngineDryRun so a later
 *                                      shared-flag flip cannot arm an engine)
 *   - sales_followup_enabled         = true
 *   - first contact                  = ON via setAgentSettings({firstContactEnabled})
 *                                      so the OFF->ON watermark is stamped and
 *                                      only leads created AFTER now are eligible
 *                                      (never write the raw key directly).
 *
 * Default is a preview (--dry-run): prints current state + what WOULD change.
 * Run with --apply to actually write.
 *
 *   pnpm agent:enable-shadow            # preview only
 *   pnpm agent:enable-shadow -- --apply # write settings
 */
import "./_load-env";
import { db } from "@/db";
import { workspaces } from "@/db/schema/workspace";
import {
  isSalesAgentEnabled,
  isSalesAgentDryRun,
  isEngineDryRun,
  setEngineDryRun,
  setAgentSettings,
  isSalesFollowupEnabled,
  isFirstContactEnabled,
  getFirstContactEnabledAt,
  type AgentEngine,
} from "@/services/agent/agent-config";

const ENGINES: AgentEngine[] = ["reply", "followup", "first_contact"];

interface SwitchState {
  enabled: boolean;
  sharedDryRun: boolean;
  engineDryRun: Record<AgentEngine, boolean>;
  followupEnabled: boolean;
  firstContactEnabled: boolean;
  firstContactEnabledAt: string | null;
}

async function readState(workspaceId: string): Promise<SwitchState> {
  const [enabled, sharedDryRun, followupEnabled, firstContactEnabled, firstContactEnabledAt] =
    await Promise.all([
      isSalesAgentEnabled(workspaceId),
      isSalesAgentDryRun(workspaceId),
      isSalesFollowupEnabled(workspaceId),
      isFirstContactEnabled(workspaceId),
      getFirstContactEnabledAt(workspaceId),
    ]);
  const engineDryRun = {} as Record<AgentEngine, boolean>;
  for (const engine of ENGINES) {
    engineDryRun[engine] = await isEngineDryRun(workspaceId, engine);
  }
  return {
    enabled,
    sharedDryRun,
    engineDryRun,
    followupEnabled,
    firstContactEnabled,
    firstContactEnabledAt: firstContactEnabledAt ? firstContactEnabledAt.toISOString() : null,
  };
}

function printState(label: string, s: SwitchState): void {
  console.log(`  ${label}:`);
  console.log(`    sales_agent_enabled        = ${s.enabled}`);
  console.log(`    sales_agent_dry_run        = ${s.sharedDryRun}`);
  for (const engine of ENGINES) {
    console.log(`    dry_run[${engine.padEnd(13)}]     = ${s.engineDryRun[engine]}`);
  }
  console.log(`    sales_followup_enabled     = ${s.followupEnabled}`);
  console.log(`    sales_first_contact_enabled= ${s.firstContactEnabled}`);
  console.log(`    first_contact_enabled_at   = ${s.firstContactEnabledAt ?? "(unset)"}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  console.log(
    apply
      ? "ENABLE SHADOW MODE — APPLY (writing settings)"
      : "ENABLE SHADOW MODE — DRY RUN (preview only; re-run with --apply to write)"
  );

  const allWorkspaces = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces);

  for (const ws of allWorkspaces) {
    console.log(`\nWORKSPACE ${ws.name} (${ws.id})`);
    const before = await readState(ws.id);
    printState("current", before);

    if (!apply) {
      console.log("  would set: sales_agent_enabled=true, sales_agent_dry_run=true (explicit),");
      console.log("             dry_run[reply|followup|first_contact]=true (explicit),");
      console.log("             sales_followup_enabled=true,");
      console.log(
        "             firstContactEnabled=true via setAgentSettings" +
          (before.firstContactEnabled
            ? " (already ON — watermark stays " + (before.firstContactEnabledAt ?? "unset") + ")"
            : " (OFF->ON — watermark will be stamped to now)")
      );
      continue;
    }

    // ORDER MATTERS: persist every dry-run guarantee BEFORE arming the master
    // switch, so no cron tick can ever observe enabled=true with dry-run still
    // unset (setAgentSettings writes enabled before dryRun internally).
    await setAgentSettings(ws.id, { dryRun: true });
    for (const engine of ENGINES) {
      await setEngineDryRun(ws.id, engine, true);
    }
    // Now arm. firstContactEnabled MUST go through setAgentSettings so the
    // OFF->ON watermark (sales_first_contact_enabled_at) is stamped correctly.
    await setAgentSettings(ws.id, {
      enabled: true,
      followupEnabled: true,
      firstContactEnabled: true,
    });

    const after = await readState(ws.id);
    printState("resulting", after);
  }

  console.log(`\n${"#".repeat(78)}`);
  if (apply) {
    console.log("# SHADOW MODE IS ON — NOTHING WILL SEND.");
    console.log("# sales_agent_dry_run=true AND every per-engine dry-run key is explicitly");
    console.log("# true, so all engines only observe, log shadow_gate/heartbeat events and");
    console.log("# capture drafts. No message, offer, or stage change reaches a customer.");
  } else {
    console.log("# PREVIEW ONLY — no settings were written. Re-run with --apply.");
    console.log("# After apply, everything stays dry-run: NOTHING will send.");
  }
  console.log("# To disable the agent entirely: setAgentSettings(ws, { enabled: false })");
  console.log("# or flip the master switch in the Settings UI.");
  console.log("#".repeat(78));
  process.exit(0);
}

main().catch((err) => {
  console.error("enable-shadow failed:", err);
  process.exit(1);
});
