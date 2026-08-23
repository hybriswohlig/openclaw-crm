/**
 * One-off migration: Bestandsaufgaben -> Projekte & operative Aufgaben
 * (spec §12). Thin executor over the pure planners in
 * `@/lib/task-migration-map`.
 *
 * DRY-RUN BY DEFAULT. Nothing is written without --apply. One script, modes
 * selected by flag:
 *
 *   pnpm --filter @openclaw-crm/web tasks:migrate                      # dry-run table
 *   pnpm --filter @openclaw-crm/web tasks:migrate --apply               # writes
 *   pnpm --filter @openclaw-crm/web tasks:migrate --verify              # spec §14 checks
 *   pnpm --filter @openclaw-crm/web tasks:migrate --rollback <datei> --apply
 *
 * Re-runnable: projects match by name, seeded tasks by content inside their
 * project, the sprint by name — a second --apply changes nothing.
 *
 * --verify never writes and does not require --apply; it only reads the
 * database (plus the newest file in .migration-backups/, if any) and prints
 * the spec §14 checks.
 *
 * --rollback is NOT YET IMPLEMENTED. The flag is recognised so this header
 * stays honest about the tool's target shape, but invoking it refuses to run
 * rather than silently re-running the forward migration (see the guard at
 * the top of main()).
 *
 * NEVER run `pnpm db:push` / `drizzle-kit push` in this repo: it targets the
 * production database regardless of the env var set. Schema changes are
 * applied with `db:migrate` only. This script touches rows, never DDL.
 */
import "./_load-env";
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { tasks, taskAssignees, taskRecords, taskComments } from "@/db/schema/tasks";
import { projects, projectMembers } from "@/db/schema/projects";
import { sprints } from "@/db/schema/sprints";
import { workspaces } from "@/db/schema/workspace";
import { users } from "@/db/schema/auth";
import { createTask } from "@/services/tasks";
import { recordProjectEvent } from "@/services/activity-events";
// Rule 7 (sprint rotation): closeSprint/createSprint/activateSprint fire NO
// activity events or notifications (verified by reading services/sprints.ts
// in full — it imports only db, the schema and drizzle-orm helpers), unlike
// services/tasks.ts's updateTask, which is why task updates below go
// through raw db.update() instead (see the note at applyPlan step 2). Using
// the sprint service here is therefore safe AND reuses its already-tested
// carry-over logic (unfinished tasks -> backlog) and metricsBasis: "tasks"
// write instead of reimplementing them by hand.
import { closeSprint, createSprint, activateSprint } from "@/services/sprints";
import {
  MIGRATION_OWNER_EMAIL,
  migrationStatusColumns,
  planTaskMigration,
  planSprintRotation,
  evaluateVerification,
  type MigrationPlan,
  type MigrationTaskRow,
  type SprintRotationPlan,
  type VerificationInput,
} from "@/lib/task-migration-map";

const ARGV = process.argv.slice(2);
const APPLY = ARGV.includes("--apply");
const VERIFY = ARGV.includes("--verify");
const ROLLBACK_INDEX = ARGV.indexOf("--rollback");
const ROLLBACK_FILE = ROLLBACK_INDEX >= 0 ? (ARGV[ROLLBACK_INDEX + 1] ?? null) : null;
const BACKUP_DIR = path.resolve(__dirname, "../.migration-backups");

type Row = Record<string, unknown>;

export interface MigrationBackup {
  createdAt: string;
  workspaceId: string;
  taskCountBefore: number;
  containersDeleted: number;
  tasksCreated: number;
  touchedTasks: Row[];
  deletedTasks: Row[];
  deletedTaskAssignees: Row[];
  deletedTaskRecords: Row[];
  deletedTaskComments: Row[];
  sprintsBefore: Row[];
  createdProjectIds: string[];
  createdTaskIds: string[];
  createdSprintIds: string[];
}

