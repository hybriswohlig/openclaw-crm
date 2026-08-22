"use client";

// Project list (Spec §8, route table). Cards and table share one fetch and
// one filter state; the "fav=1" query parameter is what the Favoriten entry
// of the module navigation points at.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type { ProjectJSON, ProjectListJSON } from "@/lib/work-types";
import { readApiError } from "@/lib/work-ui";
import { PROJECT_CATEGORIES, PROJECT_STATUS, projectStatusLabel } from "@/lib/project-constants";
import { ModuleNav } from "@/components/work/module-nav";
import { FilterChips, SegmentedControl } from "@/components/work/filter-chips";
import { ProjectCard, NewProjectTile } from "@/components/work/project-card";
import { EmptyState, ErrorLine, LoadingLine } from "@/components/work/empty-state";
import { toast } from "sonner";
import { ProjectIcon } from "@/components/work/project-icon";
import { ProgressBar } from "@/components/work/progress-bar";
import { AvatarStack } from "@/components/work/avatar-stack";
import { ProjectStatusChip } from "@/components/work/status-chip";
import { formatDateDE, formatEURCents } from "@/lib/work-ui";
import { projectCategoryLabel } from "@/lib/project-constants";

type StatusFilter = "alle" | (typeof PROJECT_STATUS)[number];
type ViewMode = "karten" | "tabelle";

/** The route caps at 200; asking for more just gets clamped (plan R7.3). */
const PROJECT_PAGE_SIZE = 200;

export default function ProjectsPage() {
  return (
    <Suspense fallback={<LoadingLine label="Projekte werden geladen…" />}>
      <ProjectsPageInner />
    </Suspense>
  );
}

function ProjectsPageInner() {
  const params = useSearchParams();
  const favOnly = params.get("fav") === "1";

  const [projects, setProjects] = useState<ProjectJSON[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("alle");
  const [category, setCategory] = useState<string>("");
  const [view, setView] = useState<ViewMode>("karten");
  const [query, setQuery] = useState("");
  const reqSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  // Status and category are filtered CLIENT-side. Filtering them server-side
  // and then counting the chips over the already-filtered array makes every
  // other chip read 0 as soon as one is clicked (defect W11). Only
  // `favoritesOnly` stays a query parameter, because it is a different set,
  // not a subset — the page header changes with it.
  const load = useCallback(async () => {
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    const seq = ++reqSeq.current;

    setLoading(true);
    const qs = new URLSearchParams({ limit: String(PROJECT_PAGE_SIZE) });
    if (favOnly) qs.set("favoritesOnly", "true");
    try {
      const res = await fetch(`/api/v1/projects?${qs.toString()}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
      if (seq !== reqSeq.current) return;
      if (!res.ok) throw new Error("load failed");
      const json = await res.json();
      if (seq !== reqSeq.current) return;
      const payload = (json?.data ?? null) as ProjectListJSON | null;
      setProjects(payload?.projects ?? []);
      setTotal(payload?.pagination?.total ?? payload?.projects?.length ?? 0);
      setFailed(false);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setFailed(true);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [favOnly]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const toggleFavorite = useCallback(
    async (projectId: string, next: boolean) => {
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, isFavorite: next } : p)));
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/favorite`, {
          method: next ? "PUT" : "DELETE",
        });
        if (!res.ok) throw new Error(await readApiError(res, "Favorit konnte nicht gespeichert werden"));
      } catch (err) {
        // A rejecting fetch must roll back too, not escape as an unhandled
        // rejection with the star left yellow (defect R9).
        toast.error("Favorit konnte nicht gespeichert werden", {
          description: err instanceof Error ? err.message : undefined,
        });
        await load();
      }
    },
    [load]
  );

  // One client-side pipeline for status, category and search, so the chip
  // counters below always describe the same set the list shows.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => {
      if (status !== "alle" && p.status !== status) return false;
      if (category && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) || (p.shortDescription ?? "").toLowerCase().includes(q)
      );
    });
  }, [projects, status, category, query]);

  const filtersActive = status !== "alle" || category !== "" || query.trim() !== "";
  const truncated = total > projects.length;

  // Counted over the UNFILTERED load, so every chip keeps showing its own
  // number after another chip is clicked.
  const statusOptions: Array<{ value: StatusFilter; label: string; count?: number }> = [
    { value: "alle", label: "Alle", count: projects.length },
    ...PROJECT_STATUS.map((s) => ({
      value: s as StatusFilter,
      label: projectStatusLabel(s) || s,
      count: projects.filter((p) => p.status === s).length,
    })),
  ];

  return (
    <div className="k-paper-noise min-h-full">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="k-label mb-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              Arbeit
            </div>
            <h1
              className="k-display"
              style={{ margin: 0, fontSize: "clamp(26px, 4vw, 36px)", lineHeight: 1.05 }}
            >
              {favOnly ? "Favoriten" : "Projekte"}
            </h1>
            <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted-foreground)" }}>
              {visible.length} {visible.length === 1 ? "Projekt" : "Projekte"}
              {filtersActive ? ` von ${projects.length}` : ""}
              {truncated ? ` · nur die ersten ${projects.length} von ${total} geladen` : ""}
              {favOnly ? " · als Favorit markiert" : ""}
            </p>
          </div>
          <Link
            href="/tasks/projects/new"
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium"
            style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
          >
            <Plus className="h-[15px] w-[15px]" />
            Neues Projekt
          </Link>
        </div>

        <ModuleNav />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterChips options={statusOptions} value={status} onChange={setStatus} />
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Projekt suchen…"
              className="h-8 w-[180px] rounded-lg border border-border bg-card px-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 rounded-lg border border-border bg-card px-2 text-[13px] text-foreground"
              aria-label="Bereich"
            >
              <option value="">Alle Bereiche</option>
              {PROJECT_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <SegmentedControl
              options={[
                { value: "karten", label: "Karten" },
                { value: "tabelle", label: "Tabelle" },
              ]}
              value={view}
              onChange={setView}
            />
          </div>
        </div>

        {loading && projects.length === 0 && <LoadingLine label="Projekte werden geladen…" />}
        {failed && projects.length === 0 && <ErrorLine onRetry={load} />}

        {!loading && visible.length === 0 && !failed && (
          <div className="k-card">
            {filtersActive ? (
              // Distinct from "there are no projects": telling someone with 40
              // projects that the wizard will walk them through their first is
              // simply false (defect W11).
              <EmptyState
                title="Keine Projekte mit diesen Filtern"
                hint={`${projects.length} ${projects.length === 1 ? "Projekt ist" : "Projekte sind"} geladen, aber keines passt auf die aktuelle Auswahl.`}
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setStatus("alle");
                      setCategory("");
                      setQuery("");
                    }}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[13.5px] font-medium text-foreground hover:bg-muted"
                  >
                    Filter zurücksetzen
                  </button>
                }
              />
            ) : (
              <EmptyState
                title={favOnly ? "Keine Favoriten" : "Noch keine Projekte"}
                hint={
                  favOnly
                    ? "Markiere ein Projekt mit dem Stern, dann erscheint es hier."
                    : "Der Wizard führt dich in fünf Schritten durch das erste Projekt."
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
            )}
          </div>
        )}

        {visible.length > 0 && view === "karten" && (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {visible.map((p) => (
              <ProjectCard key={p.id} project={p} onToggleFavorite={toggleFavorite} />
            ))}
            <NewProjectTile />
          </div>
        )}

        {visible.length > 0 && view === "tabelle" && <ProjectsTable projects={visible} />}
      </div>
    </div>
  );
}

