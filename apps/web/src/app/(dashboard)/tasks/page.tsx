"use client";

// Work dashboard (Mockup 1 / Spec §8.1). Exactly two fetches: the dashboard
// bundle and the sprint timeline. The old Kanban board, the Sprint-Bar and
// the Team-Pulse strip are gone (Spec §7).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useSession } from "@/lib/auth-client";
import type { DashboardJSON, TaskJSON, TimelineJSON } from "@/lib/work-types";
import { ModuleNav } from "@/components/work/module-nav";
import {
  SprintPicker,
  sprintQueryParam,
  type SprintSelection,
} from "@/components/work/sprint-picker";
import { ErrorLine, LoadingLine } from "@/components/work/empty-state";
import { WorkTaskDialog, type WorkTaskSavePayload } from "@/components/work/task-dialog";
import { readApiError } from "@/lib/work-ui";
import { toast } from "sonner";
import { KpiGrid, KpiTile } from "@/components/work/kpi-tile";
import { AlertTriangle, CheckCircle2, FolderKanban, ListChecks, Users } from "lucide-react";
import { ProjectCard, NewProjectTile } from "@/components/work/project-card";
import { EmptyState } from "@/components/work/empty-state";
import { SectionCard } from "@/components/work/section-card";
import { FilterChips } from "@/components/work/filter-chips";
import { TaskRow } from "@/components/work/task-row";
import { SprintTimeline } from "@/components/work/sprint-timeline";
import { OPERATIVE_FILTERS, matchesOperativeFilter, type OperativeFilter } from "@/lib/work-ui";
import { ActivityTimeline } from "@/components/records/activity-timeline";
import { AvatarStack } from "@/components/work/avatar-stack";
import { ProgressBar } from "@/components/work/progress-bar";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { activityTimelineType, formatDayShortDE } from "@/lib/work-ui";
import { Flag, Layers, Truck } from "lucide-react";

/** How many operative rows the dashboard card shows before "Alle →". */
const DASHBOARD_OPERATIVE_ROWS = 10;

