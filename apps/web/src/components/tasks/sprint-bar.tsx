"use client";

// Sprint-Bar — the thin Sprint layer that sits above the Aufgaben board.
// Shows the active sprint's goal (the highest-leverage adoption nudge), a
// committed/done progress bar, days remaining, a derived burndown spark,
// and a velocity forecast from past sprints. When no sprint is active it
// offers the Planung sprints to start, or creating a new one.
//
// Design: a Scrumban layer for the office's grow-the-company work. Daily
// move jobs stay in pure flow on the board below and never need a sprint.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Target,
  Rocket,
  Flag,
  CalendarRange,
  Plus,
  Trophy,
  Trash2,
} from "lucide-react";
import { SprintPlanning } from "./sprint-planning";

interface ApiSprintMetrics {
  committedPoints: number;
  completedPoints: number;
  remainingPoints: number;
  totalTasks: number;
  doneTasks: number;
}
interface ApiSprint {
  id: string;
  name: string;
  goal: string | null;
  state: string;
  startDate: string | null;
  endDate: string | null;
  capacityPoints: number | null;
  createdAt: string;
  completedAt: string | null;
  metrics: ApiSprintMetrics;
  daysTotal: number | null;
  daysElapsed: number | null;
  daysRemaining: number | null;
}
interface BurndownPoint {
  date: string;
  ideal: number;
  remaining: number;
  isFuture: boolean;
}
interface ApiVelocity {
  sprint: ApiSprint;
  burndown: BurndownPoint[];
  history: { id: string; name: string; completedPoints: number }[];
  forecast: { avg: number; min: number; max: number; count: number } | null;
}
interface CloseSummary {
  committedPoints: number;
  completedPoints: number;
  doneTasks: number;
  carriedTasks: number;
}

interface SprintBarProps {
  refreshKey?: number;
  onMutate?: () => void;
}

export function SprintBar({ refreshKey, onMutate }: SprintBarProps) {
  const [sprints, setSprints] = useState<ApiSprint[]>([]);
  const [velocity, setVelocity] = useState<ApiVelocity | null>(null);
  const [loading, setLoading] = useState(true);
  const [planningOpen, setPlanningOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formSprint, setFormSprint] = useState<ApiSprint | null>(null);
  const [closeSummary, setCloseSummary] = useState<CloseSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sprints", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      const list = (json?.data?.sprints ?? []) as ApiSprint[];
      setSprints(list);
      const active = list.find((s) => s.state === "aktiv");
      if (active) {
        const vRes = await fetch(`/api/v1/sprints/${active.id}/velocity`, {
          cache: "no-store",
        });
        setVelocity(vRes.ok ? ((await vRes.json()).data as ApiVelocity) : null);
      } else {
        setVelocity(null);
      }
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  // Bubble mutations to the page so the Kanban refreshes too; fall back to a
  // local reload when used standalone.
  const refresh = useCallback(() => {
    if (onMutate) onMutate();
    else load();
  }, [onMutate, load]);

  const active = useMemo(
    () => sprints.find((s) => s.state === "aktiv") ?? null,
    [sprints]
  );
  const planung = useMemo(
    () => sprints.filter((s) => s.state === "planung"),
    [sprints]
  );

  async function activate(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/sprints/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "aktivieren" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        alert(err?.error?.message ?? "Sprint konnte nicht gestartet werden.");
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function closeActive(id: string) {
    if (
      !confirm(
        "Sprint abschliessen? Nicht erledigte Aufgaben wandern zurueck ins Produkt-Backlog."
      )
    )
      return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/sprints/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "abschliessen" }),
      });
      if (res.ok) {
        const json = await res.json();
        setCloseSummary((json?.data?.summary as CloseSummary) ?? null);
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deleteSprint(id: string) {
    if (!confirm("Sprint in Planung loeschen?")) return;
    setBusy(true);
    try {
      await fetch(`/api/v1/sprints/${id}`, { method: "DELETE" });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loading && sprints.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/10 p-3 text-xs text-muted-foreground">
        Lade Sprints…
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/10 p-3 sm:p-4">
      {active ? (
        <ActiveSprint
          sprint={active}
          velocity={velocity}
          busy={busy}
          onPlan={() => setPlanningOpen(true)}
          onEdit={() => {
            setFormSprint(active);
            setFormOpen(true);
          }}
          onClose={() => closeActive(active.id)}
        />
      ) : (
        <EmptyState
          planung={planung}
          busy={busy}
          onActivate={activate}
          onEditSprint={(s) => {
            setFormSprint(s);
            setFormOpen(true);
          }}
          onDeleteSprint={deleteSprint}
          onNew={() => {
            setFormSprint(null);
            setFormOpen(true);
          }}
        />
      )}

      {closeSummary && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs">
          <Trophy className="h-4 w-4 text-emerald-600" />
          <span className="font-medium">Sprint-Rueckblick:</span>
          <span>
            {closeSummary.completedPoints} von {closeSummary.committedPoints}{" "}
            Punkten erledigt
          </span>
          <span className="text-muted-foreground">
            {closeSummary.doneTasks} erledigt · {closeSummary.carriedTasks}{" "}
            mitgenommen
          </span>
          <button
            className="ml-auto text-muted-foreground hover:text-foreground"
            onClick={() => setCloseSummary(null)}
          >
            schliessen
          </button>
        </div>
      )}

      {active && (
        <SprintPlanning
          open={planningOpen}
          onOpenChange={setPlanningOpen}
          sprint={active}
          onMutate={refresh}
        />
      )}

      <SprintFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        sprint={formSprint}
        onSaved={refresh}
      />
    </div>
  );
}