// ─── resolution (nothing is hardcoded that can be looked up) ───────────

async function resolveWorkspace(): Promise<{ id: string; name: string }> {
  const rows = await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces);
  if (rows.length !== 1) {
    throw new Error(
      `Erwartet genau einen Workspace, gefunden: ${rows.length}. Migration abgebrochen.`
    );
  }
  return rows[0];
}

async function resolveOwnerUserId(): Promise<string> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, MIGRATION_OWNER_EMAIL))
    .limit(1);
  if (!row) {
    throw new Error(
      `Benutzer ${MIGRATION_OWNER_EMAIL} nicht gefunden — ohne Projektleiter wird nicht migriert.`
    );
  }
  return row.id;
}

// ─── loading ──────────────────────────────────────────────────────────

async function loadFullTaskRows(workspaceId: string) {
  return db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId));
}

function toMigrationRows(rows: Awaited<ReturnType<typeof loadFullTaskRows>>): MigrationTaskRow[] {
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    isCompleted: r.isCompleted,
    kanbanStatus: r.kanbanStatus,
    parentTaskId: r.parentTaskId,
    sprintId: r.sprintId,
    growthCategory: r.growthCategory,
    priority: r.priority,
    kind: r.kind,
    projectId: r.projectId,
    area: r.area,
    status: r.status,
  }));
}

// ─── verify (spec §14) ──────────────────────────────────────────────────
//
// Read-only by construction: every value below comes from a SELECT or from
// reading a backup JSON file, never a write. `evaluateVerification` itself
// is pure and unit-tested in task-migration-map.test.ts — this function's
// only job is to gather its input and print the result.

/** The newest valid backup in .migration-backups/, or null if none exists. */
function findNewestBackup(): MigrationBackup | null {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith(".json"));
  let newest: MigrationBackup | null = null;
  let newestTime = -Infinity;
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, file), "utf8")) as MigrationBackup;
      const t = Date.parse(parsed.createdAt);
      if (!Number.isNaN(t) && t > newestTime) {
        newestTime = t;
        newest = parsed;
      }
    } catch {
      // Kaputte oder fremde Datei im Backup-Ordner — überspringen, nicht abbrechen.
      continue;
    }
  }
  return newest;
}

/** A single `SELECT COUNT(*)::int AS n ...` result, unwrapped to a number. */
async function countRows(query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await db.execute(query)) as unknown as Array<{ n: number | string | null }>;
  return Number(rows[0]?.n ?? 0);
}