export default function WorkDashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [sprintId, setSprintId] = useState<SprintSelection>(null);
  const [data, setData] = useState<DashboardJSON | null>(null);
  const [timeline, setTimeline] = useState<TimelineJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [timelineFailed, setTimelineFailed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskJSON | null>(null);
  const [opFilter, setOpFilter] = useState<OperativeFilter>("heute");

  // Every load carries a monotonic id and an AbortController. Without both,
  // switching the SprintPicker from a 210-task sprint to a 6-task one lets the
  // small response render first and the big one overwrite it 1.2 s later — the
  // picker then reads "Sprint 1" while the panels show Sprint 3 (defect R5).
  const reqSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const seq = ++reqSeq.current;
    const isStale = () => seq !== reqSeq.current;

    setLoading(true);
    const sprintQs = sprintQueryParam(sprintId);
    const qs = sprintQs ? `?${sprintQs}` : "";
    // The dashboard timeline is the overview, so it asks the server for a
    // tight row cap; the payload comes back with row.truncatedBars, which the
    // component renders as "+n weitere" (Risk R5 — no silent truncation).
    const timelineQs = `?${sprintQs ? `${sprintQs}&` : ""}maxBarsPerRow=6`;
    const [dash, tl] = await Promise.allSettled([
      fetch(`/api/v1/work/dashboard${qs}`, { cache: "no-store", signal: ctrl.signal }),
      fetch(`/api/v1/work/timeline${timelineQs}`, { cache: "no-store", signal: ctrl.signal }),
    ]);
    if (isStale()) return;

    if (dash.status === "fulfilled" && dash.value.ok) {
      const json = await dash.value.json();
      if (isStale()) return;
      setData((json?.data ?? null) as DashboardJSON | null);
      setFailed(false);
    } else if (dash.status === "rejected" && (dash.reason as Error)?.name === "AbortError") {
      return; // superseded, not a failure
    } else {
      setFailed(true);
    }

    if (tl.status === "fulfilled" && tl.value.ok) {
      const json = await tl.value.json();
      if (isStale()) return;
      setTimeline((json?.data ?? null) as TimelineJSON | null);
      setTimelineFailed(false);
    } else if (!(tl.status === "rejected" && (tl.reason as Error)?.name === "AbortError")) {
      // The timeline failing must not take the whole page down.
      setTimelineFailed(true);
    }
    setLoading(false);
  }, [sprintId]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // "Is there a sprint whose work has actually started?" — NOT "is a sprint
  // selected". getWorkDashboard resolves a picked sprint with getSprint, so a
  // sprint in `planung` arrives with projectsAreSprintScoped: true and a full
  // team roster at 0/0. Team figures must key off the STATE (defect W10).
  const hasRunningSprint = data?.sprint?.state === "aktiv";

  const openTask = useCallback((task: TaskJSON) => {
    setEditingTask(task);
    setDialogOpen(true);
  }, []);

  const openTaskById = useCallback(
    (taskId: string) => {
      const all = [...(data?.operativeTasks ?? []), ...(data?.overdueTasks ?? [])];
      const found = all.find((t) => t.id === taskId);
      if (found) {
        openTask(found);
        return;
      }
      // Every PROJECT task bar lands here — those lists hold operative and
      // overdue tasks only, and project bars are the whole point of this
      // timeline. A toast would make the click a dead end (defect W8), so
      // navigate to the task in its project instead.
      const row = timeline?.rows.find((r) => r.bars.some((b) => b.taskId === taskId));
      if (row?.projectId) {
        router.push(`/tasks/projects/${row.projectId}?tab=zeitleiste&task=${taskId}`);
        return;
      }
      toast.error("Aufgabe konnte nicht geöffnet werden");
    },
    [data, timeline, openTask, router]
  );

  // Typed, not Record<string, unknown>: WorkTaskSavePayload is an interface and
  // interfaces have no implicit index signature, so under strictFunctionTypes
  // a Record-typed handler is not assignable to the onSave prop and the build
  // fails at the JSX site (defect W6).
  async function saveTask(payload: WorkTaskSavePayload) {
    const url = editingTask ? `/api/v1/tasks/${editingTask.id}` : "/api/v1/tasks";
    const res = await fetch(url, {
      method: editingTask ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await readApiError(res, "Speichern fehlgeschlagen"));
    toast.success(editingTask ? "Aufgabe aktualisiert" : "Aufgabe erstellt");
    await load();
  }

  const toggleFavorite = useCallback(
    async (projectId: string, next: boolean) => {
      // Optimistic: the star flips instantly, the reload confirms it.
      setData((prev) =>
        prev
          ? {
              ...prev,
              projects: prev.projects.map((p) =>
                p.id === projectId ? { ...p, isFavorite: next } : p
              ),
            }
          : prev
      );
      // try/catch, not just !res.ok: a rejecting fetch (offline, DNS, aborted
      // navigation) throws straight out of the handler as an unhandled
      // rejection, leaving the star yellow with nothing saved (defect R9).
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/favorite`, {
          method: next ? "PUT" : "DELETE",
        });
        if (!res.ok) throw new Error(await readApiError(res, "Favorit konnte nicht gespeichert werden"));
      } catch (err) {
        toast.error("Favorit konnte nicht gespeichert werden", {
          description: err instanceof Error ? err.message : undefined,
        });
        await load();
      }
    },
    [load]
  );

  return (
    <div className="k-paper-noise min-h-full">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:px-8 sm:py-8">
        {/* ── Kopf ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="k-label mb-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              Arbeit
            </div>
            <h1
              className="k-display"
              style={{
                margin: 0,
                fontSize: "clamp(26px, 4vw, 36px)",
                lineHeight: 1.05,
                fontVariationSettings: '"opsz" 96, "SOFT" 100',
              }}
            >
              Dashboard
            </h1>
            <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted-foreground)" }}>
              Projekte und operativer Betrieb auf einen Blick.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SprintPicker value={sprintId} onChange={setSprintId} />
            <button
              type="button"
              onClick={() => {
                setEditingTask(null);
                setDialogOpen(true);
              }}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13.5px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Plus className="h-[15px] w-[15px]" />
              Aufgabe
            </button>
            <Link
              href="/tasks/projects/new"
              className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium"
              style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
            >
              <Plus className="h-[15px] w-[15px]" />
              Neues Projekt
            </Link>
          </div>
        </div>

        {/* ModuleNav carries its own Suspense boundary (Task 8). */}
        <ModuleNav />

        {loading && !data && <LoadingLine label="Dashboard wird geladen…" />}
        {failed && !data && <ErrorLine onRetry={load} />}

        {data && (
          <>
            <DashboardKpis kpis={data.kpis} teamFiguresApply={hasRunningSprint} />
            <SprintProjects
              projects={data.projects}
              sprintScoped={data.projectsAreSprintScoped}
              onToggleFavorite={toggleFavorite}
            />
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <OperativeCard
                tasks={data.operativeTasks}
                openTotal={data.kpis.operativeOpenCount}
                filter={opFilter}
                onFilterChange={setOpFilter}
                onOpen={openTask}
                onChanged={load}
              />
              <SprintTimeline
                data={timeline}
                loading={loading && !timeline}
                error={timelineFailed}
                onTaskClick={openTaskById}
                className="min-w-0"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              <OverdueCard
                tasks={data.overdueTasks}
                total={data.kpis.overdueCount}
                onOpen={openTask}
                onChanged={load}
              />
              <DashboardActivityCard activity={data.activity} />
              <UpcomingCard upcoming={data.upcoming} />
              <TeamCard team={data.team} hasSprint={hasRunningSprint} />
            </div>
          </>
        )}
      </div>

      <WorkTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editingTask ? "edit" : "create"}
        task={editingTask}
        currentUserId={session?.user?.id}
        defaultSprintId={data?.sprint?.id ?? null}
        onSave={saveTask}
        onDelete={
          editingTask
            ? async () => {
                await fetch(`/api/v1/tasks/${editingTask.id}`, { method: "DELETE" });
                toast.success("Aufgabe gelöscht");
                await load();
              }
            : undefined
        }
      />
    </div>
  );
}

function DashboardKpis({
  kpis,
  teamFiguresApply,
}: {
  kpis: DashboardJSON["kpis"];
  /** false when no sprint is RUNNING — see hasRunningSprint (W10). */
  teamFiguresApply: boolean;
}) {
  // An empty workspace must not be told it is at 0 % and on schedule: a fresh
  // install would show a 0 % bar and a green "alles im Zeitplan" (defect W12).
  const empty = kpis.projectCount === 0;
  return (
    <KpiGrid>
      <KpiTile
        label="Gesamtfortschritt"
        value={empty ? "–" : `${kpis.overallProgressPct} %`}
        progress={empty ? null : kpis.overallProgressPct}
        tone={empty ? "neutral" : "neutral"}
        sub={empty ? "noch nichts geplant" : "über alle aktiven Projekte"}
        icon={<CheckCircle2 className="h-[15px] w-[15px]" />}
      />
      <KpiTile
        label="Projekte"
        value={String(kpis.projectCount)}
        sub={`${kpis.activeProjectCount} aktiv`}
        icon={<FolderKanban className="h-[15px] w-[15px]" />}
        href="/tasks/projects"
      />
      <KpiTile
        label="Operative Aufgaben"
        value={String(kpis.operativeOpenCount)}
        sub={`${kpis.operativeDueTodayCount} heute fällig`}
        icon={<ListChecks className="h-[15px] w-[15px]" />}
        href="/tasks/operative"
      />
      <KpiTile
        label="Überfällig"
        value={String(kpis.overdueCount)}
        tone={kpis.overdueCount > 0 ? "danger" : empty ? "neutral" : "ok"}
        sub={
          kpis.overdueCount > 0
            ? "brauchen heute eine Entscheidung"
            : empty
              ? "noch nichts geplant"
              : "alles im Zeitplan"
        }
        icon={<AlertTriangle className="h-[15px] w-[15px]" />}
        href="/tasks/operative?filter=ueberfaellig"
      />
      {/* Spec §6: without a RUNNING sprint BOTH team figures show a dash,
          never 0 %. Driven off the sprint's state, not its existence: the
          picker can select a sprint in `planung`, which has no elapsed work
          and would otherwise render a 0 % bar under a confident label (W10).
          progress={null} also suppresses the bar. */}
      <KpiTile
        label="Team Auslastung"
        value={!teamFiguresApply || kpis.teamUtilizationPct == null ? "–" : `${kpis.teamUtilizationPct} %`}
        progress={!teamFiguresApply || kpis.teamUtilizationPct == null ? null : kpis.teamUtilizationPct}
        tone={!teamFiguresApply || kpis.teamUtilizationPct == null ? "neutral" : "accent"}
        sub={
          !teamFiguresApply
            ? "kein laufender Sprint"
            : kpis.teamUtilizationPct == null
              ? "keine Zuweisungen"
              : "erledigt von zugewiesen"
        }
        icon={<Users className="h-[15px] w-[15px]" />}
      />
    </KpiGrid>
  );
}

function SprintProjects({
  projects,
  sprintScoped,
  onToggleFavorite,
}: {
  projects: DashboardJSON["projects"];
  /** false = there is no active sprint, so these are all active projects. */
  sprintScoped: boolean;
  onToggleFavorite: (id: string, next: boolean) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="k-display m-0" style={{ fontSize: 19, fontWeight: 500 }}>
          {sprintScoped ? "Projekte in diesem Sprint" : "Aktive Projekte"}
        </h2>
        <Link href="/tasks/projects" className="shrink-0 text-xs" style={{ color: "var(--kottke-accent)" }}>
          Alle Projekte anzeigen →
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="k-card">
          <EmptyState
            title={sprintScoped ? "Noch kein Projekt in diesem Sprint" : "Noch kein aktives Projekt"}
            hint={
              sprintScoped
                ? "Ordne Projektaufgaben einem Sprint zu, oder leg direkt ein neues Projekt an."
                : "Es läuft gerade kein Sprint. Leg ein Projekt an oder starte einen Sprint unter „Sprints“."
            }
            action={
              <Link
                href="/tasks/projects/new"
                className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium"
                style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
              >
                <Plus className="h-[15px] w-[15px]" />
                Neues Projekt
              </Link>
            }
          />
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
        >
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onToggleFavorite={onToggleFavorite} />
          ))}
          <NewProjectTile />
        </div>
      )}
    </section>
  );
}

function OperativeCard({
  tasks,
  openTotal,
  filter,
  onFilterChange,
  onOpen,
  onChanged,
}: {
  tasks: TaskJSON[];
  /** kpis.operativeOpenCount — the TRUE number of open operative tasks. */
  openTotal: number;
  filter: OperativeFilter;
  onFilterChange: (f: OperativeFilter) => void;
  onOpen: (t: TaskJSON) => void;
  onChanged: () => void | Promise<void>;
}) {
  // `tasks` is a bounded slice from the dashboard payload, not the whole set.
  // Counting chips over it and printing that next to a KPI tile showing the
  // true number makes the two disagree on screen (defect W7), so the chips are
  // labelled as counts of what is shown and the card subtitle carries the
  // real total.
  const options = OPERATIVE_FILTERS.map((o) => ({
    ...o,
    count: tasks.filter((t) => matchesOperativeFilter(t, o.value)).length,
  }));
  const visible = tasks.filter((t) => matchesOperativeFilter(t, filter));
  const truncated = openTotal > tasks.length;

  return (
    <SectionCard
      title="Operative Aufgaben"
      subtitle={truncated ? `${tasks.length} von ${openTotal} offen — „Alle" zeigt den Rest` : `${openTotal} offen`}
      actionHref="/tasks/operative"
      actionLabel="Alle"
      className="min-w-0"
    >
      <FilterChips options={options} value={filter} onChange={onFilterChange} className="mb-2" />
      {visible.length === 0 ? (
        <EmptyState
          title="Nichts offen"
          hint={
            filter === "ueberfaellig"
              ? "Keine überfälligen operativen Aufgaben — sauber."
              : "Für diesen Zeitraum steht nichts an."
          }
        />
      ) : (
        <div className="-mx-2 flex flex-col divide-y divide-border">
          {visible.slice(0, DASHBOARD_OPERATIVE_ROWS).map((t) => (
            <TaskRow key={t.id} task={t} onOpen={onOpen} onToggled={onChanged} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function OverdueCard({
  tasks,
  total,
  onOpen,
  onChanged,
}: {
  tasks: TaskJSON[];
  /** kpis.overdueCount — the true number, not this page's length. */
  total: number;
  onOpen: (t: TaskJSON) => void;
  onChanged: () => void | Promise<void>;
}) {
  return (
    <SectionCard
      title="Überfällige Aufgaben"
      subtitle={total > 0 ? (total > tasks.length ? `${tasks.length} von ${total}` : `${total} offen`) : null}
      actionHref="/tasks/operative?filter=ueberfaellig"
      actionLabel="Alle"
    >
      {tasks.length === 0 ? (
        <EmptyState title="Nichts überfällig" hint="Alle Fälligkeiten sind eingehalten." />
      ) : (
        <div className="-mx-2 flex flex-col divide-y divide-border">
          {tasks.slice(0, 6).map((t) => (
            <TaskRow key={t.id} task={t} onOpen={onOpen} onToggled={onChanged} dense />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function DashboardActivityCard({ activity }: { activity: DashboardJSON["activity"] }) {
  return (
    <SectionCard title="Aktivitätsfeed">
      {activity.length === 0 ? (
        <EmptyState title="Noch keine Aktivität" hint="Änderungen an Projekten und Aufgaben erscheinen hier." />
      ) : (
        <div className="-mx-3">
          <ActivityTimeline
            activities={activity.slice(0, 8).map((a, i) => ({
              id: a?.id ?? `activity-${i}`,
              type: activityTimelineType(a?.type),
              title: a?.title ? (a.actorName ? `${a.title} · ${a.actorName}` : a.title) : "Aktivität",
              description: a?.description ?? undefined,
              createdAt: a?.createdAt ?? new Date().toISOString(),
            }))}
          />
        </div>
      )}
    </SectionCard>
  );
}

const UPCOMING_ICON = {
  milestone: Flag,
  phase: Layers,
  move: Truck,
} as const;

function UpcomingCard({ upcoming }: { upcoming: DashboardJSON["upcoming"] }) {
  return (
    <SectionCard title="Nächste Termine">
      {upcoming.length === 0 ? (
        <EmptyState title="Keine Termine" hint="Meilensteine, Phasenenden und Umzugstermine erscheinen hier." />
      ) : (
        <div className="flex flex-col">
          {upcoming.slice(0, 6).map((u, i) => {
            const Icon = UPCOMING_ICON[u.kind];
            return (
              <Link
                key={u.id}
                href={u.url}
                className="flex items-center gap-3 py-2.5"
                style={{ borderTop: i === 0 ? 0 : "1px dashed var(--border)" }}
              >
                <span
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted"
                  style={{ color: "var(--muted-foreground)" }}
                >
                  <Icon className="h-[14px] w-[14px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]" style={{ color: "var(--foreground)" }}>
                    {u.title}
                  </div>
                  {u.subtitle && (
                    <div className="truncate text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
                      {u.subtitle}
                    </div>
                  )}
                </div>
                <span className="k-mono shrink-0 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  {formatDayShortDE(u.date)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

function TeamCard({ team, hasSprint }: { team: DashboardJSON["team"]; hasSprint: boolean }) {
  // Spec §6: without an active sprint the per-person figures are undefined,
  // not zero — show a dash and no bars rather than a column of empty bars.
  // Guarded on BOTH hasSprint and `!team`: DashboardJSON.team is
  // TeamMemberJSON[] | null (services/work-dashboard.ts DashboardPayload.team),
  // null exactly when no sprint is RUNNING, and TypeScript cannot narrow
  // `team` from the separate `hasSprint` boolean alone.
  if (!hasSprint || !team) {
    return (
      <SectionCard title="Team Übersicht" subtitle="–">
        <EmptyState
          title="Kein laufender Sprint"
          hint="Die Team-Auslastung wird nur innerhalb eines laufenden Sprints berechnet. Ein Sprint in Planung zählt nicht — starte ihn unter „Sprints“."
        />
      </SectionCard>
    );
  }
  return (
    <SectionCard title="Team Übersicht" subtitle="im aktiven Sprint">
      {team.length === 0 ? (
        <EmptyState title="Keine Zuweisungen" hint="Sobald Aufgaben im Sprint zugewiesen sind, siehst du hier die Auslastung." />
      ) : (
        <div className="flex flex-col gap-3">
          {team.map((m) => (
            <div key={m.userId} className="flex items-center gap-3">
              <EmployeeAvatar name={m.name} photoBase64={m.image} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px]" style={{ color: "var(--foreground)" }}>
                    {m.name}
                  </span>
                  <span className="k-mono shrink-0 text-[11px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                    {m.done}/{m.assigned}
                    {m.overdue > 0 && (
                      <span style={{ color: "var(--danger)" }}> · {m.overdue} überfällig</span>
                    )}
                  </span>
                </div>
                <ProgressBar
                  className="mt-1"
                  value={m.pct}
                  height={5}
                  tone={m.overdue > 0 ? "warn" : "ok"}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
