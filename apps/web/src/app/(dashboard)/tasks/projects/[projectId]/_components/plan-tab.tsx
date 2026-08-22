"use client";

// Plan tab: the full CRUD surface for phases (Arbeitsbereiche) and
// milestones, plus the editable scope lists. Reordering is a single
// POST /phases/reorder with the complete id order (Spec §10).
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { MilestoneJSON, PhaseJSON, ProjectJSON } from "@/lib/work-types";
import { SectionCard } from "@/components/work/section-card";
import { ProgressBar } from "@/components/work/progress-bar";
import { MilestoneStatusChip, PhaseStatusChip } from "@/components/work/status-chip";
import { EmptyState, LoadingLine } from "@/components/work/empty-state";
import { PHASE_STATUS, MILESTONE_STATUS } from "@/lib/project-constants";
import { formatDateDE, readApiError, toDateInputValue } from "@/lib/work-ui";

const inputClass =
  "h-8 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25";

const PHASE_STATUS_LABEL: Record<string, string> = {
  geplant: "Geplant",
  in_arbeit: "In Arbeit",
  abgeschlossen: "Abgeschlossen",
};
const MILESTONE_STATUS_LABEL: Record<string, string> = {
  geplant: "Geplant",
  erreicht: "Erreicht",
  verfehlt: "Verfehlt",
};

