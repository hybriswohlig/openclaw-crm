"use client";

// Sprint overview, planning and close. Counts, not points (Spec §7): the
// closed sprint's snapshot columns hold task counts from Phase 2 onwards.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Flag, Loader2, Plus, Rocket, Trash2, Trophy } from "lucide-react";
import { toast } from "sonner";
import type { SprintJSON, TaskJSON, TaskListJSON } from "@/lib/work-types";
import { ModuleNav } from "@/components/work/module-nav";
import { SectionCard } from "@/components/work/section-card";
import { ProgressBar } from "@/components/work/progress-bar";
import { StatusChip } from "@/components/work/status-chip";
import { TaskRow } from "@/components/work/task-row";
import { EmptyState, ErrorLine, LoadingLine } from "@/components/work/empty-state";
import { formatSprintRangeDE, formatDateDE } from "@/lib/work-ui";

const inputClass =
  "h-8 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25";

export default function SprintsPage() {
  const [sprints, setSprints] = useState<SprintJSON[]>([]);
  const [activeTasks, setActiveTasks] = useState<TaskJSON[]>([]);
  const [backlog, setBacklog] = useState<TaskJSON[]>([]);
  const [backlogTotal, setBacklogTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/sprints", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      const list = (((await res.json())?.data?.sprints ?? []) as SprintJSON[]);
      setSprints(list);
      setFailed(false);

      const active = list.find((s) => s.state === "aktiv") ?? null;
      const [inSprint, noSprint] = await Promise.allSettled([
        // showCompleted=true so the sprint's finished work is visible and a
        // checkbox can be un-ticked from here (plan R7.2).
        active
          ? fetch(`/api/v1/tasks?sprintId=${active.id}&showCompleted=true&limit=200`, {
              cache: "no-store",
            })
          : Promise.resolve(
              new Response(JSON.stringify({ data: { tasks: [], pagination: { limit: 0, offset: 0, total: 0 } } }))
            ),
        // sprintId=none, NOT "fetch everything and filter". The route returns
        // the first 200 by `deadline ASC NULLS LAST`, which are
        // disproportionately the ones already in the sprint — with 190 sprint
        // tasks the backlog would show ~10 of 60 and hide the rest with no
        // hint (defect R6). Phase 2 kept `none` for exactly this.
        fetch("/api/v1/tasks?sprintId=none&showCompleted=false&limit=200", { cache: "no-store" }),
      ]);
      if (inSprint.status === "fulfilled" && inSprint.value.ok) {
        const payload = ((await inSprint.value.json())?.data ?? null) as TaskListJSON | null;
        setActiveTasks(payload?.tasks ?? []);
      }
      if (noSprint.status === "fulfilled" && noSprint.value.ok) {
        const payload = ((await noSprint.value.json())?.data ?? null) as TaskListJSON | null;
        setBacklog(payload?.tasks ?? []);
        setBacklogTotal(payload?.pagination?.total ?? payload?.tasks?.length ?? 0);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(fn: () => Promise<Response>, okMsg: string, errMsg: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message ?? errMsg);
      }
      toast.success(okMsg);
      await load();
    } catch (e) {
      toast.error(errMsg, { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  const active = useMemo(() => sprints.find((s) => s.state === "aktiv") ?? null, [sprints]);
  const planned = useMemo(() => sprints.filter((s) => s.state === "planung"), [sprints]);
  const closed = useMemo(() => sprints.filter((s) => s.state === "abgeschlossen"), [sprints]);

  return (
    <div className="k-paper-noise min-h-full">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div>
          <div className="k-label mb-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
            Arbeit
          </div>
          <h1 className="k-display" style={{ margin: 0, fontSize: "clamp(26px, 4vw, 36px)", lineHeight: 1.05 }}>
            Sprints
          </h1>
          <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted-foreground)" }}>
            Zählbasiert: der Fortschritt ist erledigte durch alle Aufgaben des Sprints.
          </p>
        </div>

        <ModuleNav />

        {loading && sprints.length === 0 && <LoadingLine label="Sprints werden geladen…" />}
        {failed && sprints.length === 0 && <ErrorLine onRetry={load} />}

        {active ? (
          <SectionCard
            title={active.name}
            subtitle={`${formatSprintRangeDE(active.startDate, active.endDate)} · Tag ${active.daysElapsed ?? 0} von ${active.daysTotal ?? 0}`}
            action={
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm("Sprint abschliessen? Unerledigte Aufgaben wandern zurück in den Backlog.")) return;
                  act(
                    () =>
                      fetch(`/api/v1/sprints/${active.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "abschliessen" }),
                      }),
                    "Sprint abgeschlossen",
                    "Sprint konnte nicht abgeschlossen werden"
                  );
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[12.5px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-[13px] w-[13px] animate-spin" /> : <Trophy className="h-[13px] w-[13px]" />}
                Abschliessen
              </button>
            }
          >
            {active.goal && (
              <p className="mb-3 text-[13px]" style={{ color: "var(--foreground)" }}>
                <span className="k-label mr-2" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                  Sprintziel
                </span>
                {active.goal}
              </p>
            )}
            <div className="mb-3 flex items-center gap-3">
              <ProgressBar value={active.metrics.progressPct} className="flex-1" showValue />
              <span className="k-mono shrink-0 text-[11.5px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                {active.metrics.doneTasks}/{active.metrics.totalTasks} Aufgaben
              </span>
              <StatusChip tone={(active.daysRemaining ?? 0) <= 2 ? "warn" : "info"}>
                noch {active.daysRemaining ?? 0} Tage
              </StatusChip>
            </div>

            {activeTasks.length === 0 ? (
              <EmptyState title="Keine Aufgaben im Sprint" hint="Zieh unten Aufgaben aus dem Backlog herein." />
            ) : (
              <div className="-mx-2 flex flex-col divide-y divide-border">
                {activeTasks.map((t) => (
                  <TaskRow key={t.id} task={t} onToggled={load} dense />
                ))}
              </div>
            )}
          </SectionCard>
        ) : (
          !loading && (
            <div className="k-card">
              <EmptyState
                icon={<Flag className="h-5 w-5" />}
                title="Kein aktiver Sprint"
                hint="Leg unten einen Sprint an und starte ihn — Team-Kennzahlen brauchen einen aktiven Sprint."
              />
            </div>
          )
        )}

        <SectionCard
          title="Backlog"
          subtitle={
            backlogTotal > backlog.length
              ? `${backlog.length} von ${backlogTotal} Aufgaben ohne Sprint geladen`
              : `${backlogTotal} Aufgaben ohne Sprint`
          }
        >
          {backlog.length === 0 ? (
            <EmptyState title="Backlog leer" />
          ) : (
            <div className="-mx-2 flex flex-col divide-y divide-border">
              {backlog.slice(0, 30).map((t) => (
                <div key={t.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <TaskRow task={t} onToggled={load} dense />
                  </div>
                  {active && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () =>
                            fetch(`/api/v1/tasks/${t.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ sprintId: active.id }),
                            }),
                          "In den Sprint übernommen",
                          "Aufgabe konnte nicht übernommen werden"
                        )
                      }
                      className="mr-2 shrink-0 rounded-lg border border-border px-2 py-1 text-[11.5px] text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      In Sprint
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SectionCard title="In Planung" subtitle={`${planned.length} Sprints`}>
            {planned.length === 0 ? (
              <EmptyState title="Kein geplanter Sprint" />
            ) : (
              <div className="flex flex-col gap-2">
                {planned.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium" style={{ color: "var(--foreground)" }}>
                        {s.name}
                      </div>
                      <div className="text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
                        {formatSprintRangeDE(s.startDate, s.endDate)} · {s.metrics.totalTasks} Aufgaben
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy || !!active}
                      title={active ? "Es läuft bereits ein Sprint" : undefined}
                      onClick={() =>
                        act(
                          () =>
                            fetch(`/api/v1/sprints/${s.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "aktivieren" }),
                            }),
                          "Sprint gestartet",
                          "Sprint konnte nicht gestartet werden"
                        )
                      }
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-40"
                      style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
                    >
                      <Rocket className="h-[13px] w-[13px]" />
                      Starten
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(`Sprint „${s.name}“ löschen?`)) return;
                        act(
                          () => fetch(`/api/v1/sprints/${s.id}`, { method: "DELETE" }),
                          "Sprint gelöscht",
                          "Sprint konnte nicht gelöscht werden"
                        );
                      }}
                      aria-label="Sprint löschen"
                      className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-[13px] w-[13px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <input
                className={`${inputClass} min-w-[140px] flex-1`}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Sprintname, z. B. Sprint 4"
              />
              <input type="date" className={inputClass} value={newStart} onChange={(e) => setNewStart(e.target.value)} aria-label="Start" />
              <input type="date" className={inputClass} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} aria-label="Ende" />
              <button
                type="button"
                disabled={!newName.trim() || busy}
                onClick={() =>
                  act(
                    () =>
                      fetch("/api/v1/sprints", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: newName.trim(),
                          startDate: newStart || null,
                          endDate: newEnd || null,
                        }),
                      }),
                    "Sprint angelegt",
                    "Sprint konnte nicht angelegt werden"
                  ).then(() => {
                    setNewName("");
                    setNewStart("");
                    setNewEnd("");
                  })
                }
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-40"
                style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
              >
                <Plus className="h-[13px] w-[13px]" />
                Anlegen
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Abgeschlossene Sprints" subtitle={`${closed.length} in der Historie`}>
            {closed.length === 0 ? (
              <EmptyState title="Noch keine Historie" />
            ) : (
              <div className="flex flex-col">
                {closed.map((s, i) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 py-2.5"
                    style={{ borderTop: i === 0 ? 0 : "1px dashed var(--border)" }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]" style={{ color: "var(--foreground)" }}>
                        {s.name}
                      </div>
                      <div className="text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
                        {formatSprintRangeDE(s.startDate, s.endDate)} · abgeschlossen {formatDateDE(s.completedAt)}
                      </div>
                    </div>
                    <span className="k-mono shrink-0 text-[11.5px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                      {s.metrics.doneTasks}/{s.metrics.totalTasks}
                    </span>
                    <StatusChip tone={s.metrics.progressPct >= 80 ? "ok" : "warn"}>{s.metrics.progressPct} %</StatusChip>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
