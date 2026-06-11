"use client";

// Sprint-Bar — a compact command strip above the Aufgaben board (Scrumban).
// One dense line: sprint identity + day counter + inline progress + a
// burndown spark + the actions. A second line carries the Sprintziel. Daily
// move jobs stay in pure flow on the board below and never need a sprint.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  Trophy,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
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
      if (!res.ok) {
        toast.error("Sprints konnten nicht geladen werden", { id: "sprints-load" });
        return;
      }
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
      toast.error("Sprints konnten nicht geladen werden", { id: "sprints-load" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

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
        toast.error("Sprint konnte nicht gestartet werden", {
          description: err?.error?.message,
        });
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
      } else {
        const err = await res.json().catch(() => null);
        toast.error("Sprint konnte nicht abgeschlossen werden", {
          description: err?.error?.message,
        });
        return;
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
      const res = await fetch(`/api/v1/sprints/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Sprint konnte nicht gelöscht werden");
        return;
      }
      refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loading && sprints.length === 0) {
    return (
      <div
        className="px-9 py-2 text-xs"
        style={{
          color: "var(--ink-muted)",
          borderBottom: "1px solid var(--line, #e7e2d9)",
        }}
      >
        Lade Sprints…
      </div>
    );
  }

  return (
    <div
      className="px-9 py-2.5"
      style={{ borderBottom: "1px solid var(--line, #e7e2d9)" }}
    >
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
        <div className="mt-2 flex flex-wrap items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs">
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

// ─── Active sprint: one dense line + goal subtitle ──────────────────────

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
  // Treat 0 / unset capacity as "not set" so we never render "Kapazitaet 0".
  const cap = sprint.capacityPoints && sprint.capacityPoints > 0 ? sprint.capacityPoints : null;
  const denom = cap ?? m.committedPoints;
  const pct = denom > 0 ? Math.min(100, Math.round((m.completedPoints / denom) * 100)) : 0;

  return (
    <div className="space-y-1">
      {/* Line 1 — identity · progress · burndown · actions */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--kottke-accent,#c2410c)]/10 px-2 py-0.5 font-medium text-[var(--kottke-accent,#c2410c)]">
          <Rocket className="h-3 w-3" /> {sprint.name}
        </span>
        {sprint.daysTotal != null && (
          <span className="text-muted-foreground">
            Tag {sprint.daysElapsed}/{sprint.daysTotal}
            {sprint.daysRemaining === 0
              ? " · letzter Tag"
              : ` · noch ${sprint.daysRemaining} Tage`}
          </span>
        )}

        {/* Inline progress meter */}
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums">
            <span className="font-semibold text-foreground">
              {m.completedPoints}
            </span>
            /{m.committedPoints}&nbsp;P
          </span>
          <span className="h-1.5 w-20 overflow-hidden rounded bg-muted/50">
            <span
              className="block h-full rounded bg-emerald-500"
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="tabular-nums text-muted-foreground">
            {m.doneTasks}/{m.totalTasks}&nbsp;✓
          </span>
          {cap && (
            <span className="text-muted-foreground">· Kap. {cap}</span>
          )}
        </span>

        {/* Burndown spark + remaining */}
        {velocity && velocity.burndown.length > 1 && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Burndown points={velocity.burndown} />
            <span>noch&nbsp;{m.remainingPoints}</span>
          </span>
        )}
        {velocity?.forecast && (
          <span
            className="text-muted-foreground"
            title={`Schnitt aus ${velocity.forecast.count} Sprints`}
          >
            · Velocity ~{velocity.forecast.avg}
          </span>
        )}

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={onPlan}
            disabled={busy}
          >
            <Flag className="mr-1 h-3.5 w-3.5" /> Sprint planen
          </Button>
          <ActionsMenu busy={busy} onEdit={onEdit} onClose={onClose} />
        </div>
      </div>

      {/* Line 2 — Sprintziel (the always-visible commitment) */}
      <div className="flex items-center gap-1.5 text-xs">
        <Target className="h-3.5 w-3.5 shrink-0 text-[var(--kottke-accent,#c2410c)]" />
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Ziel
        </span>
        {sprint.goal ? (
          <span className="truncate">{sprint.goal}</span>
        ) : (
          <button
            onClick={onEdit}
            className="italic text-muted-foreground hover:text-foreground"
          >
            Kein Ziel gesetzt. Jetzt festlegen.
          </button>
        )}
      </div>
    </div>
  );
}

function ActionsMenu({
  busy,
  onEdit,
  onClose,
}: {
  busy: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted/50 disabled:opacity-50"
        title="Mehr"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-40 rounded-md border border-border bg-popover p-1 text-xs shadow-lg">
          <button
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted/50"
          >
            Sprint bearbeiten
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onClose();
            }}
            className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted/50"
          >
            Sprint abschliessen
          </button>
        </div>
      )}
    </div>
  );
}

// Tiny inline burndown: dashed ideal vs solid actual (up to today).
function Burndown({ points }: { points: BurndownPoint[] }) {
  const W = 84;
  const H = 22;
  const n = points.length;
  const max = Math.max(1, ...points.map((p) => p.ideal), ...points.map((p) => p.remaining));
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - (v / max) * H;
  const idealPath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.ideal).toFixed(1)}`)
    .join(" ");
  const actual = points.filter((p) => !p.isFuture);
  const actualPath = actual
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(points.indexOf(p)).toFixed(1)},${y(p.remaining).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={W} height={H} className="overflow-visible align-middle">
      <path
        d={idealPath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="3 3"
        className="text-muted-foreground/40"
      />
      {actualPath && (
        <path
          d={actualPath}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className="text-emerald-600"
        />
      )}
    </svg>
  );
}

// ─── Empty state (no active sprint) — single compact line ───────────────

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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <Rocket className="h-4 w-4 text-muted-foreground" /> Kein aktiver Sprint
      </span>
      <span className="text-muted-foreground">
        Starte einen Sprint, um Wachstums-Aufgaben zu fokussieren. Der laufende Betrieb laeuft unten weiter.
      </span>

      {planung.map((s) => (
        <span
          key={s.id}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5"
        >
          <span className="font-medium">{s.name}</span>
          <span className="tabular-nums text-muted-foreground">
            {s.metrics.committedPoints} P
          </span>
          <button
            className="inline-flex items-center gap-0.5 text-[var(--kottke-accent,#c2410c)] hover:underline"
            onClick={() => onActivate(s.id)}
            disabled={busy}
          >
            <Rocket className="h-3 w-3" /> Starten
          </button>
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onEditSprint(s)}
            disabled={busy}
          >
            Bearbeiten
          </button>
          <button
            className="text-muted-foreground hover:text-destructive"
            title="Loeschen"
            onClick={() => onDeleteSprint(s.id)}
            disabled={busy}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </span>
      ))}

      <Button
        size="sm"
        className="ml-auto h-7 text-xs"
        onClick={onNew}
        disabled={busy}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Neuer Sprint
      </Button>
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
      let res: Response | null = null;
      if (mode === "create") {
        res = await fetch("/api/v1/sprints", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else if (sprint) {
        res = await fetch(`/api/v1/sprints/${sprint.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (res && !res.ok) {
        const err = await res.json().catch(() => null);
        toast.error("Sprint konnte nicht gespeichert werden", {
          description: err?.error?.message,
        });
        return;
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
