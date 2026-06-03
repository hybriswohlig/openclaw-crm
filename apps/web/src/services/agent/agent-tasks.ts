/**
 * Agent-created tasks. When the agent hands a lead off as ready to price, it
 * creates a task on the deal so it lands in the team's task list and on the
 * deal, assigned to the owner(s) with a 1-day deadline. When a quotation is
 * later saved for that deal, the open agent price-task is auto-completed so the
 * loop closes and overdue nudges stop.
 *
 * Agent tasks are identified by a content marker (the tasks table has no source
 * column), so this needs no migration.
 */

import { createTask, getTasksForRecord, updateTask } from "@/services/tasks";
import { ownerUserIds } from "./agent-shared";

export const AGENT_PRICE_TASK_MARKER = "[KI] Angebot kalkulieren";

type EnrichedTask = { id: string; content: string; isCompleted: boolean };

function isOpenAgentPriceTask(t: EnrichedTask): boolean {
  return !t.isCompleted && typeof t.content === "string" && t.content.startsWith(AGENT_PRICE_TASK_MARKER);
}

/** Create the price task once per deal (no duplicate while one is still open). */
export async function ensureAgentPriceTask(
  workspaceId: string,
  dealRecordId: string,
  hint: string
): Promise<void> {
  try {
    const existing = (await getTasksForRecord(dealRecordId)) as unknown as EnrichedTask[];
    if (existing.some(isOpenAgentPriceTask)) return;

    const owners = await ownerUserIds(workspaceId);
    if (owners.length === 0) return;

    const label = (hint || "neuer Lead").replace(/\s+/g, " ").trim().slice(0, 140);
    const deadline = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await createTask(`${AGENT_PRICE_TASK_MARKER}: ${label}`, owners[0], workspaceId, {
      deadline,
      recordIds: [dealRecordId],
      assigneeIds: owners,
    });
  } catch (err) {
    console.error("[agent-tasks] ensureAgentPriceTask failed (non-blocking):", err);
  }
}

/** Complete any open agent price-task for a deal (called when a quote is saved). */
export async function completeAgentPriceTasks(
  workspaceId: string,
  dealRecordId: string
): Promise<void> {
  try {
    const existing = (await getTasksForRecord(dealRecordId)) as unknown as EnrichedTask[];
    for (const t of existing) {
      if (isOpenAgentPriceTask(t)) {
        await updateTask(t.id, workspaceId, { isCompleted: true });
      }
    }
  } catch (err) {
    console.error("[agent-tasks] completeAgentPriceTasks failed (non-blocking):", err);
  }
}