function ProjectsTable({ projects }: { projects: ProjectJSON[] }) {
  return (
    // The table gets its own horizontal scroller so the page body never
    // scrolls sideways on a phone.
    <div className="k-card overflow-x-auto p-0">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            {["Projekt", "Status", "Bereich", "Fortschritt", "Aufgaben", "Überfällig", "Budget", "Ende", "Team"].map(
              (h) => (
                <th
                  key={h}
                  className="k-label whitespace-nowrap px-3 py-2.5 text-left"
                  style={{
                    fontSize: 10,
                    color: "var(--muted-foreground)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {h}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="transition-colors hover:bg-muted/50">
              <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <Link href={`/tasks/projects/${p.id}`} className="flex min-w-[180px] items-center gap-2">
                  <ProjectIcon
                    icon={p.icon}
                    category={p.category}
                    name={p.name}
                    color={p.color}
                    size={26}
                  />
                  <span className="truncate font-medium" style={{ color: "var(--foreground)" }}>
                    {p.name}
                  </span>
                </Link>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <ProjectStatusChip status={p.status} />
              </td>
              <td
                className="whitespace-nowrap px-3 py-2.5"
                style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}
              >
                {projectCategoryLabel(p.category) || "–"}
              </td>
              <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)", minWidth: 130 }}>
                <ProgressBar value={p.stats.progressPct} showValue height={5} />
              </td>
              <td
                className="whitespace-nowrap px-3 py-2.5 tabular-nums"
                style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground)" }}
              >
                {p.stats.doneTasks}/{p.stats.totalTasks}
              </td>
              <td
                className="whitespace-nowrap px-3 py-2.5 tabular-nums"
                style={{
                  borderBottom: "1px solid var(--border)",
                  color: p.stats.overdueTasks > 0 ? "var(--danger)" : "var(--muted-foreground)",
                }}
              >
                {p.stats.overdueTasks}
              </td>
              <td
                className="whitespace-nowrap px-3 py-2.5 tabular-nums"
                style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}
              >
                {p.stats.budgetPlannedCents == null
                  ? "–"
                  : `${formatEURCents(p.stats.budgetSpentCents)} / ${formatEURCents(p.stats.budgetPlannedCents)}`}
              </td>
              <td
                className="whitespace-nowrap px-3 py-2.5"
                style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}
              >
                {formatDateDE(p.endDate)}
              </td>
              <td className="px-3 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <AvatarStack
                  people={p.members.map((m) => ({ id: m.userId, name: m.name, image: m.image }))}
                  max={3}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