async function runVerification(workspaceId: string): Promise<void> {
  const [
    projektWithoutProject,
    operativWithProject,
    phaseMismatch,
    statusMismatch,
    orphanParents,
    danglingProjectRefs,
    leiterMismatch,
    taskCountNow,
  ] = await Promise.all([
    // I1, direction 1: kind='projekt' rows must carry a project_id.
    countRows(sql`
      SELECT COUNT(*)::int AS n FROM tasks
      WHERE workspace_id = ${workspaceId} AND kind = 'projekt' AND project_id IS NULL
    `),
    // I1, direction 2: only kind='projekt' rows may carry a project_id.
    countRows(sql`
      SELECT COUNT(*)::int AS n FROM tasks
      WHERE workspace_id = ${workspaceId} AND kind <> 'projekt' AND project_id IS NOT NULL
    `),
    // I2: a task's phase must belong to the task's own project.
    countRows(sql`
      SELECT COUNT(*)::int AS n
      FROM tasks t
      JOIN project_phases ph ON ph.id = t.phase_id
      WHERE t.workspace_id = ${workspaceId}
        AND t.phase_id IS NOT NULL
        AND (t.project_id IS NULL OR ph.project_id <> t.project_id)
    `),
    // I3: status='erledigt' must agree with is_completed.
    countRows(sql`
      SELECT COUNT(*)::int AS n FROM tasks
      WHERE workspace_id = ${workspaceId} AND is_completed <> (status = 'erledigt')
    `),
    // No FK on parent_task_id — a dangling parent must be found, not assumed away.
    countRows(sql`
      SELECT COUNT(*)::int AS n
      FROM tasks t
      WHERE t.workspace_id = ${workspaceId}
        AND t.parent_task_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM tasks p WHERE p.id = t.parent_task_id)
    `),
    // project_id must point at a real project.
    countRows(sql`
      SELECT COUNT(*)::int AS n
      FROM tasks t
      WHERE t.workspace_id = ${workspaceId}
        AND t.project_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = t.project_id)
    `),
    // Exactly one project_members role='leiter' row matching owner_user_id
    // (zero = missing leader, >1 total or a mismatched user_id = duplicate
    // left behind by an owner handover); for an owner-less project, zero
    // leiter rows.
    countRows(sql`
      SELECT COUNT(*)::int AS n FROM (
        SELECT p.id,
               p.owner_user_id AS owner_user_id,
               COUNT(pm.id) AS leiter_count,
               COUNT(pm.id) FILTER (WHERE pm.user_id = p.owner_user_id) AS matching_count
        FROM projects p
        LEFT JOIN project_members pm
          ON pm.project_id = p.id AND pm.role = 'leiter'
        WHERE p.workspace_id = ${workspaceId}
        GROUP BY p.id, p.owner_user_id
      ) x
      WHERE (owner_user_id IS NOT NULL AND (leiter_count <> 1 OR matching_count <> 1))
         OR (owner_user_id IS NULL AND leiter_count > 0)
    `),
    countRows(sql`SELECT COUNT(*)::int AS n FROM tasks WHERE workspace_id = ${workspaceId}`),
  ]);

  const backup = findNewestBackup();

  const input: VerificationInput = {
    projektWithoutProject,
    operativWithProject,
    phaseMismatch,
    statusMismatch,
    orphanParents,
    danglingProjectRefs,
    leiterMismatch,
    taskCountBefore: backup ? backup.taskCountBefore : null,
    containersDeleted: backup ? backup.containersDeleted : null,
    tasksCreated: backup ? backup.tasksCreated : null,
    taskCountNow,
  };

  const result = evaluateVerification(input);

  console.log("\n=== Verifikation (spec §14, schreibgeschützt) ===\n");
  console.log(
    backup
      ? `Backup verwendet für die Aufgabenzahl-Prüfung: ${backup.createdAt}`
      : "Kein Backup in .migration-backups/ gefunden — die Aufgabenzahl-Prüfung wird als SKIP ausgewiesen."
  );
  console.table(
    result.checks.map((c) => ({
      Prüfung: c.name,
      Erwartet: c.expected,
      Ist: c.actual,
      Status: c.status,
    }))
  );

  if (result.passed) {
    console.log("\nAlle Prüfungen bestanden.");
  } else {
    console.log("\nMindestens eine Prüfung ist fehlgeschlagen — siehe Tabelle oben.");
    process.exitCode = 1;
  }
}

// ─── dry-run output ───────────────────────────────────────────────────

function truncate(value: string, width: number): string {
  return value.length <= width ? value.padEnd(width) : `${value.slice(0, width - 1)}…`;
}

