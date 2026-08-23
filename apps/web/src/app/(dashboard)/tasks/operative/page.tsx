"use client";

// Operative tasks (Spec §8, route table). One flat list with the same filter
// chips as the dashboard, plus a per-area filter. The dashboard's "Überfällig"
// KPI links here with ?filter=ueberfaellig.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import type { TaskJSON, TaskListJSON, WorkCountsJSON } from "@/lib/work-types";
import { OPERATIVE_AREAS, operativeAreaLabel } from "@/lib/project-constants";
import {
  OPERATIVE_FILTERS,
  matchesOperativeFilter,
  matchesOverdueAreaFilter,
  operativeFilterChipCounts,
  operativeHeaderTotals,
  groupBy,
  taskGroupKey,
  PROJECT_TASK_GROUP_KEY,
  type OperativeFilter,
} from "@/lib/work-ui";
import { ModuleNav } from "@/components/work/module-nav";
import { FilterChips } from "@/components/work/filter-chips";
import { SectionCard } from "@/components/work/section-card";
import { TaskRow } from "@/components/work/task-row";
import { EmptyState, ErrorLine, LoadingLine } from "@/components/work/empty-state";
import { WorkTaskDialog, type WorkTaskSavePayload } from "@/components/work/task-dialog";
import { countLabel, readApiError } from "@/lib/work-ui";

export default function OperativePage() {
  return (
    <Suspense fallback={<LoadingLine label="Aufgaben werden geladen…" />}>
      <OperativeInner />
    </Suspense>
  );
}

