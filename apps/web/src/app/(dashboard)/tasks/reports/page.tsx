"use client";

// Reports (Spec §8.4). Four read-only views built from the dashboard bundle,
// the team overview and the sprint list — deliberately no new data layer.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DashboardJSON, SprintJSON, TeamMemberJSON } from "@/lib/work-types";
import { ModuleNav } from "@/components/work/module-nav";
import {
  SprintPicker,
  sprintQueryParam,
  type SprintSelection,
} from "@/components/work/sprint-picker";
import { SectionCard } from "@/components/work/section-card";
import { ProgressBar } from "@/components/work/progress-bar";
import { ProjectIcon } from "@/components/work/project-icon";
import { StatusChip } from "@/components/work/status-chip";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { EmptyState, ErrorLine, LoadingLine } from "@/components/work/empty-state";
import {
  daysBetweenDays,
  formatDateDE,
  formatSprintRangeDE,
  groupBy,
  relativeDaysDE,
  toDate,
} from "@/lib/work-ui";
import { operativeAreaLabel } from "@/lib/project-constants";

export default function ReportsPage() {
  const [sprintId, setSprintId] = useState<SprintSelection>(null);
  const [dashboard, setDashboard] = useState<DashboardJSON | null>(null);
  const [team, setTeam] = useState<TeamMemberJSON[]>([]);
  const [sprints, setSprints] = useState<SprintJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Same race guard as the dashboard: switching sprints fires three requests
  // and the slower response must not overwrite the newer one (defect R5).
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
    const [d, tm, s] = await Promise.allSettled([
      fetch(`/api/v1/work/dashboard${qs}`, { cache: "no-store", signal: ctrl.signal }),
      fetch(`/api/v1/work/team-overview${qs}`, { cache: "no-store", signal: ctrl.signal }),
      fetch("/api/v1/sprints", { cache: "no-store", signal: ctrl.signal }),
    ]);
    if (isStale()) return;
    if (d.status === "fulfilled" && d.value.ok) {
      const json = await d.value.json();
      if (isStale()) return;
      setDashboard(((json?.data ?? null) as DashboardJSON | null));
      setFailed(false);
    } else if (!(d.status === "rejected" && (d.reason as Error)?.name === "AbortError")) {
      setFailed(true);
    }
    if (tm.status === "fulfilled" && tm.value.ok && !isStale()) {
      setTeam((((await tm.value.json())?.data ?? []) as TeamMemberJSON[]));
    }
    if (s.status === "fulfilled" && s.value.ok && !isStale()) {
      setSprints((((await s.value.json())?.data?.sprints ?? []) as SprintJSON[]));
    }
    if (!isStale()) setLoading(false);
  }, [sprintId]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const overdueGroups = useMemo(() => {
    const rows = dashboard?.overdueTasks ?? [];
    return groupBy(rows, (t) => t.projectName ?? (t.area ? `Bereich: ${operativeAreaLabel(t.area)}` : "Ohne Zuordnung"));
  }, [dashboard]);

  const closedSprints = useMemo(() => sprints.filter((s) => s.state === "abgeschlossen"), [sprints]);
  const hasRunningSprint = dashboard?.sprint?.state === "aktiv";

  return (
    <div className="k-paper-noise min-h-full">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="k-label mb-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              Arbeit
            </div>
            <h1 className="k-display" style={{ margin: 0, fontSize: "clamp(26px, 4vw, 36px)", lineHeight: 1.05 }}>
              Berichte
            </h1>
            <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted-foreground)" }}>
              Vier Auswertungen auf denselben Zahlen wie das Dashboard.
            </p>
          </div>
          <SprintPicker value={sprintId} onChange={setSprintId} allowNone />
        </div>

        <ModuleNav />

        {loading && !dashboard && <LoadingLine label="Berichte werden geladen…" />}
        {failed && !dashboard && <ErrorLine onRetry={load} />}

        {dashboard && (
          <>
            <SectionCard
              // I7: dashboard.projects is either every active project or —
              // whenever a sprint is selected — just that sprint's projects
              // (services/work-dashboard.ts sets projectsAreSprintScoped =
              // sprint !== null). The main dashboard already says so
              // (app/(dashboard)/tasks/page.tsx:391); this section must use
              // the exact same German wording instead of implying "every
              // project" regardless of scope.
              title={`1 · Projektfortschritt — ${
                dashboard.projectsAreSprintScoped ? "Projekte in diesem Sprint" : "Aktive Projekte"
              }`}
              subtitle={`${dashboard.projects.length} Projekte`}
            >
              {dashboard.projects.length === 0 ? (
                <EmptyState title="Keine Projekte" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        {["Projekt", "Fortschritt", "Aufgaben", "Überfällig", "Restlaufzeit"].map((h) => (
                          <th
                            key={h}
                            className="k-label whitespace-nowrap px-2 py-2 text-left"
                            style={{ fontSize: 10, color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.projects.map((p) => {
                        const end = toDate(p.endDate);
                        const rest = end ? daysBetweenDays(new Date(), end) : null;
                        return (
                          <tr key={p.id}>
                            <td className="px-2 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                              <Link href={`/tasks/projects/${p.id}`} className="flex min-w-[170px] items-center gap-2">
                                <ProjectIcon icon={p.icon} category={p.category} name={p.name} color={p.color} size={24} />
                                <span className="truncate" style={{ color: "var(--foreground)" }}>
                                  {p.name}
                                </span>
                              </Link>
                            </td>
                            <td className="px-2 py-2" style={{ borderBottom: "1px solid var(--border)", minWidth: 140 }}>
                              <ProgressBar value={p.stats.progressPct} showValue height={5} />
                            </td>
                            <td
                              className="whitespace-nowrap px-2 py-2 tabular-nums"
                              style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground)" }}
                            >
                              {p.stats.doneTasks}/{p.stats.totalTasks}
                            </td>
                            <td
                              className="whitespace-nowrap px-2 py-2 tabular-nums"
                              style={{
                                borderBottom: "1px solid var(--border)",
                                color: p.stats.overdueTasks > 0 ? "var(--danger)" : "var(--muted-foreground)",
                              }}
                            >
                              {p.stats.overdueTasks}
                            </td>
                            <td
                              className="whitespace-nowrap px-2 py-2"
                              style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                            >
                              {rest == null ? "kein Enddatum" : relativeDaysDE(rest)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="2 · Überfälligkeit"
              subtitle={`${dashboard.overdueTotal} überfällige Aufgaben`}
            >
              {dashboard.overdueTotal === 0 ? (
                <EmptyState title="Nichts überfällig" hint="Alle Fälligkeiten sind eingehalten." />
              ) : (
                <div className="flex flex-col gap-4">
                  {overdueGroups.map((g) => (
                    <div key={g.key}>
                      <div className="k-label mb-1.5" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                        {g.key} · {g.items.length}
                      </div>
                      <ul className="flex flex-col">
                        {g.items.map((t, i) => {
                          const d = toDate(t.deadline);
                          const days = d ? Math.abs(daysBetweenDays(new Date(), d)) : 0;
                          return (
                            <li
                              key={t.id}
                              className="flex items-center gap-3 py-2"
                              style={{ borderTop: i === 0 ? 0 : "1px dashed var(--border)" }}
                            >
                              <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: "var(--foreground)" }}>
                                {t.content}
                              </span>
                              <span className="k-mono shrink-0 text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                                fällig {formatDateDE(t.deadline)}
                              </span>
                              <StatusChip tone="danger">
                                {days} {days === 1 ? "Tag" : "Tage"}
                              </StatusChip>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* The guard the dashboard has and this page did not: a sprint in
                `planung` arrives with a full roster at 0/0, which would render
                a column of empty bars under a confident heading (defect W10).
                Key off the STATE, not off whether a sprint is selected. */}
            <SectionCard
              title="3 · Team-Auslastung"
              subtitle={
                hasRunningSprint ? `im Sprint „${dashboard.sprint!.name}“` : "kein laufender Sprint"
              }
            >
              {!hasRunningSprint ? (
                <EmptyState
                  title="Kein laufender Sprint"
                  hint="Team-Auslastung wird nur innerhalb eines laufenden Sprints berechnet. Ein Sprint in Planung hat noch keine geleistete Arbeit."
                />
              ) : team.length === 0 ? (
                <EmptyState title="Keine Zuweisungen" hint="In diesem Sprint ist noch niemandem etwas zugewiesen." />
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
                          <span className="k-mono shrink-0 text-[11.5px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                            {m.done} erledigt · {m.assigned} zugewiesen
                            {m.overdue > 0 && <span style={{ color: "var(--danger)" }}> · {m.overdue} überfällig</span>}
                          </span>
                        </div>
                        <ProgressBar className="mt-1" value={m.pct} height={5} tone={m.overdue > 0 ? "warn" : "ok"} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="4 · Sprint-Historie" subtitle={`${closedSprints.length} abgeschlossene Sprints`}>
              {closedSprints.length === 0 ? (
                <EmptyState title="Noch keine abgeschlossenen Sprints" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        {["Sprint", "Zeitraum", "Aufgaben", "Erledigt", "Übernommen", "Quote"].map((h) => (
                          <th
                            key={h}
                            className="k-label whitespace-nowrap px-2 py-2 text-left"
                            style={{ fontSize: 10, color: "var(--muted-foreground)", borderBottom: "1px solid var(--border)" }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {closedSprints.map((s) => (
                        <tr key={s.id}>
                          <td className="px-2 py-2" style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground)" }}>
                            {s.name}
                          </td>
                          <td
                            className="whitespace-nowrap px-2 py-2"
                            style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                          >
                            {formatSprintRangeDE(s.startDate, s.endDate)}
                          </td>
                          <td
                            className="px-2 py-2 tabular-nums"
                            style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground)" }}
                          >
                            {s.metrics.totalTasks}
                          </td>
                          <td
                            className="px-2 py-2 tabular-nums"
                            style={{ borderBottom: "1px solid var(--border)", color: "var(--ok)" }}
                          >
                            {s.metrics.doneTasks}
                          </td>
                          <td
                            className="px-2 py-2 tabular-nums"
                            style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                          >
                            {s.metrics.openTasks}
                          </td>
                          <td className="px-2 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                            <StatusChip tone={s.metrics.progressPct >= 80 ? "ok" : "warn"}>
                              {s.metrics.progressPct} %
                            </StatusChip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </>
        )}
      </div>
    </div>
  );
}