export function PlanTab({ project, reload }: { project: ProjectJSON; reload: () => Promise<void> }) {
  const [phases, setPhases] = useState<PhaseJSON[]>([]);
  const [milestones, setMilestones] = useState<MilestoneJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [newPhase, setNewPhase] = useState("");
  const [newMilestone, setNewMilestone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [ph, ms] = await Promise.allSettled([
      fetch(`/api/v1/projects/${project.id}/phases`, { cache: "no-store" }),
      fetch(`/api/v1/projects/${project.id}/milestones`, { cache: "no-store" }),
    ]);
    if (ph.status === "fulfilled" && ph.value.ok) setPhases(((await ph.value.json())?.data ?? []) as PhaseJSON[]);
    if (ms.status === "fulfilled" && ms.value.ok) setMilestones(((await ms.value.json())?.data ?? []) as MilestoneJSON[]);
    setLoading(false);
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Resolves to true on success. Callers that clear an input must check it —
   * a promise that always fulfils clears the form on failure and makes the
   * user retype everything (defect R13). The German server message is shown
   * verbatim (plan R7.1); `reloadOnError` puts an optimistic list back.
   */
  async function mutate(
    fn: () => Promise<Response>,
    okMsg: string,
    errMsg: string,
    opts?: { reloadOnError?: boolean }
  ): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(await readApiError(res, errMsg));
      toast.success(okMsg);
      await load();
      await reload();
      return true;
    } catch (err) {
      toast.error(errMsg, { description: err instanceof Error ? err.message : undefined });
      if (opts?.reloadOnError) await load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const addPhase = async () => {
    const ok = await mutate(
      () =>
        fetch(`/api/v1/projects/${project.id}/phases`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newPhase.trim() }),
        }),
      "Arbeitsbereich angelegt",
      "Arbeitsbereich konnte nicht angelegt werden"
    );
    if (ok) setNewPhase(""); // only on success (R13)
  };

  /**
   * Optimistic, same shape as risks-tab.tsx's patchRisk: a PATCH plus two
   * reloads takes long enough that a select bound straight to the server
   * value snaps back to the old one for that whole window — users read that
   * as "it didn't take" and pick again, firing a second write (defect D-2,
   * same class as R10). The pending value wins until the reload confirms it.
   */
  const [pendingPhase, setPendingPhase] = useState<Record<string, Partial<PhaseJSON>>>({});

  const patchPhase = async (phaseId: string, updates: Partial<PhaseJSON>) => {
    setPendingPhase((prev) => ({ ...prev, [phaseId]: { ...prev[phaseId], ...updates } }));
    const ok = await mutate(
      () =>
        fetch(`/api/v1/projects/${project.id}/phases/${phaseId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }),
      "Gespeichert",
      "Speichern fehlgeschlagen"
    );
    setPendingPhase((prev) => {
      const next = { ...prev };
      delete next[phaseId];
      return next;
    });
    if (!ok) await load();
  };

  /** The value to render: pending edit first, server value second. */
  const shownPhase = (p: PhaseJSON): PhaseJSON => ({ ...p, ...(pendingPhase[p.id] ?? {}) });

  const deletePhase = (phaseId: string) => {
    if (!window.confirm("Arbeitsbereich löschen? Die Aufgaben bleiben im Projekt, verlieren aber ihren Bereich.")) return;
    mutate(
      () => fetch(`/api/v1/projects/${project.id}/phases/${phaseId}`, { method: "DELETE" }),
      "Arbeitsbereich gelöscht",
      "Löschen fehlgeschlagen"
    );
  };

  const movePhase = (index: number, dir: -1 | 1) => {
    const next = [...phases];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPhases(next); // optimistic
    // reloadOnError: without it a rejected reorder leaves the optimistic order
    // on screen, so the UI shows an order the server does not have (W12).
    mutate(
      () =>
        fetch(`/api/v1/projects/${project.id}/phases/reorder`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedPhaseIds: next.map((p) => p.id) }),
        }),
      "Reihenfolge gespeichert",
      "Reihenfolge konnte nicht gespeichert werden",
      { reloadOnError: true }
    );
  };

  const addMilestone = async () => {
    const ok = await mutate(
      () =>
        fetch(`/api/v1/projects/${project.id}/milestones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newMilestone.trim() }),
        }),
      "Meilenstein angelegt",
      "Meilenstein konnte nicht angelegt werden"
    );
    if (ok) setNewMilestone("");
  };

  const [pendingMilestone, setPendingMilestone] = useState<Record<string, Partial<MilestoneJSON>>>({});

  const patchMilestone = async (milestoneId: string, updates: Partial<MilestoneJSON>) => {
    setPendingMilestone((prev) => ({ ...prev, [milestoneId]: { ...prev[milestoneId], ...updates } }));
    const ok = await mutate(
      () =>
        fetch(`/api/v1/projects/${project.id}/milestones/${milestoneId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }),
      "Gespeichert",
      "Speichern fehlgeschlagen"
    );
    setPendingMilestone((prev) => {
      const next = { ...prev };
      delete next[milestoneId];
      return next;
    });
    if (!ok) await load();
  };

  /** The value to render: pending edit first, server value second. */
  const shownMilestone = (m: MilestoneJSON): MilestoneJSON => ({ ...m, ...(pendingMilestone[m.id] ?? {}) });

  const deleteMilestone = (milestoneId: string) =>
    mutate(
      () => fetch(`/api/v1/projects/${project.id}/milestones/${milestoneId}`, { method: "DELETE" }),
      "Meilenstein gelöscht",
      "Löschen fehlgeschlagen"
    );

  const saveScope = (field: "scopeIn" | "scopeOut", value: string) =>
    mutate(
      () =>
        fetch(`/api/v1/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            [field]: value
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
          }),
        }),
      "Scope gespeichert",
      "Scope konnte nicht gespeichert werden"
    );

  if (loading && phases.length === 0 && milestones.length === 0) return <LoadingLine />;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <SectionCard title="Arbeitsbereiche" subtitle={`${phases.length} Phasen`}>
        {phases.length === 0 ? (
          <EmptyState title="Noch kein Arbeitsbereich" hint="Ein Arbeitsbereich bündelt die Aufgaben eines Projektabschnitts." />
        ) : (
          <div className="flex flex-col gap-2">
            {phases.map((raw, i) => {
              const ph = shownPhase(raw);
              return (
              <div key={ph.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputClass} min-w-0 flex-1`}
                    defaultValue={ph.name}
                    onBlur={(e) => e.target.value !== ph.name && patchPhase(ph.id, { name: e.target.value })}
                  />
                  <select
                    className={inputClass}
                    value={ph.status}
                    disabled={busy}
                    onChange={(e) => patchPhase(ph.id, { status: e.target.value as PhaseJSON["status"] })}
                    aria-label="Status"
                  >
                    {PHASE_STATUS.map((s) => (
                      <option key={s} value={s}>
                        {PHASE_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <div className="flex shrink-0 items-center">
                    <button
                      type="button"
                      onClick={() => movePhase(i, -1)}
                      disabled={i === 0 || busy}
                      aria-label="Nach oben"
                      className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronUp className="h-[13px] w-[13px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePhase(i, 1)}
                      disabled={i === phases.length - 1 || busy}
                      aria-label="Nach unten"
                      className="ml-1 rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronDown className="h-[13px] w-[13px]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePhase(ph.id)}
                      aria-label="Arbeitsbereich löschen"
                      className="ml-1 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-[13px] w-[13px]" />
                    </button>
                  </div>
                </div>

                <textarea
                  rows={2}
                  className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25"
                  defaultValue={ph.description ?? ""}
                  placeholder="Beschreibung (optional)"
                  onBlur={(e) =>
                    e.target.value !== (ph.description ?? "") && patchPhase(ph.id, { description: e.target.value || null })
                  }
                />

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
                    Start
                    {/* toDateInputValue, never .slice(0, 10): the value is a
                        full UTC ISO string and the slice shows the previous
                        day for half the year — which this very onBlur would
                        then write back, losing a day per visit (defect W4).
                        The dirty check is the second half of that fix. */}
                    <input
                      type="date"
                      className={inputClass}
                      defaultValue={toDateInputValue(ph.startDate)}
                      onBlur={(e) => {
                        const next = e.target.value || null;
                        if (next === (toDateInputValue(ph.startDate) || null)) return;
                        patchPhase(ph.id, { startDate: next });
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
                    Fällig
                    <input
                      type="date"
                      className={inputClass}
                      defaultValue={toDateInputValue(ph.dueDate)}
                      onBlur={(e) => {
                        const next = e.target.value || null;
                        if (next === (toDateInputValue(ph.dueDate) || null)) return;
                        patchPhase(ph.id, { dueDate: next });
                      }}
                    />
                  </label>
                  <PhaseStatusChip status={ph.status} />
                </div>

                <div className="mt-2 flex items-center gap-3">
                  <ProgressBar value={ph.progressPct} height={5} className="flex-1" />
                  <span className="k-mono shrink-0 text-[11px] tabular-nums" style={{ color: "var(--muted-foreground)" }}>
                    {ph.doneTasks}/{ph.totalTasks}
                  </span>
                </div>
              </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <input
            className={`${inputClass} flex-1`}
            value={newPhase}
            onChange={(e) => setNewPhase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newPhase.trim()) addPhase();
            }}
            placeholder="Weitere Phase hinzufügen…"
          />
          <button
            type="button"
            onClick={addPhase}
            disabled={!newPhase.trim() || busy}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-40"
            style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
          >
            <Plus className="h-[13px] w-[13px]" />
            Phase
          </button>
        </div>
      </SectionCard>

      <div className="flex min-w-0 flex-col gap-4">
        <SectionCard title="Meilensteine" subtitle={`${milestones.length} gesamt`}>
          {milestones.length === 0 ? (
            <EmptyState title="Keine Meilensteine" hint="Meilensteine sind bewusst unabhängig von Phasen." />
          ) : (
            <div className="flex flex-col gap-2">
              {milestones.map((raw, i) => {
                const m = shownMilestone(raw);
                return (
                <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2.5">
                  <span
                    className="k-mono inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-[11px]"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {i + 1}
                  </span>
                  <input
                    className={`${inputClass} min-w-0 flex-1`}
                    defaultValue={m.name}
                    onBlur={(e) => e.target.value !== m.name && patchMilestone(m.id, { name: e.target.value })}
                  />
                  <input
                    type="date"
                    className={inputClass}
                    defaultValue={toDateInputValue(m.dueDate)}
                    onBlur={(e) => {
                      const next = e.target.value || null;
                      if (next === (toDateInputValue(m.dueDate) || null)) return;
                      patchMilestone(m.id, { dueDate: next });
                    }}
                  />
                  <select
                    className={inputClass}
                    value={m.status}
                    disabled={busy}
                    onChange={(e) => patchMilestone(m.id, { status: e.target.value as MilestoneJSON["status"] })}
                    aria-label="Status"
                  >
                    {MILESTONE_STATUS.map((s) => (
                      <option key={s} value={s}>
                        {MILESTONE_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputClass}
                    value={m.phaseId ?? ""}
                    disabled={busy}
                    onChange={(e) => patchMilestone(m.id, { phaseId: e.target.value || null })}
                    aria-label="Phase"
                  >
                    <option value="">Ohne Phase</option>
                    {phases.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <MilestoneStatusChip status={m.status} />
                  <button
                    type="button"
                    onClick={() => deleteMilestone(m.id)}
                    aria-label="Meilenstein löschen"
                    className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-[13px] w-[13px]" />
                  </button>
                </div>
                );
              })}
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <input
              className={`${inputClass} flex-1`}
              value={newMilestone}
              onChange={(e) => setNewMilestone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newMilestone.trim()) addMilestone();
              }}
              placeholder="Meilenstein hinzufügen…"
            />
            <button
              type="button"
              onClick={addMilestone}
              disabled={!newMilestone.trim() || busy}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-40"
              style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
            >
              <Plus className="h-[13px] w-[13px]" />
              Meilenstein
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Scope" subtitle="Je Zeile ein Punkt · speichert beim Verlassen des Feldes">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                Im Projekt enthalten
              </span>
              <textarea
                rows={5}
                className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground outline-none focus:border-foreground/25"
                defaultValue={project.scopeIn.join("\n")}
                onBlur={(e) => saveScope("scopeIn", e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                Nicht im Projekt enthalten
              </span>
              <textarea
                rows={4}
                className="w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground outline-none focus:border-foreground/25"
                defaultValue={project.scopeOut.join("\n")}
                onBlur={(e) => saveScope("scopeOut", e.target.value)}
              />
            </label>
          </div>
          <p className="mt-2 text-[11.5px]" style={{ color: "var(--muted-foreground)" }}>
            Zuletzt geändert: {formatDateDE(project.updatedAt)}
          </p>
        </SectionCard>
      </div>
    </div>
  );
}
