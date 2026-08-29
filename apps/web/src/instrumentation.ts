/**
 * Next.js boot hook: runs once on the Node.js server side.
 *
 * Idempotently syncs `STANDARD_OBJECTS` (new lead-source options, new
 * attributes like `utm_campaign`/`utm_content`) into the singleton workspace
 * so production picks them up without manual intervention.
 *
 * Edge runtime is skipped — only the Node runtime has DB access.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SKIP_BOOT_SYNC_STANDARD_OBJECTS === "1") return;

  // Defer the heavy imports so route collection / build-time analysis stays light.
  const { getSingletonWorkspaceId, syncStandardObjectExtras } = await import(
    "@/services/workspace"
  );

  try {
    const workspaceId = await getSingletonWorkspaceId();
    if (!workspaceId) {
      // No workspace yet (fresh install before `db:seed`). Nothing to backfill.
      return;
    }
    const result = await syncStandardObjectExtras(workspaceId);
    if (
      result.objectsAdded ||
      result.attributesAdded ||
      result.optionsAdded ||
      result.stagesAdded
    ) {
      console.log(
        `[boot] syncStandardObjectExtras: +${result.objectsAdded} object(s), +${result.attributesAdded} attr(s), +${result.optionsAdded} option(s), +${result.stagesAdded} stage(s)`
      );
    }
  } catch (err) {
    // Never block app boot on backfill — log and continue.
    console.error("[boot] syncStandardObjectExtras failed:", err);
  }
}
