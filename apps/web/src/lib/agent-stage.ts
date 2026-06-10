// apps/web/src/lib/agent-stage.ts
//
// The inbox sales-agent funnel stage — its type, funnel order, and a legacy
// normaliser. Kept free of any DB/Drizzle import so client components (inbox
// list badge, context panel) can use it without pulling server code into the
// bundle. The DB schema (db/schema/inbox.ts) re-exports the type from here.

/** Sales-agent funnel sub-stage shown as an inbox badge. */
export type AgentStage =
  | "erstkontakt"
  | "infos_erhalten"
  | "angebot_raus"
  | "angenommen"
  | "verloren";

/**
 * Funnel order. The auto-classifier may only ADVANCE or HOLD the stage — it
 * never regresses below the currently stored stage (a manually set stage is
 * therefore a floor the cron cannot fall behind). Verloren ranks last so a
 * lost lead stays lost unless a human moves it.
 */
export const AGENT_STAGE_RANK: Record<AgentStage, number> = {
  erstkontakt: 1,
  infos_erhalten: 2,
  angebot_raus: 3,
  angenommen: 4,
  verloren: 5,
};

/**
 * Coerce any stored stage value — including the pre-2026-06 legacy set — onto
 * the current union. Returns null for unknown/missing so callers can fall back
 * to "no badge".
 */
export function normalizeAgentStage(
  raw: string | null | undefined
): AgentStage | null {
  switch (raw) {
    case "erstkontakt":
    case "infos_erhalten":
    case "angebot_raus":
    case "angenommen":
    case "verloren":
      return raw;
    // ── legacy → current ──
    case "neu":
    case "sammelt_infos":
      return "erstkontakt";
    case "bereit_kalkulieren":
      return "infos_erhalten";
    case "wartet_kunde":
      return "angebot_raus";
    default:
      return null;
  }
}
