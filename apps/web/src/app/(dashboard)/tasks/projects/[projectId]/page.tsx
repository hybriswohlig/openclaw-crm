"use client";

// Project detail (Mockup 2 / Spec §8.2). Eight tabs, the active one kept in
// ?tab= so a link can point straight at "Budget". Each tab loads its own
// data; only the project itself and its stats live here.
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, FolderX, MoreHorizontal, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectJSON } from "@/lib/work-types";
import { readApiError } from "@/lib/work-ui";
import { ModuleNav } from "@/components/work/module-nav";
import { ProjectIcon } from "@/components/work/project-icon";
import { ProjectStatusChip } from "@/components/work/status-chip";
import { AvatarStack } from "@/components/work/avatar-stack";
import { EmptyState, ErrorLine, LoadingLine } from "@/components/work/empty-state";
import { PROJECT_STATUS, projectStatusLabel } from "@/lib/project-constants";
import { KpiGrid, KpiTile } from "@/components/work/kpi-tile";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { formatDayShortDE, formatEURCents } from "@/lib/work-ui";
import { OverviewTab } from "./_components/overview-tab";
import { PlanTab } from "./_components/plan-tab";
import { TasksTab } from "./_components/tasks-tab";
import { TimelineTab } from "./_components/timeline-tab";
import { DocumentsTab } from "./_components/documents-tab";
import { BudgetTab } from "./_components/budget-tab";
import { RisksTab } from "./_components/risks-tab";
import { NotesTab } from "./_components/notes-tab";

export interface TabProps {
  project: ProjectJSON;
  reload: () => Promise<void>;
}

const TABS = [
  { value: "uebersicht", label: "Übersicht" },
  { value: "plan", label: "Plan" },
  { value: "aufgaben", label: "Aufgaben" },
  { value: "zeitleiste", label: "Zeitleiste" },
  { value: "dokumente", label: "Dokumente" },
  { value: "budget", label: "Budget" },
  { value: "risiken", label: "Risiken" },
  { value: "notizen", label: "Notizen" },
] as const;

export default function ProjectDetailPage() {
  return (
    <Suspense fallback={<LoadingLine label="Projekt wird geladen…" />}>
      <ProjectDetailInner />
    </Suspense>
  );
}