function printPlan(plan: MigrationPlan, workspaceName: string): void {
  console.log(
    `\n=== Aufgaben -> Projekte — ${APPLY ? "APPLY (schreibend)" : "DRY-RUN (keine Änderung)"} ===`
  );
  console.log(`Workspace: ${workspaceName}\n`);

  console.log("── Projekte ────────────────────────────────────────────────");
  for (const p of plan.projects) {
    console.log(
      `  ${p.existingId ? "[VORHANDEN]" : "[NEU]      "} ${truncate(p.name, 38)} ` +
        `${truncate(p.category, 11)} ${truncate(p.priority, 10)} ` +
        `${p.sourceTaskCount} Quellaufgaben`
    );
  }

  console.log("\n── Container, die aufgelöst werden ─────────────────────────");
  if (plan.deletions.length === 0) console.log("  (keine)");
  for (const d of plan.deletions) {
    console.log(
      `  LÖSCHEN  ${truncate(d.title, 46)} -> ${d.childCount} Kinder nach "${d.projectKey}"`
    );
  }

  console.log("\n── Neue Aufgaben ───────────────────────────────────────────");
  if (plan.newTasks.length === 0) console.log("  (keine)");
  for (const n of plan.newTasks) {
    console.log(`  NEU      ${truncate(n.content, 60)} -> ${n.projectKey}`);
  }

  console.log("\n── Zuordnung Aufgabe -> Ziel ───────────────────────────────");
  for (const u of [...plan.updates].sort((a, b) => a.target.localeCompare(b.target))) {
    const flag = u.changed ? (u.clearParent ? "UMHÄNGEN" : "ÄNDERN  ") : "unverändert";
    console.log(
      `  ${truncate(flag, 11)} ${truncate(u.title, 56)} ${truncate(u.status, 10)} -> ${u.target}`
    );
  }

  if (plan.warnings.length > 0) {
    console.log("\n── Warnungen (bitte prüfen) ────────────────────────────────");
    for (const w of plan.warnings) console.log(`  ! ${w}`);
  }

  console.log("\n── Zusammenfassung ─────────────────────────────────────────");
  console.table([
    {
      Aufgaben_vorher: plan.counts.tasksBefore,
      Projektaufgaben: plan.counts.projectTasks,
      Operative: plan.counts.operativeTasks,
      Container_geloescht: plan.counts.containersDeleted,
      Neu_angelegt: plan.counts.tasksCreated,
      Aufgaben_nachher: plan.counts.tasksAfter,
      Zu_aendern: plan.updates.filter((u) => u.changed).length,
    },
  ]);
}

/**
 * C8 / spec Rule 7: print what planSprintRotation() decided, same table
 * style as printPlan's "Zusammenfassung", so the rotation can be reviewed
 * BEFORE --apply the same way the task table above it is.
 */
function printSprintRotation(rotation: SprintRotationPlan): void {
  console.log("\n── Sprint-Rotation (Regel 7) ────────────────────────────────");
  console.table([
    {
      Schliessen: rotation.closeSprintId ? rotation.closeSprintName : "(kein aktiver Sprint)",
      Neu_anlegen: rotation.createSprint ? rotation.createSprint.name : "(keiner)",
      Start: rotation.createSprint?.startDate ?? "–",
      Ende: rotation.createSprint?.endDate ?? "–",
      Vorhandenen_aktivieren: rotation.activateExistingSprintId ? "ja" : "–",
    },
  ]);
  for (const n of rotation.notes) console.log(`  ${n}`);
}

// ─── apply ────────────────────────────────────────────────────────────

