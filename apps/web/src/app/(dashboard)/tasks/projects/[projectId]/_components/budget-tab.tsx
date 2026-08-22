"use client";

// Budget tab. Money is integer cents everywhere; the form takes euros and
// converts once, so no float ever reaches the API.
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { BudgetSummaryJSON, ProjectJSON } from "@/lib/work-types";
import { SectionCard } from "@/components/work/section-card";
import { ProgressBar } from "@/components/work/progress-bar";
import { StatusChip } from "@/components/work/status-chip";
import { EmptyState, LoadingLine } from "@/components/work/empty-state";
import { formatDateDE, formatEURCents, readApiError } from "@/lib/work-ui";

const inputClass =
  "h-8 rounded-lg border border-border bg-background px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/25";

function eurosToCents(value: string): number | null {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const n = Number(normalized);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export function BudgetTab({ project, reload }: { project: ProjectJSON; reload: () => Promise<void> }) {
  const [budget, setBudget] = useState<BudgetSummaryJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"ist" | "plan">("ist");
  const [bookedAt, setBookedAt] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/budget`, { cache: "no-store" });
      if (res.ok) setBudget((((await res.json())?.data ?? null) as BudgetSummaryJSON | null));
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function addEntry() {
    const cents = eurosToCents(amount);
    if (!label.trim() || cents == null) {
      toast.error("Bezeichnung und Betrag sind Pflicht");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          amountCents: cents,
          kind,
          bookedAt: bookedAt || null,
        }),
      });
      // Only clear the form on success (defect R13).
      if (!res.ok) throw new Error(await readApiError(res, "Buchung konnte nicht angelegt werden"));
      toast.success("Buchung angelegt");
      setLabel("");
      setAmount("");
      setBookedAt("");
      await load();
      await reload();
    } catch (err) {
      toast.error("Buchung konnte nicht angelegt werden", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function deleteEntry(entryId: string) {
    const res = await fetch(`/api/v1/projects/${project.id}/budget/${entryId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Löschen fehlgeschlagen", { description: await readApiError(res, "") });
      return;
    }
    await load();
    await reload();
  }

  async function saveFrame(value: string) {
    const cents = eurosToCents(value);
    const res = await fetch(`/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetPlannedCents: cents }),
    });
    if (!res.ok) {
      toast.error("Budgetrahmen konnte nicht gespeichert werden", {
        description: await readApiError(res, ""),
      });
      return;
    }
    toast.success("Budgetrahmen gespeichert");
    await load();
    await reload();
  }

  if (loading && !budget) return <LoadingLine />;

  const planned = budget?.plannedCents ?? null;
  const spent = budget?.spentCents ?? 0;
  const pct = budget?.pct ?? null;
  const remaining = planned == null ? null : planned - spent;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <SectionCard title="Budgetrahmen">
          <label className="flex flex-col gap-1.5">
            <span className="k-label" style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
              Rahmen in EUR
            </span>
            <input
              className={inputClass}
              defaultValue={planned == null ? "" : String(planned / 100)}
              placeholder="z. B. 5000 — leer = kein Budget"
              onBlur={(e) => saveFrame(e.target.value)}
            />
          </label>

          <div className="mt-4 flex flex-col gap-2">
            <div className="flex items-baseline justify-between text-[13px]">
              <span style={{ color: "var(--muted-foreground)" }}>Verbraucht (Ist)</span>
              <span style={{ color: "var(--foreground)" }}>{formatEURCents(spent)}</span>
            </div>
            <div className="flex items-baseline justify-between text-[13px]">
              <span style={{ color: "var(--muted-foreground)" }}>Rahmen</span>
              <span style={{ color: "var(--foreground)" }}>{formatEURCents(planned)}</span>
            </div>
            <div className="flex items-baseline justify-between text-[13px]">
              <span style={{ color: "var(--muted-foreground)" }}>Rest</span>
              <span style={{ color: remaining != null && remaining < 0 ? "var(--danger)" : "var(--foreground)" }}>
                {formatEURCents(remaining)}
              </span>
            </div>
            <div className="flex items-baseline justify-between text-[13px]">
              <span style={{ color: "var(--muted-foreground)" }}>Aufschlüsselung (Plan)</span>
              <span style={{ color: "var(--foreground)" }}>{formatEURCents(budget?.plannedBreakdownCents ?? 0)}</span>
            </div>
            {pct == null ? (
              <p className="text-[12px]" style={{ color: "var(--muted-foreground)" }}>
                Ohne Rahmen wird kein Prozentwert angezeigt.
              </p>
            ) : (
              <ProgressBar
                value={Math.min(100, pct)}
                showValue
                tone={pct > 100 ? "danger" : pct > 80 ? "warn" : "ok"}
              />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Neue Buchung">
          <div className="flex flex-col gap-2">
            <input
              className={inputClass}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Bezeichnung, z. B. Agenturrechnung"
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                className={inputClass}
                style={{ width: 130 }}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Betrag EUR"
                inputMode="decimal"
              />
              <select
                className={inputClass}
                value={kind}
                onChange={(e) => setKind(e.target.value as "ist" | "plan")}
                aria-label="Art"
              >
                <option value="ist">Ist (zählt zum Verbrauch)</option>
                <option value="plan">Plan (nur Aufschlüsselung)</option>
              </select>
              <input
                type="date"
                className={inputClass}
                value={bookedAt}
                onChange={(e) => setBookedAt(e.target.value)}
                aria-label="Buchungsdatum"
              />
              <button
                type="button"
                onClick={addEntry}
                disabled={busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium disabled:opacity-50"
                style={{ background: "var(--kottke-accent)", color: "var(--accent-ink)" }}
              >
                <Plus className="h-[13px] w-[13px]" />
                Buchen
              </button>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Buchungen" subtitle={`${budget?.entries.length ?? 0} Einträge`}>
        {(budget?.entries.length ?? 0) === 0 ? (
          <EmptyState title="Noch keine Buchungen" hint="Ist-Buchungen füllen die Budget-Kachel, Plan-Zeilen gliedern nur den Rahmen." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {["Bezeichnung", "Art", "Datum", "Betrag", ""].map((h) => (
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
                {budget!.entries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-2 py-2" style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground)" }}>
                      {e.label}
                    </td>
                    <td className="px-2 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
                      <StatusChip tone={e.kind === "ist" ? "accent" : "neutral"}>
                        {e.kind === "ist" ? "Ist" : "Plan"}
                      </StatusChip>
                    </td>
                    <td
                      className="whitespace-nowrap px-2 py-2"
                      style={{ borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)" }}
                    >
                      {formatDateDE(e.bookedAt ?? e.createdAt)}
                    </td>
                    <td
                      className="whitespace-nowrap px-2 py-2 text-right tabular-nums"
                      style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground)" }}
                    >
                      {formatEURCents(e.amountCents)}
                    </td>
                    <td className="px-2 py-2 text-right" style={{ borderBottom: "1px solid var(--border)" }}>
                      <button
                        type="button"
                        onClick={() => deleteEntry(e.id)}
                        aria-label="Buchung löschen"
                        className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-[13px] w-[13px]" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