function ProjectDetailInner() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
  const search = useSearchParams();
  const tab = search.get("tab") ?? "uebersicht";

  const [project, setProject] = useState<ProjectJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}`, { cache: "no-store" });
      // A 404 is NOT a transient failure: retrying a deleted or mistyped id
      // can never succeed, so it gets its own state with a way back to the
      // list instead of the generic retry box (defect W9).
      if (res.status === 404) {
        setNotFound(true);
        setFailed(false);
        return;
      }
      if (!res.ok) {
        // Surface the server's own German message rather than a fixed
        // string — a 500 or a validation refusal on load was otherwise
        // indistinguishable from a plain network hiccup (D-1).
        throw new Error(await readApiError(res, "Projekt konnte nicht geladen werden."));
      }
      const json = await res.json();
      setProject((json?.data ?? null) as ProjectJSON | null);
      setNotFound(false);
      setFailed(false);
      setLoadError(null);
    } catch (err) {
      setFailed(true);
      setLoadError(err instanceof Error ? err.message : null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const setTab = useCallback(
    (next: string) => {
      // Replace, not push: tab switching should not fill the back stack.
      router.replace(`/tasks/projects/${projectId}?tab=${next}`, { scroll: false });
    },
    [router, projectId]
  );

  const toggleFavorite = useCallback(async () => {
    if (!project) return;
    const next = !project.isFavorite;
    setProject({ ...project, isFavorite: next });
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/favorite`, {
        method: next ? "PUT" : "DELETE",
      });
      if (!res.ok) throw new Error(await readApiError(res, "Favorit konnte nicht gespeichert werden"));
    } catch (err) {
      // Rejecting fetches must roll back too (defect R9).
      toast.error("Favorit konnte nicht gespeichert werden", {
        description: err instanceof Error ? err.message : undefined,
      });
      await reload();
    }
  }, [project, projectId, reload]);

  const changeStatus = useCallback(
    async (status: string) => {
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        toast.error("Status konnte nicht geändert werden", {
          description: await readApiError(res, ""),
        });
        return;
      }
      toast.success(`Status: ${projectStatusLabel(status)}`);
      setMenuOpen(false);
      await reload();
    },
    [projectId, reload]
  );

  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Link konnte nicht kopiert werden");
    }
  }

  async function remove() {
    if (!window.confirm("Projekt wirklich löschen? Phasen, Meilensteine, Risiken, Budget und Dokumente werden mit gelöscht.")) return;
    const res = await fetch(`/api/v1/projects/${projectId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Projekt konnte nicht gelöscht werden", { description: await readApiError(res, "") });
      return;
    }
    toast.success("Projekt gelöscht");
    router.push("/tasks/projects");
  }

  if (notFound) {
    return (
      <div className="k-paper-noise min-h-full">
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-8">
          <div className="k-card">
            <EmptyState
              icon={<FolderX className="h-6 w-6" />}
              title="Projekt nicht gefunden"
              hint="Es wurde vermutlich gelöscht, oder der Link ist nicht mehr gültig."
              action={
                <Link
                  href="/tasks/projects"
                  className="inline-flex h-9 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium"
                  style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
                >
                  Zurück zu den Projekten
                </Link>
              }
            />
          </div>
        </div>
      </div>
    );
  }
  if (loading && !project) return <LoadingLine label="Projekt wird geladen…" />;
  if (failed && !project) return <ErrorLine label={loadError ?? undefined} onRetry={reload} />;
  if (!project) return <ErrorLine label="Projekt konnte nicht geladen werden." onRetry={reload} />;

  return (
    <div className="k-paper-noise min-h-full">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div className="k-label" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
          <Link href="/tasks" style={{ color: "inherit" }}>
            Arbeit
          </Link>{" "}
          /{" "}
          <Link href="/tasks/projects" style={{ color: "inherit" }}>
            Projekte
          </Link>{" "}
          / {project.name}
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <ProjectIcon
              icon={project.icon}
              category={project.category}
              name={project.name}
              color={project.color}
              size={52}
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1
                  className="k-display m-0"
                  style={{ fontSize: "clamp(22px, 3.5vw, 30px)", lineHeight: 1.1 }}
                >
                  {project.name}
                </h1>
                <ProjectStatusChip status={project.status} />
                <button type="button" onClick={toggleFavorite} aria-label="Favorit umschalten">
                  <Star
                    className="h-[18px] w-[18px]"
                    style={{
                      color: project.isFavorite ? "var(--warn)" : "var(--muted-foreground)",
                      fill: project.isFavorite ? "var(--warn)" : "none",
                    }}
                  />
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-label="Weitere Aktionen"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
                  >
                    <MoreHorizontal className="h-[15px] w-[15px]" />
                  </button>
                  {menuOpen && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-lg">
                      <div className="k-label px-2 py-1" style={{ fontSize: 9.5, color: "var(--muted-foreground)" }}>
                        Status ändern
                      </div>
                      {PROJECT_STATUS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => changeStatus(s)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                        >
                          {s === project.status && <Check className="h-3.5 w-3.5 shrink-0" />}
                          <span className={s === project.status ? "" : "pl-[22px]"}>{projectStatusLabel(s)}</span>
                        </button>
                      ))}
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        onClick={remove}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted"
                        style={{ color: "var(--danger)" }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Projekt löschen
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {project.shortDescription && (
                <p className="mt-1 max-w-[70ch] text-[13.5px]" style={{ color: "var(--muted-foreground)" }}>
                  {project.shortDescription}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              title="Team verwalten"
              onClick={() => {
                setTab("uebersicht");
                // The tab content mounts on the next frame, so scroll after it.
                requestAnimationFrame(() =>
                  document.getElementById("projekt-team")?.scrollIntoView({ behavior: "smooth", block: "center" })
                );
              }}
              className="rounded-full"
            >
              <AvatarStack
                people={project.members.map((m) => ({ id: m.userId, name: m.name, image: m.image }))}
                max={4}
                size="sm"
              />
              {project.members.length === 0 && (
                <span className="text-[12.5px]" style={{ color: "var(--kottke-accent)" }}>
                  Team zuweisen
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={share}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-[13.5px] font-medium text-foreground transition-colors hover:bg-muted"
            >
              {copied ? <Check className="h-[15px] w-[15px]" /> : <Copy className="h-[15px] w-[15px]" />}
              {copied ? "Kopiert" : "Teilen"}
            </button>
          </div>
        </div>

        <ModuleNav />

        <ProjectKpis project={project} />

        <Tabs value={tab} onValueChange={setTab} className="flex min-w-0 flex-col">
          <TabsList className="flex w-full overflow-x-auto">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="mt-4 min-w-0">
            <TabsContent value="uebersicht">
              <OverviewTab project={project} reload={reload} />
            </TabsContent>
            <TabsContent value="plan">
              <PlanTab project={project} reload={reload} />
            </TabsContent>
            <TabsContent value="aufgaben">
              <TasksTab project={project} reload={reload} />
            </TabsContent>
            <TabsContent value="zeitleiste">
              <TimelineTab project={project} reload={reload} />
            </TabsContent>
            <TabsContent value="dokumente">
              <DocumentsTab project={project} reload={reload} />
            </TabsContent>
            <TabsContent value="budget">
              <BudgetTab project={project} reload={reload} />
            </TabsContent>
            <TabsContent value="risiken">
              <RisksTab project={project} reload={reload} />
            </TabsContent>
            <TabsContent value="notizen">
              <NotesTab project={project} reload={reload} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

function ProjectKpis({ project }: { project: ProjectJSON }) {
  const s = project.stats;
  const owner = project.members.find((m) => m.userId === project.ownerUserId) ?? null;
  const riskParts = (["hoch", "mittel", "niedrig"] as const)
    .map((sev) => `${s.risksBySeverity[sev] ?? 0} ${sev}`)
    .join(" · ");

  return (
    <KpiGrid>
      {/* Zero tasks is "not planned yet", not "0 % done" — fall back to the
          phase count, which ProjectStats already carries (defect W12). */}
      {s.totalTasks === 0 ? (
        <KpiTile
          label="Projektfortschritt"
          value={s.totalPhases > 0 ? `${s.donePhases}/${s.totalPhases}` : "–"}
          progress={s.totalPhases > 0 ? (s.donePhases / s.totalPhases) * 100 : null}
          tone={s.totalPhases > 0 ? "info" : "neutral"}
          sub={s.totalPhases > 0 ? "Phasen abgeschlossen · noch keine Aufgaben" : "noch nichts geplant"}
        />
      ) : (
        <KpiTile
          label="Projektfortschritt"
          value={`${s.progressPct} %`}
          progress={s.progressPct}
          sub={`${s.doneTasks} von ${s.totalTasks} Aufgaben`}
        />
      )}
      <KpiTile
        label="Aufgaben"
        value={s.totalTasks === 0 ? "–" : `${s.doneTasks}/${s.totalTasks}`}
        tone={s.overdueTasks > 0 ? "warn" : "neutral"}
        sub={
          s.totalTasks === 0
            ? "noch keine Aufgaben angelegt"
            : s.overdueTasks > 0
              ? `${s.overdueTasks} überfällig`
              : "nichts überfällig"
        }
      />
      <KpiTile
        label="Meilensteine"
        value={`${s.reachedMilestones}/${s.totalMilestones}`}
        sub={s.nextMilestoneAt ? `nächster: ${formatDayShortDE(s.nextMilestoneAt)}` : "kein Termin offen"}
      />
      <KpiTile
        label="Budget"
        value={
          s.budgetPlannedCents == null
            ? "–"
            : `${formatEURCents(s.budgetSpentCents)} / ${formatEURCents(s.budgetPlannedCents)}`
        }
        progress={s.budgetPct}
        tone={s.budgetPct != null && s.budgetPct > 100 ? "danger" : "accent"}
        sub={s.budgetPct == null ? "kein Rahmen hinterlegt" : `${s.budgetPct} % verwendet`}
      />
      <KpiTile
        label="Risiken"
        value={String(s.openRisks)}
        tone={(s.risksBySeverity.hoch ?? 0) > 0 ? "danger" : s.openRisks > 0 ? "warn" : "ok"}
        sub={riskParts}
      />
      <div className="k-card flex min-h-[104px] flex-col justify-between gap-2 p-4">
        <div className="k-label" style={{ fontSize: 10.5, color: "var(--muted-foreground)", letterSpacing: "0.1em" }}>
          Projektverantwortlicher
        </div>
        {owner ? (
          <div className="flex items-center gap-2.5">
            <EmployeeAvatar name={owner.name} photoBase64={owner.image} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-medium" style={{ color: "var(--foreground)" }}>
                {owner.name}
              </div>
              <div className="truncate text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
                {owner.email}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[13px]" style={{ color: "var(--muted-foreground)" }}>
            Nicht zugewiesen
          </div>
        )}
      </div>
    </KpiGrid>
  );
}