async function applyPlan(
  workspaceId: string,
  ownerUserId: string,
  plan: MigrationPlan,
  allRows: Awaited<ReturnType<typeof loadFullTaskRows>>,
  sprintRotation: SprintRotationPlan
): Promise<void> {
  const touchedIds = new Set(plan.updates.filter((u) => u.changed).map((u) => u.taskId));
  const deletedIds = plan.deletions.map((d) => d.taskId);
  const deletedSet = new Set(deletedIds);

  const backup: MigrationBackup = {
    createdAt: new Date().toISOString(),
    workspaceId,
    taskCountBefore: allRows.length,
    containersDeleted: deletedIds.length,
    tasksCreated: plan.newTasks.length,
    touchedTasks: allRows.filter((r) => touchedIds.has(r.id)) as unknown as Row[],
    deletedTasks: allRows.filter((r) => deletedSet.has(r.id)) as unknown as Row[],
    deletedTaskAssignees: deletedIds.length
      ? ((await db
          .select()
          .from(taskAssignees)
          .where(inArray(taskAssignees.taskId, deletedIds))) as unknown as Row[])
      : [],
    deletedTaskRecords: deletedIds.length
      ? ((await db
          .select()
          .from(taskRecords)
          .where(inArray(taskRecords.taskId, deletedIds))) as unknown as Row[])
      : [],
    deletedTaskComments: deletedIds.length
      ? ((await db
          .select()
          .from(taskComments)
          .where(inArray(taskComments.taskId, deletedIds))) as unknown as Row[])
      : [],
    sprintsBefore: (await db
      .select()
      .from(sprints)
      .where(eq(sprints.workspaceId, workspaceId))) as unknown as Row[],
    createdProjectIds: [],
    createdTaskIds: [],
    createdSprintIds: [],
  };

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = path.join(BACKUP_DIR, `${backup.createdAt.replace(/[:.]/g, "-")}.json`);
  const flush = () => fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
  flush();
  console.log(`\nBackup geschrieben: ${backupPath}`);

  try {
    // 1. Projects. Each project and its Projektleiter membership go in ONE
    //    transaction. The index's Interface Contract makes them a single
    //    fact — "the project leader is ADDITIONALLY entered as a member with
    //    role 'leiter', so avatar stacks and permission displays have a
    //    single source" — and Phase 4 reads the owner out of `members`, not
    //    out of `owner_user_id`. Without that row the Projektverantwortlicher
    //    KPI reads "Nicht zugewiesen", the Übersicht InfoRow reads
    //    "Projektleiter: –", the header avatar stack is empty and no "Leiter"
    //    pill renders — and no UI path writes `owner_user_id`, so it could
    //    only be repaired over the API. The transaction makes the two writes
    //    inseparable; onConflictDoNothing targets the named UNIQUE constraint
    //    `project_members_project_user_uniq` from Phase 1, so a re-run is a
    //    no-op rather than a duplicate 'leiter'.
    const projectIdByKey = new Map<string, string>();
    const createdProjects: Array<{ id: string; name: string }> = [];
    for (const p of plan.projects) {
      if (p.existingId) {
        projectIdByKey.set(p.key, p.existingId);
        continue;
      }
      const ownerId = p.ownerUserId ?? ownerUserId;
      const createdId = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(projects)
          .values({
            workspaceId,
            name: p.name,
            shortDescription: p.shortDescription,
            category: p.category,
            priority: p.priority,
            status: "aktiv",
            icon: p.icon,
            color: p.color,
            ownerUserId: ownerId,
            createdBy: ownerUserId,
            updatedAt: new Date(),
          })
          .returning({ id: projects.id });
        await tx
          .insert(projectMembers)
          .values({ workspaceId, projectId: created.id, userId: ownerId, role: "leiter" })
          .onConflictDoNothing({
            target: [projectMembers.projectId, projectMembers.userId],
          });
        return created.id;
      });
      projectIdByKey.set(p.key, createdId);
      backup.createdProjectIds.push(createdId);
      createdProjects.push({ id: createdId, name: p.name });
      flush();
      console.log(`  Projekt angelegt: ${p.name} (Projektleiter gesetzt)`);
    }

    // 1b. Activity rows, exactly as createProject() writes them — outside the
    //     transaction, same as the service. "project.created" is NOT one of
    //     the four §10.2 notification triggers, so recordProjectEvent() writes
    //     the activity row only and nobody is pinged eight times. Without
    //     these the Aktivität tab of all eight projects would start empty.
    for (const created of createdProjects) {
      await recordProjectEvent({
        workspaceId,
        projectId: created.id,
        projectName: created.name,
        eventType: "project.created",
        actorId: ownerUserId,
        title: "Neues Projekt",
        body: `"${created.name}" wurde bei der Migration der Bestandsaufgaben angelegt.`,
      });
    }

    // 2. Reparent and retag BEFORE any delete. `tasks.parent_task_id` has NO
    //    foreign key: deleting a container first would silently orphan its
    //    children. This loop nulls the link and moves the child into the
    //    project in one UPDATE.
    //
    //    Sanctioned exception to spec §15 R2 ("services/tasks.ts is the only
    //    write path for `tasks` in new code"): a 214-row bulk migration cannot
    //    pay for a per-row service call, and the service does work a migration
    //    must NOT trigger — activity events, notifications, subtask cascades.
    //    The invariant is preserved by construction instead: `status`,
    //    `is_completed` and `completed_at` come ONLY from
    //    migrationStatusColumns(), which is unit-tested for every TaskStatus.
    //    Never assemble those three fields inline here.
    const completedAtById = new Map(allRows.map((r) => [r.id, r.completedAt]));
    let updated = 0;
    for (const u of plan.updates) {
      if (!u.changed) continue;
      const setValues: Record<string, unknown> = {
        kind: u.kind,
        projectId: u.projectKey ? (projectIdByKey.get(u.projectKey) ?? null) : null,
        phaseId: null,
        area: u.area,
        ...migrationStatusColumns(u.status, completedAtById.get(u.taskId) ?? null),
      };
      if (u.clearParent) setValues.parentTaskId = null;
      await db
        .update(tasks)
        .set(setValues)
        .where(and(eq(tasks.id, u.taskId), eq(tasks.workspaceId, workspaceId)));
      updated += 1;
    }
    console.log(`  ${updated} Aufgaben aktualisiert (davon umgehängt: ${
      plan.updates.filter((u) => u.changed && u.clearParent).length
    }).`);

    // 3. Only now the containers may go. task_records / task_assignees /
    //    task_comments cascade on task_id.
    if (deletedIds.length > 0) {
      await db
        .delete(tasks)
        .where(and(inArray(tasks.id, deletedIds), eq(tasks.workspaceId, workspaceId)));
      console.log(`  ${deletedIds.length} Container-Elternaufgaben gelöscht.`);
    }

    // 4. The two new IT-Transformation tasks.
    for (const nt of plan.newTasks) {
      const projectId = projectIdByKey.get(nt.projectKey);
      if (!projectId) {
        console.warn(`  Projekt "${nt.projectKey}" unbekannt — "${nt.content}" übersprungen.`);
        continue;
      }
      const created = await createTask(nt.content, ownerUserId, workspaceId, {
        description: nt.description,
        priority: nt.priority,
        projectId,
      });
      backup.createdTaskIds.push(created.id);
      flush();
      console.log(`  Aufgabe angelegt: ${nt.content}`);
    }

    // 5. C8 / spec Rule 7: sprint rotation, AFTER the task updates above.
    //    Close first, then create/activate — activateSprint enforces the
    //    single-active-sprint invariant and would refuse a second "aktiv"
    //    row if the old sprint were still running.
    if (sprintRotation.closeSprintId) {
      const closed = await closeSprint(workspaceId, sprintRotation.closeSprintId);
      if (closed.error) {
        console.warn(
          `  Sprint-Rotation: "${sprintRotation.closeSprintName}" nicht abgeschlossen: ${closed.error}`
        );
      } else {
        console.log(
          `  Sprint abgeschlossen: ${sprintRotation.closeSprintName} ` +
            `(${closed.summary?.carriedTasks ?? 0} unerledigte Aufgabe(n) in den Backlog zurückgetragen).`
        );
      }
    }

    if (sprintRotation.activateExistingSprintId) {
      const activated = await activateSprint(workspaceId, sprintRotation.activateExistingSprintId);
      if (activated.error) {
        console.warn(`  Sprint-Rotation: Aktivierung fehlgeschlagen: ${activated.error}`);
      } else {
        console.log(`  Sprint aktiviert: ${activated.sprint?.name}`);
      }
    } else if (sprintRotation.createSprint) {
      const createdSprint = await createSprint(workspaceId, ownerUserId, {
        name: sprintRotation.createSprint.name,
        goal: sprintRotation.createSprint.goal,
        startDate: sprintRotation.createSprint.startDate,
        endDate: sprintRotation.createSprint.endDate,
      });
      backup.createdSprintIds.push(createdSprint.id);
      flush();
      const activated = await activateSprint(workspaceId, createdSprint.id);
      if (activated.error) {
        console.warn(
          `  Sprint-Rotation: "${createdSprint.name}" angelegt, aber Aktivierung fehlgeschlagen: ${activated.error}`
        );
      } else {
        console.log(`  Sprint angelegt und aktiviert: ${createdSprint.name}`);
      }
    }
  } catch (err) {
    flush();
    console.error(
      `\nFEHLER. Backup liegt unter ${backupPath}\n` +
        `Rollback: pnpm --filter @openclaw-crm/web tasks:migrate --rollback ${backupPath} --apply`
    );
    throw err;
  }

  flush();
  console.log(`\nFertig. Backup: ${backupPath}`);
}