// ─── Active sprint view ─────────────────────────────────────────────────

function ActiveSprint({
  sprint,
  velocity,
  busy,
  onPlan,
  onEdit,
  onClose,
}: {
  sprint: ApiSprint;
  velocity: ApiVelocity | null;
  busy: boolean;
  onPlan: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const m = sprint.metrics;
  const denom = sprint.capacityPoints ?? m.committedPoints;
  const pct = denom > 0 ? Math.min(100, Math.round((m.completedPoints / denom) * 100)) : 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--kottke-accent,#c2410c)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--kottke-accent,#c2410c)]">
          <Rocket className="h-3 w-3" /> Aktiver Sprint
        </span>
        <span className="text-sm font-semibold">{sprint.name}</span>
        {sprint.daysTotal != null && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <CalendarRange className="h-3 w-3" />
            Tag {sprint.daysElapsed} von {sprint.daysTotal} ·{" "}
            {sprint.daysRemaining === 0
              ? "letzter Tag"
              : `noch ${sprint.daysRemaining} Tage`}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-xs" onClick={onPlan} disabled={busy}>
            <Flag className="mr-1 h-3.5 w-3.5" /> Sprint planen
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={onEdit} disabled={busy}>
            Bearbeiten
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={onClose} disabled={busy}>
            Abschliessen
          </Button>
        </div>
      </div>

      {/* Sprintziel banner — always visible, the cheapest adoption nudge. */}
      <div className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kottke-accent,#c2410c)]" />
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Sprintziel
          </div>
          {sprint.goal ? (
            <div className="text-sm">{sprint.goal}</div>
          ) : (
            <button onClick={onEdit} className="text-sm italic text-muted-foreground hover:text-foreground">
              Kein Ziel gesetzt. Jetzt ein Satz festlegen.
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* Progress */}
        <div className="min-w-[200px] flex-1">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              <span className="font-semibold text-foreground tabular-nums">
                {m.completedPoints}
              </span>{" "}
              von {m.committedPoints} Punkten erledigt
              {sprint.capacityPoints != null && (
                <span className="ml-1">· Kapazitaet {sprint.capacityPoints}</span>
              )}
            </span>
            <span className="tabular-nums">
              {m.doneTasks}/{m.totalTasks} Aufgaben
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded bg-muted/50">
            <div
              className="h-full rounded bg-emerald-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Burndown spark + forecast */}
        {velocity && velocity.burndown.length > 1 && (
          <div className="flex items-center gap-2">
            <Burndown points={velocity.burndown} />
            <div className="text-[11px] leading-tight text-muted-foreground">
              <div className="font-medium text-foreground">Burndown</div>
              <div>noch {m.remainingPoints} Punkte</div>
            </div>
          </div>
        )}
        {velocity?.forecast && (
          <div className="text-[11px] leading-tight text-muted-foreground">
            <div className="font-medium text-foreground">Velocity</div>
            <div title={`Schnitt aus ${velocity.forecast.count} Sprints`}>
              ~{velocity.forecast.avg} Punkte / Sprint
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Tiny inline burndown: dashed ideal line vs solid actual (up to today).
function Burndown({ points }: { points: BurndownPoint[] }) {
  const W = 132;
  const H = 36;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.ideal), ...points.map((p) => p.remaining));
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - (v / max) * H;
  const idealPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ideal).toFixed(1)}`).join(" ");
  const actual = points.filter((p) => !p.isFuture);
  const actualPath = actual
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(points.indexOf(p)).toFixed(1)},${y(p.remaining).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={W} height={H} className="overflow-visible">
      <path d={idealPath} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 3" className="text-muted-foreground/50" />
      {actualPath && (
        <path d={actualPath} fill="none" stroke="currentColor" strokeWidth={1.75} className="text-emerald-600" />
      )}
    </svg>
  );
}

// ─── Empty state (no active sprint) ─────────────────────────────────────

function EmptyState({
  planung,
  busy,
  onActivate,
  onEditSprint,
  onDeleteSprint,
  onNew,
}: {
  planung: ApiSprint[];
  busy: boolean;
  onActivate: (id: string) => void;
  onEditSprint: (s: ApiSprint) => void;
  onDeleteSprint: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Rocket className="h-4 w-4 text-muted-foreground" /> Kein aktiver Sprint
        </span>
        <span className="text-xs text-muted-foreground">
          Starte einen Sprint, um Wachstums-Aufgaben fuer zwei Wochen zu fokussieren. Der laufende Betrieb bleibt unten im Board.
        </span>
        <Button size="sm" className="ml-auto text-xs" onClick={onNew} disabled={busy}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Neuer Sprint
        </Button>
      </div>

      {planung.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            In Planung
          </div>
          {planung.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs"
            >
              <span className="font-medium">{s.name}</span>
              {s.goal && <span className="truncate text-muted-foreground">{s.goal}</span>}
              <span className="tabular-nums text-muted-foreground">
                {s.metrics.committedPoints} Punkte geplant
              </span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" className="text-xs" onClick={() => onActivate(s.id)} disabled={busy}>
                  <Rocket className="mr-1 h-3 w-3" /> Starten
                </Button>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => onEditSprint(s)} disabled={busy}>
                  Bearbeiten
                </Button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  title="Loeschen"
                  onClick={() => onDeleteSprint(s.id)}
                  disabled={busy}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create / edit sprint dialog ────────────────────────────────────────

function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = date.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 86400000));
}

function toDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function SprintFormDialog({
  open,
  onOpenChange,
  sprint,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprint: ApiSprint | null;
  onSaved: () => void;
}) {
  const mode = sprint ? "edit" : "create";
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [capacity, setCapacity] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (sprint) {
      setName(sprint.name);
      setGoal(sprint.goal ?? "");
      setStartDate(toDateInput(sprint.startDate));
      setEndDate(toDateInput(sprint.endDate));
      setCapacity(sprint.capacityPoints != null ? String(sprint.capacityPoints) : "");
    } else {
      // Default: a 2-week sprint starting today, named by calendar week.
      const today = new Date();
      const end = new Date(today);
      end.setDate(today.getDate() + 13);
      setName(`Sprint KW${isoWeek(today)}`);
      setGoal("");
      setStartDate(toDateInput(today.toISOString()));
      setEndDate(toDateInput(end.toISOString()));
      setCapacity("");
    }
  }, [open, sprint]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        goal: goal.trim() || null,
        startDate: startDate || null,
        endDate: endDate || null,
        capacityPoints: capacity ? Number(capacity) : null,
      };
      if (mode === "create") {
        await fetch("/api/v1/sprints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else if (sprint) {
        await fetch(`/api/v1/sprints/${sprint.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Neuer Sprint" : "Sprint bearbeiten"}</DialogTitle>
          <DialogDescription className="sr-only">
            Name, Ziel, Zeitraum und Kapazitaet des Sprints
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint KW24" className="text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Sprintziel (ein Satz)</label>
            <Input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="z.B. Lead-Antwortzeit unter 1 Stunde bringen"
              className="text-sm"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Start</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Ende</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs text-muted-foreground">Kapazitaet</label>
              <input
                type="number"
                min={0}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="Punkte"
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button size="sm" onClick={save} disabled={!name.trim() || saving}>
            {saving ? "Speichern…" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
