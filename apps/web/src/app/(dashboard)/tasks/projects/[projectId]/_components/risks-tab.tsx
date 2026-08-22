"use client";

// Risks tab. Severity and status are free-text columns normalised in the
// service; the UI only offers the allowed values.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ProjectJSON, RiskJSON } from "@/lib/work-types";
import { SectionCard } from "@/components/work/section-card";
import { RiskChip, RiskStatusChip } from "@/components/work/status-chip";
import { FilterChips } from "@/components/work/filter-chips";
import { EmptyState, ErrorLine, LoadingLine } from "@/components/work/empty-state";
import { RISK_SEVERITY, RISK_STATUS } from "@/lib/project-constants";
import { formatDateDE, readApiError } from "@/lib/work-ui";

const inputClass =
  "h-8 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25";

const SEVERITY_LABEL: Record<string, string> = { niedrig: "Niedrig", mittel: "Mittel", hoch: "Hoch" };
const STATUS_LABEL: Record<string, string> = { offen: "Offen", beobachtet: "Beobachtet", geschlossen: "Geschlossen" };

type RiskFilter = "alle" | "offen" | "beobachtet" | "geschlossen";

export function RisksTab({ project, reload }: { project: ProjectJSON; reload: () => Promise<void> }) {
  const [risks, setRisks] = useState<RiskJSON[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<RiskFilter>("alle");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("mittel");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/risks`, { cache: "no-store" });
      if (res.ok) {
        setRisks((((await res.json())?.data ?? []) as RiskJSON[]));
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => (filter === "alle" ? risks : risks.filter((r) => r.status === filter)),
    [risks, filter]
  );

  /** true on success — callers only clear their input then (defect R13). */
  async function mutate(fn: () => Promise<Response>, okMsg: string, errMsg: string): Promise<boolean> {
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
      return false;
    } finally {
      setBusy(false);
    }
  }

  const addRisk = async () => {
    if (!title.trim()) return;
    const ok = await mutate(
      () =>
        fetch(`/api/v1/projects/${project.id}/risks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), severity }),
        }),
      "Risiko angelegt",
      "Risiko konnte nicht angelegt werden"
    );
    if (ok) setTitle("");
  };

  /**
   * Optimistic: a PATCH plus two reloads takes ~700 ms, and a select bound
   * straight to the server value snaps back to the old one for that whole
   * window — users read that as "it didn't take" and change it again
   * (defect R10). The pending value wins until the reload confirms it.
   */
  const [pendingRisk, setPendingRisk] = useState<Record<string, Partial<RiskJSON>>>({});

  const patchRisk = async (riskId: string, updates: Partial<RiskJSON>) => {
    setPendingRisk((prev) => ({ ...prev, [riskId]: { ...prev[riskId], ...updates } }));
    const ok = await mutate(
      () =>
        fetch(`/api/v1/projects/${project.id}/risks/${riskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }),
      "Gespeichert",
      "Änderung konnte nicht gespeichert werden"
    );
    setPendingRisk((prev) => {
      const next = { ...prev };
      delete next[riskId];
      return next;
    });
    if (!ok) await load();
  };

  /** The value to render: pending edit first, server value second. */
  const shown = (r: RiskJSON): RiskJSON => ({ ...r, ...(pendingRisk[r.id] ?? {}) });

  const deleteRisk = (riskId: string) =>
    mutate(
      () => fetch(`/api/v1/projects/${project.id}/risks/${riskId}`, { method: "DELETE" }),
      "Risiko gelöscht",
      "Risiko konnte nicht gelöscht werden"
    );

  if (loading && risks.length === 0) return <LoadingLine />;

  return (
    <SectionCard
      title="Risiken"
      subtitle={`${project.stats.openRisks} offen · ${project.stats.risksBySeverity.hoch ?? 0} davon hoch`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <FilterChips
          options={[
            { value: "alle" as RiskFilter, label: "Alle", count: risks.length },
            ...RISK_STATUS.map((s) => ({
              value: s as RiskFilter,
              label: STATUS_LABEL[s],
              count: risks.filter((r) => r.status === s).length,
            })),
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} min-w-[220px] flex-1`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addRisk();
          }}
          placeholder="Neues Risiko in einem Satz…"
        />
        <select className={inputClass} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Schwere">
          {RISK_SEVERITY.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addRisk}
          disabled={!title.trim() || busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-40"
          style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
        >
          <Plus className="h-[13px] w-[13px]" />
          Risiko
        </button>
      </div>

      {failed && risks.length === 0 ? (
        <ErrorLine onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState title="Keine Risiken" hint="Was kann das Projekt aus der Spur werfen?" />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((raw) => {
            const r = shown(raw);
            return (
            <div key={r.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputClass} min-w-0 flex-1`}
                  defaultValue={r.title}
                  onBlur={(e) => e.target.value !== r.title && patchRisk(r.id, { title: e.target.value })}
                />
                <select
                  className={inputClass}
                  value={r.severity}
                  disabled={busy}
                  onChange={(e) => patchRisk(r.id, { severity: e.target.value as RiskJSON["severity"] })}
                  aria-label="Schwere"
                >
                  {RISK_SEVERITY.map((s) => (
                    <option key={s} value={s}>
                      {SEVERITY_LABEL[s]}
                    </option>
                  ))}
                </select>
                <select
                  className={inputClass}
                  value={r.status}
                  disabled={busy}
                  onChange={(e) => patchRisk(r.id, { status: e.target.value as RiskJSON["status"] })}
                  aria-label="Status"
                >
                  {RISK_STATUS.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => deleteRisk(r.id)}
                  aria-label="Risiko löschen"
                  className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-[13px] w-[13px]" />
                </button>
              </div>

              <textarea
                rows={2}
                className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-2 py-1.5 text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25"
                defaultValue={r.mitigation ?? ""}
                placeholder="Gegenmassnahme"
                onBlur={(e) =>
                  e.target.value !== (r.mitigation ?? "") && patchRisk(r.id, { mitigation: e.target.value || null })
                }
              />

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <RiskChip severity={r.severity} />
                <RiskStatusChip status={r.status} />
                <span className="k-mono text-[11px]" style={{ color: "var(--muted-foreground)" }}>
                  erfasst {formatDateDE(r.createdAt)}
                </span>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