function OperativeInner() {
  const search = useSearchParams();
  const { data: session } = useSession();
  const initialFilter = (search.get("filter") ?? "heute") as OperativeFilter;

  const [tasks, setTasks] = useState<TaskJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // I2: the honest, completed-excluded server total behind "operativeOpenCount"
  // — used for the header line under "heute"/"woche". `pagination.total` of
  // the fetch above counts completed tasks too (it needs showCompleted=true
  // for the "Alle" chip).
  const [operativeOpenTotal, setOperativeOpenTotal] = useState(0);
  // C2: the TRUE completed-inclusive kind=operativ total (`pagination.total`
  // of the same showCompleted=true fetch, independent of its 200-task page
  // cap). Under filter="alle" every loaded task is rendered regardless of
  // completion, so the header's denominator must be this — pairing it with
  // the completed-excluded `operativeOpenTotal` above printed "12 von 5".
  const [operativeAllTotal, setOperativeAllTotal] = useState(0);
  // I2: overdue tasks of EVERY kind (project + operativ), matching the
  // dashboard's "Überfällig" KPI tile exactly (GET /api/v1/tasks?overdue=true
  // has no kind filter). This page's `tasks` is kind=operativ only, so the
  // Überfällig chip/list switch to this population instead — otherwise the
  // tile said 9, this page said 4, and the overdue project tasks had nowhere
  // to be seen.
  const [overdueAll, setOverdueAll] = useState<TaskJSON[]>([]);
  const [overdueAllTotal, setOverdueAllTotal] = useState(0);
  const [overdueAllFailed, setOverdueAllFailed] = useState(false);
  const [filter, setFilter] = useState<OperativeFilter>(
    OPERATIVE_FILTERS.some((f) => f.value === initialFilter) ? initialFilter : "heute"
  );
  const [area, setArea] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskJSON | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [opRes, countsRes, overdueRes] = await Promise.allSettled([
      fetch("/api/v1/tasks?kind=operativ&showCompleted=true&limit=200", { cache: "no-store" }),
      fetch("/api/v1/work/counts", { cache: "no-store" }),
      // No kind filter: I2 needs the same all-kinds population the KPI tile
      // counted. `overdue=true` already excludes completed tasks server-side
      // (a finished task can never be overdue).
      fetch("/api/v1/tasks?overdue=true&limit=200", { cache: "no-store" }),
    ]);

    // Captured locally, not read back off state: state set earlier in this
    // same call has not committed yet, so reading it here would see the
    // value from BEFORE this load() started.
    let fetchedOperativeTotal = 0;

    if (opRes.status === "fulfilled" && opRes.value.ok) {
      const payload = ((await opRes.value.json())?.data ?? null) as TaskListJSON | null;
      fetchedOperativeTotal = payload?.pagination?.total ?? payload?.tasks?.length ?? 0;
      setTasks(payload?.tasks ?? []);
      setOperativeAllTotal(fetchedOperativeTotal);
      setFailed(false);
    } else {
      setFailed(true);
    }

    if (countsRes.status === "fulfilled" && countsRes.value.ok) {
      const counts = ((await countsRes.value.json())?.data ?? null) as WorkCountsJSON | null;
      // Best-effort: falling back to the (completed-inclusive) operativ total
      // is a smaller lie than the header showing nothing.
      setOperativeOpenTotal(counts?.operativeOpenCount ?? fetchedOperativeTotal);
    } else {
      setOperativeOpenTotal(fetchedOperativeTotal);
    }

    if (overdueRes.status === "fulfilled" && overdueRes.value.ok) {
      const payload = ((await overdueRes.value.json())?.data ?? null) as TaskListJSON | null;
      setOverdueAll(payload?.tasks ?? []);
      setOverdueAllTotal(payload?.pagination?.total ?? payload?.tasks?.length ?? 0);
      setOverdueAllFailed(false);
    } else {
      setOverdueAllFailed(true);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    // C6: project tasks carry area=null (Bereich only applies to
    // kind="operativ"), so filtering the all-kinds Überfällig population by
    // the operativ Bereich select would silently drop every project task
    // the moment any Bereich was picked — matchesOverdueAreaFilter exempts
    // them instead; they stay visible under their own group (taskGroupKey).
    if (filter === "ueberfaellig") return overdueAll.filter((t) => matchesOverdueAreaFilter(t, area));
    return tasks.filter((t) => matchesOperativeFilter(t, filter) && (!area || t.area === area));
  }, [tasks, overdueAll, filter, area]);

  const grouped = useMemo(
    () => groupBy(visible, taskGroupKey),
    [visible]
  );

  const headerTotals = operativeHeaderTotals({
    filter,
    visibleCount: visible.length,
    operativeAllTotal,
    operativeOpenTotal,
    loadedOverdueAllCount: overdueAll.length,
    overdueAllTotal,
  });

  // The Überfällig view has its own, independent population (all kinds) and
  // must not be governed by the unrelated kind=operativ fetch's own
  // failed/empty state, or vice versa.
  const viewFailed = filter === "ueberfaellig" ? overdueAllFailed : failed;

  async function save(payload: WorkTaskSavePayload) {
    const url = editing ? `/api/v1/tasks/${editing.id}` : "/api/v1/tasks";
    const res = await fetch(url, {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await readApiError(res, "Speichern fehlgeschlagen"));
    toast.success(editing ? "Aufgabe aktualisiert" : "Aufgabe erstellt");
    await load();
  }

  return (
    <div className="k-paper-noise min-h-full">
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-8 sm:py-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="k-label mb-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              Arbeit
            </div>
            <h1 className="k-display" style={{ margin: 0, fontSize: "clamp(26px, 4vw, 36px)", lineHeight: 1.05 }}>
              Operative Aufgaben
            </h1>
            <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted-foreground)" }}>
              {visible.length} von {countLabel(headerTotals.loaded, headerTotals.total)}
              {filter === "ueberfaellig" ? " überfällige Aufgaben (alle Arten)." : " Aufgaben im laufenden Betrieb."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13.5px] font-medium"
            style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
          >
            <Plus className="h-[15px] w-[15px]" />
            Neue Aufgabe
          </button>
        </div>

        <ModuleNav />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterChips
            options={operativeFilterChipCounts(tasks, overdueAllTotal)}
            value={filter}
            onChange={setFilter}
          />
          <select
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-[13px] text-foreground"
            aria-label="Bereich"
            // C6: Bereich only applies to operativ tasks — under Überfällig,
            // project tasks have no Bereich and are never dropped by this
            // filter (matchesOverdueAreaFilter), so make that legible
            // instead of leaving the reader to infer it from an unaffected
            // "Projektaufgaben" group.
            title={
              filter === "ueberfaellig"
                ? "Gilt nur für operative Aufgaben — Projektaufgaben bleiben immer sichtbar"
                : undefined
            }
          >
            <option value="">Alle Bereiche</option>
            {OPERATIVE_AREAS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        {filter === "ueberfaellig" && (
          <p className="-mt-2 text-[12px]" style={{ color: "var(--muted-foreground)" }}>
            Der Bereich-Filter gilt nur für operative Aufgaben — Projektaufgaben haben keinen
            Bereich und bleiben immer unter „Projektaufgaben“ sichtbar.
          </p>
        )}

        {loading && visible.length === 0 && <LoadingLine label="Aufgaben werden geladen…" />}
        {!loading && viewFailed && visible.length === 0 && <ErrorLine onRetry={load} />}

        {!loading && visible.length === 0 && !viewFailed && (
          <div className="k-card">
            <EmptyState
              title="Nichts offen"
              hint="Für diesen Filter steht gerade nichts an. Wechsle auf „Alle“, um den kompletten Bestand zu sehen."
            />
          </div>
        )}

        {grouped.map((g) => (
          <SectionCard
            key={g.key}
            title={g.key === PROJECT_TASK_GROUP_KEY ? "Projektaufgaben" : operativeAreaLabel(g.key) || "Sonstiges"}
            subtitle={
              g.key === PROJECT_TASK_GROUP_KEY
                ? `${g.items.length} Aufgaben — ohne Bereich`
                : `${g.items.length} Aufgaben`
            }
          >
            <div className="-mx-2 flex flex-col divide-y divide-border">
              {g.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  // I2: the Überfällig view mixes in project tasks, so those
                  // rows need the project chip to be distinguishable from
                  // operative ones.
                  showProject={filter === "ueberfaellig"}
                  onOpen={(task) => {
                    setEditing(task);
                    setDialogOpen(true);
                  }}
                  onToggled={load}
                />
              ))}
            </div>
          </SectionCard>
        ))}
      </div>

      <WorkTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={editing ? "edit" : "create"}
        task={editing}
        currentUserId={session?.user?.id}
        defaultKind="operativ"
        defaultArea={area || null}
        onSave={save}
        onDelete={
          editing
            ? async () => {
                const res = await fetch(`/api/v1/tasks/${editing.id}`, { method: "DELETE" });
                if (!res.ok) {
                  toast.error("Aufgabe konnte nicht gelöscht werden", {
                    description: await readApiError(res, ""),
                  });
                  return;
                }
                toast.success("Aufgabe gelöscht");
                await load();
              }
            : undefined
        }
      />
    </div>
  );
}
