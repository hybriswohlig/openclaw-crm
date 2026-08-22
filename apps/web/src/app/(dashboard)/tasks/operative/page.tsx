"use client";

// Operative tasks (Spec §8, route table). One flat list with the same filter
// chips as the dashboard, plus a per-area filter. The dashboard's "Überfällig"
// KPI links here with ?filter=ueberfaellig.
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/lib/auth-client";
import type { TaskJSON, TaskListJSON } from "@/lib/work-types";
import { OPERATIVE_AREAS, operativeAreaLabel } from "@/lib/project-constants";
import {
  OPERATIVE_FILTERS,
  matchesOperativeFilter,
  groupBy,
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<OperativeFilter>(
    OPERATIVE_FILTERS.some((f) => f.value === initialFilter) ? initialFilter : "heute"
  );
  const [area, setArea] = useState<string>("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TaskJSON | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/tasks?kind=operativ&showCompleted=true&limit=200", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("load failed");
      const json = await res.json();
      const payload = (json?.data ?? null) as TaskListJSON | null;
      setTasks(payload?.tasks ?? []);
      setTotal(payload?.pagination?.total ?? payload?.tasks?.length ?? 0);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => tasks.filter((t) => matchesOperativeFilter(t, filter) && (!area || t.area === area)),
    [tasks, filter, area]
  );

  const grouped = useMemo(
    () => groupBy(visible, (t) => t.area ?? "sonstiges"),
    [visible]
  );

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
              {visible.length} von {countLabel(tasks.length, total)} Aufgaben im laufenden Betrieb.
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
            options={OPERATIVE_FILTERS.map((f) => ({
              ...f,
              count: tasks.filter((t) => matchesOperativeFilter(t, f.value)).length,
            }))}
            value={filter}
            onChange={setFilter}
          />
          <select
            value={area}
            onChange={(e) => setArea(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-[13px] text-foreground"
            aria-label="Bereich"
          >
            <option value="">Alle Bereiche</option>
            {OPERATIVE_AREAS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {loading && tasks.length === 0 && <LoadingLine label="Aufgaben werden geladen…" />}
        {failed && tasks.length === 0 && <ErrorLine onRetry={load} />}

        {!loading && visible.length === 0 && !failed && (
          <div className="k-card">
            <EmptyState
              title="Nichts offen"
              hint="Für diesen Filter steht gerade nichts an. Wechsle auf „Alle“, um den kompletten Bestand zu sehen."
            />
          </div>
        )}

        {grouped.map((g) => (
          <SectionCard key={g.key} title={operativeAreaLabel(g.key) || "Sonstiges"} subtitle={`${g.items.length} Aufgaben`}>
            <div className="-mx-2 flex flex-col divide-y divide-border">
              {g.items.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  showProject={false}
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
                await fetch(`/api/v1/tasks/${editing.id}`, { method: "DELETE" });
                toast.success("Aufgabe gelöscht");
                await load();
              }
            : undefined
        }
      />
    </div>
  );
}