// ─── main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // --rollback is not implemented yet (see header). Refuse loudly instead of
  // silently falling through to --apply, which would just re-run the
  // forward migration a second time and leave the operator believing
  // something was undone when nothing was.
  if (ROLLBACK_FILE) {
    console.error(
      `\n--rollback ist noch nicht implementiert. "${ROLLBACK_FILE}" wurde NICHT ` +
        "zurückgespielt, es wurde nichts geschrieben.\n" +
        "Zur manuellen Wiederherstellung: touchedTasks enthält den Zustand jeder geänderten " +
        "Aufgabe vor der Migration, deletedTasks/deletedTaskAssignees/deletedTaskRecords/" +
        "deletedTaskComments die gelöschten Container samt Anhang, createdProjectIds/" +
        "createdTaskIds die neu angelegten Zeilen. Bitte mit Dario abstimmen, bevor erneut " +
        "--apply ausgeführt wird."
    );
    process.exitCode = 1;
    return;
  }

  const workspace = await resolveWorkspace();

  if (VERIFY) {
    await runVerification(workspace.id);
    return;
  }

  const ownerUserId = await resolveOwnerUserId();

  const [allRows, projectRows, sprintRows] = await Promise.all([
    loadFullTaskRows(workspace.id),
    db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.workspaceId, workspace.id)),
    db
      // C8: state/startDate/endDate added so this same query can also feed
      // planSprintRotation() (Rule 7) below — previously only id/name were
      // selected, which was enough for sprintNameById but not for deciding
      // which sprint to close/create/activate.
      .select({
        id: sprints.id,
        name: sprints.name,
        state: sprints.state,
        startDate: sprints.startDate,
        endDate: sprints.endDate,
      })
      .from(sprints)
      .where(eq(sprints.workspaceId, workspace.id)),
  ]);

  const sprintNameById: Record<string, string> = {};
  for (const s of sprintRows) sprintNameById[s.id] = s.name;

  const plan = planTaskMigration({
    tasks: toMigrationRows(allRows),
    existingProjects: projectRows,
    sprintNameById,
    ownerUserId,
  });

  // C8 / spec Rule 7: sprint rotation is planned independently of the task
  // migration above (planSprintRotation is pure and takes only the sprint
  // rows + "now") but printed and applied in the same run, right after it.
  const sprintRotation = planSprintRotation(sprintRows, new Date());

  printPlan(plan, workspace.name);
  printSprintRotation(sprintRotation);

  if (!APPLY) {
    console.log(
      "\nDRY-RUN — es wurde nichts geschrieben.\n" +
        "Zuordnungstabelle prüfen, dann mit --apply ausführen."
    );
    return;
  }

  await applyPlan(workspace.id, ownerUserId, plan, allRows, sprintRotation);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("migrate-tasks-to-projects failed:", err);
    process.exit(1);
  });
