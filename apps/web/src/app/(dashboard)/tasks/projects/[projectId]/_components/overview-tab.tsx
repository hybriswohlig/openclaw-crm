"use client";

// Project overview tab (Mockup 2). Three columns; the middle column is a
// condensed view of the Plan tab so the most common question — "where do we
// stand?" — is answered without a tab switch.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Layers } from "lucide-react";
import type { ActivityJSON, MilestoneJSON, PhaseJSON, ProjectDocumentJSON, ProjectJSON } from "@/lib/work-types";
import { SectionCard } from "@/components/work/section-card";
import { ProgressBar } from "@/components/work/progress-bar";
import { MilestoneStatusChip, PhaseStatusChip, StatusChip } from "@/components/work/status-chip";
import { EmptyState, LoadingLine } from "@/components/work/empty-state";
import { AvatarStack } from "@/components/work/avatar-stack";
import { ActivityTimeline } from "@/components/records/activity-timeline";
import { activityTimelineType, formatDateDE, formatDayShortDE } from "@/lib/work-ui";
import { projectCategoryLabel } from "@/lib/project-constants";
import { priorityMeta } from "@/lib/task-priority";

// `reload` is not read here yet — Task 43 wires the member-management
// section into the "Projektinformationen" card and needs it there — but the
// prop is accepted from the start because page.tsx (Task 33) already passes
// it to every tab. Declaring it late would be a TS excess-property error at
// the call site the moment page.tsx starts sending it.
export function OverviewTab({ project, reload }: { project: ProjectJSON; reload: () => Promise<void> }) {
  const router = useRouter();
  const [phases, setPhases] = useState<PhaseJSON[]>([]);
  const [milestones, setMilestones] = useState<MilestoneJSON[]>([]);
  const [documents, setDocuments] = useState<ProjectDocumentJSON[]>([]);
  const [activity, setActivity] = useState<ActivityJSON[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [ph, ms, docs, act] = await Promise.allSettled([
      fetch(`/api/v1/projects/${project.id}/phases`, { cache: "no-store" }),
      fetch(`/api/v1/projects/${project.id}/milestones`, { cache: "no-store" }),
      fetch(`/api/v1/projects/${project.id}/documents`, { cache: "no-store" }),
      fetch(`/api/v1/projects/${project.id}/activity?limit=10`, { cache: "no-store" }),
    ]);
    if (ph.status === "fulfilled" && ph.value.ok) setPhases(((await ph.value.json())?.data ?? []) as PhaseJSON[]);
    if (ms.status === "fulfilled" && ms.value.ok) setMilestones(((await ms.value.json())?.data ?? []) as MilestoneJSON[]);
    if (docs.status === "fulfilled" && docs.value.ok) setDocuments(((await docs.value.json())?.data ?? []) as ProjectDocumentJSON[]);
    if (act.status === "fulfilled" && act.value.ok) setActivity(((await act.value.json())?.data ?? []) as ActivityJSON[]);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const goTab = (tab: string) => router.replace(`/tasks/projects/${project.id}?tab=${tab}`, { scroll: false });

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)_minmax(0,0.85fr)]">
      {/* ── links ─────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4">
        <SectionCard
          title="Projektziel & Scope"
          action={
            <button
              type="button"
              onClick={() => goTab("plan")}
              className="text-xs"
              style={{ color: "var(--kottke-accent)" }}
            >
              Vollständigen Scope anzeigen →
            </button>
          }
        >
          {project.goalStatement ? (
            <p className="mb-3 text-[13px] leading-relaxed" style={{ color: "var(--foreground)" }}>
              {project.goalStatement}
            </p>
          ) : (
            <p className="mb-3 text-[13px]" style={{ color: "var(--muted-foreground)" }}>
              Noch kein Ziel hinterlegt.
            </p>
          )}

          <div className="k-label mb-1.5" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            Im Projekt enthalten
          </div>
          <ul className="mb-3 flex flex-col gap-1">
            {project.scopeIn.slice(0, 6).map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px]" style={{ color: "var(--foreground)" }}>
                <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: "var(--ok)" }} />
                {s}
              </li>
            ))}
            {project.scopeIn.length === 0 && (
              <li className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
                Kein Scope erfasst.
              </li>
            )}
          </ul>

          <div className="k-label mb-1.5" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
            Nicht im Projekt enthalten
          </div>
          <ul className="flex flex-col gap-1">
            {project.scopeOut.slice(0, 4).map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
                <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: "var(--danger)" }} />
                {s}
              </li>
            ))}
            {project.scopeOut.length === 0 && (
              <li className="text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
                Keine Ausschlüsse erfasst.
              </li>
            )}
          </ul>
        </SectionCard>

        <SectionCard title="Meilensteine" subtitle={`${project.stats.reachedMilestones} von ${project.stats.totalMilestones} erreicht`}>
          {loading && milestones.length === 0 ? (
            <LoadingLine />
          ) : milestones.length === 0 ? (
            <EmptyState title="Keine Meilensteine" hint="Leg sie im Tab „Plan“ an." />
          ) : (
            <ol className="flex flex-col">
              {milestones.map((m, i) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2.5 py-2"
                  style={{ borderTop: i === 0 ? 0 : "1px dashed var(--border)" }}
                >
                  <span
                    className="k-mono inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px]"
                    style={{
                      borderColor:
                        m.status === "erreicht"
                          ? "color-mix(in oklch, var(--ok) 40%, transparent)"
                          : "var(--border)",
                      color: m.status === "erreicht" ? "var(--ok)" : "var(--muted-foreground)",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]" style={{ color: "var(--foreground)" }}>
                      {m.name}
                    </div>
                    <div className="text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
                      {formatDateDE(m.dueDate)}
                    </div>
                  </div>
                  <MilestoneStatusChip status={m.status} />
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>

      {/* ── Mitte ─────────────────────────────────────────────── */}
      <SectionCard
        title="Projektplan"
        subtitle={`${phases.length} Arbeitsbereiche`}
        action={
          <button
            type="button"
            onClick={() => goTab("plan")}
            className="text-xs"
            style={{ color: "var(--kottke-accent)" }}
          >
            Plan bearbeiten →
          </button>
        }
        className="min-w-0"
      >
        {loading && phases.length === 0 ? (
          <LoadingLine />
        ) : phases.length === 0 ? (
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="Noch kein Plan"
            hint="Leg im Tab „Plan“ den ersten Arbeitsbereich an."
          />
        ) : (
          <div className="flex flex-col gap-2">
            {phases.map((ph) => (
              <div key={ph.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium" style={{ color: "var(--foreground)" }}>
                    {ph.name}
                  </span>
                  <PhaseStatusChip status={ph.status} />
                  {ph.dueDate && (
                    <span className="k-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                      bis {formatDayShortDE(ph.dueDate)}
                    </span>
                  )}
                </div>
                {ph.description && (
                  <p className="mt-1 line-clamp-2 text-[12.5px]" style={{ color: "var(--muted-foreground)" }}>
                    {ph.description}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3">
                  <ProgressBar value={ph.progressPct} height={5} className="flex-1" />
                  <span className="k-mono shrink-0 text-[11px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                    {ph.doneTasks}/{ph.totalTasks}
                  </span>
                  <AvatarStack
                    className="shrink-0"
                    people={ph.assigneeUserIds.map((id) => {
                      const m = project.members.find((x) => x.userId === id);
                      return { id, name: m?.name ?? "?", image: m?.image };
                    })}
                    max={3}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── rechts ────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4">
        <SectionCard title="Projektinformationen">
          <dl className="flex flex-col gap-2 text-[12.5px]">
            <InfoRow
              label="Projektleiter"
              value={project.members.find((m) => m.userId === project.ownerUserId)?.name ?? "–"}
            />
            <InfoRow label="Meilensteine" value={`${project.stats.reachedMilestones}/${project.stats.totalMilestones}`} />
            <InfoRow label="Bereich" value={projectCategoryLabel(project.category) || "–"} />
            <InfoRow label="Priorität" value={priorityMeta(project.priority)?.label ?? "–"} />
            <InfoRow label="Startdatum" value={formatDateDE(project.startDate)} />
            <InfoRow label="Geplantes Enddatum" value={formatDateDE(project.endDate)} />
            <InfoRow label="Erstellt am" value={formatDateDE(project.createdAt)} />
          </dl>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {project.members.map((m) => (
              <StatusChip key={m.userId} tone={m.role === "leiter" ? "accent" : "neutral"}>
                {m.name} · {m.role}
              </StatusChip>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Verknüpfte Dokumente"
          action={
            <button type="button" onClick={() => goTab("dokumente")} className="text-xs" style={{ color: "var(--kottke-accent)" }}>
              Alle →
            </button>
          }
        >
          {documents.length === 0 ? (
            <EmptyState icon={<FileText className="h-5 w-5" />} title="Keine Dokumente" hint="Lade sie im Tab „Dokumente“ hoch." />
          ) : (
            <ul className="flex flex-col">
              {documents.slice(0, 5).map((d, i) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 py-2"
                  style={{ borderTop: i === 0 ? 0 : "1px dashed var(--border)" }}
                >
                  <FileText className="h-[14px] w-[14px] shrink-0" style={{ color: "var(--muted-foreground)" }} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "var(--foreground)" }}>
                    {d.fileName}
                  </span>
                  <span className="k-mono shrink-0 text-[10.5px]" style={{ color: "var(--muted-foreground)" }}>
                    {Math.max(1, Math.round(d.fileSize / 1024))} KB
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Aktivitäten">
          {activity.length === 0 ? (
            <EmptyState title="Noch keine Aktivität" />
          ) : (
            <div className="-mx-3">
              {/* Read defensively: this is the DEFAULT tab of every project
                  page, so a TypeError in this map blanks the entire project
                  surface (defect W2). */}
              <ActivityTimeline
                activities={activity.map((a, i) => ({
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
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt style={{ color: "var(--muted-foreground)" }}>{label}</dt>
      <dd className="truncate text-right" style={{ color: "var(--foreground)" }}>
        {value}
      </dd>
    </div>
  );
}
