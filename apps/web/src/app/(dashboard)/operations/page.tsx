"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Loader2,
  Truck,
  Users as UsersIcon,
  AlertTriangle,
  Calendar,
  ExternalLink,
  X,
} from "lucide-react";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { cn } from "@/lib/utils";

interface AssignedEmployee {
  assignmentId: string;
  employeeId: string;
  name: string;
  role: string;
  photoBase64: string | null;
}

interface OpsDeal {
  dealId: string;
  dealNumber: string | null;
  name: string;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
  moveFromAddress: string | null;
  moveToAddress: string | null;
  auftragId: string | null;
  transporter: { id: string; title: string; color: string } | null;
  workerCount: number | null;
  timeStart: string | null;
  timeEnd: string | null;
  assignedEmployees: AssignedEmployee[];
}

interface TransporterOption {
  id: string;
  title: string;
  color: string;
}

interface OpsEmployee {
  id: string;
  name: string;
  photoBase64: string | null;
  hourlyRate: string;
}

interface OperationsData {
  deals: OpsDeal[];
  transporterOptions: TransporterOption[];
  allEmployees: OpsEmployee[];
}

const UNSCHEDULED_KEY = "__unscheduled__";

function formatDayHeader(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function OperationsPage() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDealId, setBusyDealId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/operations");
      if (res.ok) {
        const json = await res.json();
        setData(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Group by day
  const grouped = useMemo(() => {
    if (!data) return [] as { dayKey: string; label: string; deals: OpsDeal[] }[];
    const buckets = new Map<string, OpsDeal[]>();
    for (const d of data.deals) {
      const key = d.moveDate ?? UNSCHEDULED_KEY;
      const arr = buckets.get(key) ?? [];
      arr.push(d);
      buckets.set(key, arr);
    }
    const keys = Array.from(buckets.keys()).sort((a, b) => {
      if (a === UNSCHEDULED_KEY) return 1;
      if (b === UNSCHEDULED_KEY) return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({
      dayKey: k,
      label: k === UNSCHEDULED_KEY ? "Ohne Datum" : formatDayHeader(k),
      deals: buckets.get(k)!,
    }));
  }, [data]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const employeeId = String(event.active.id);
      const dealId = event.over?.id ? String(event.over.id) : null;
      if (!dealId || !data) return;

      // Skip if already assigned
      const targetDeal = data.deals.find((d) => d.dealId === dealId);
      if (targetDeal?.assignedEmployees.some((a) => a.employeeId === employeeId)) return;

      setBusyDealId(dealId);
      try {
        await fetch(`/api/v1/deals/${dealId}/employees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employeeId, role: "helper" }),
        });
        await load();
      } finally {
        setBusyDealId(null);
      }
    },
    [data, load]
  );

  const handleUnassign = useCallback(
    async (dealId: string, assignmentId: string) => {
      setBusyDealId(dealId);
      try {
        await fetch(`/api/v1/deals/${dealId}/employees/${assignmentId}`, { method: "DELETE" });
        await load();
      } finally {
        setBusyDealId(null);
      }
    },
    [load]
  );

  const ensureAuftragAndPatch = useCallback(
    async (deal: OpsDeal, patch: Record<string, unknown>) => {
      let auftragId = deal.auftragId;
      if (!auftragId) {
        const res = await fetch(`/api/v1/deals/${deal.dealId}/auftrag`);
        if (res.ok) {
          const json = await res.json();
          auftragId = json.data?.auftrag?.id ?? null;
        }
      }
      if (!auftragId) return;
      await fetch(`/api/v1/objects/auftraege/records/${auftragId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: patch }),
      });
      await load();
    },
    [load]
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Keine Daten verfügbar.</div>;
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full">
        {/* Main column */}
        <div className="flex-1 overflow-auto">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold flex items-center gap-2">
                <Truck className="h-5 w-5" />
                Operations
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                Aktive Aufträge, sortiert nach Umzugstag. Mitarbeiter aus der Seitenleiste auf einen Auftrag ziehen.
              </p>
            </div>
            <div className="text-xs text-muted-foreground">
              {data.deals.length} aktive Auftrag{data.deals.length === 1 ? "" : "e"}
            </div>
          </div>

          <div className="p-6 space-y-8">
            {grouped.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-12">
                Keine offenen Aufträge.
              </div>
            )}
            {grouped.map((g) => (
              <section key={g.dayKey}>
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    {g.label}
                  </h2>
                  <span className="text-xs text-muted-foreground">· {g.deals.length} Auftrag{g.deals.length === 1 ? "" : "e"}</span>
                </div>
                <div className="space-y-3">
                  {g.deals.map((deal) => (
                    <OpsCard
                      key={deal.dealId}
                      deal={deal}
                      transporterOptions={data.transporterOptions}
                      busy={busyDealId === deal.dealId}
                      onUnassign={(asgId) => handleUnassign(deal.dealId, asgId)}
                      onPatchAuftrag={(patch) => ensureAuftragAndPatch(deal, patch)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        {/* Right sidebar: draggable employees */}
        <aside className="w-64 shrink-0 border-l border-border bg-muted/20 overflow-auto">
          <div className="sticky top-0 bg-muted/40 backdrop-blur px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <UsersIcon className="h-4 w-4" />
              Mitarbeiter
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Auf einen Auftrag ziehen, um zuzuweisen.
            </p>
          </div>
          <div className="p-3 space-y-1.5">
            {data.allEmployees.length === 0 && (
              <p className="text-xs text-muted-foreground p-2">
                Noch keine Mitarbeiter angelegt.
              </p>
            )}
            {data.allEmployees.map((emp) => (
              <DraggableEmployee key={emp.id} employee={emp} />
            ))}
          </div>
        </aside>
      </div>
    </DndContext>
  );
}

// ─── Draggable employee chip (sidebar) ──────────────────────────────

function DraggableEmployee({ employee }: { employee: OpsEmployee }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: employee.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        "flex items-center gap-2 rounded-md border border-transparent bg-background px-2 py-1.5 text-sm cursor-grab active:cursor-grabbing hover:border-border transition",
        isDragging && "opacity-60 shadow-lg ring-1 ring-primary"
      )}
    >
      <EmployeeAvatar name={employee.name} photoBase64={employee.photoBase64} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm">{employee.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {Number(employee.hourlyRate).toFixed(2)} €/h
        </div>
      </div>
    </div>
  );
}

// ─── Deal card with droppable target ─────────────────────────────

function OpsCard({
  deal,
  transporterOptions,
  busy,
  onUnassign,
  onPatchAuftrag,
}: {
  deal: OpsDeal;
  transporterOptions: TransporterOption[];
  busy: boolean;
  onUnassign: (assignmentId: string) => void;
  onPatchAuftrag: (patch: Record<string, unknown>) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: deal.dealId });
  const [editingWorkers, setEditingWorkers] = useState(false);
  const [workersDraft, setWorkersDraft] = useState(deal.workerCount?.toString() ?? "");

  const assignedCount = deal.assignedEmployees.length;
  const needed = deal.workerCount ?? 0;
  const understaffed = needed > 0 && assignedCount < needed;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg border bg-background p-4 transition shadow-sm",
        isOver ? "border-primary ring-2 ring-primary/30" : "border-border",
        busy && "opacity-60"
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {deal.dealNumber && <span className="font-mono">{deal.dealNumber}</span>}
            {deal.stage && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                style={{ backgroundColor: deal.stage.color + "33", color: deal.stage.color }}
              >
                {deal.stage.title}
              </span>
            )}
            {deal.timeStart && (
              <span>
                {formatTime(deal.timeStart)}
                {deal.timeEnd ? ` – ${formatTime(deal.timeEnd)}` : ""}
              </span>
            )}
          </div>
          <Link
            href={`/objects/deals/${deal.dealId}`}
            className="text-base font-semibold hover:underline inline-flex items-center gap-1"
          >
            {deal.name}
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </Link>
          {(deal.moveFromAddress || deal.moveToAddress) && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {deal.moveFromAddress || "—"} → {deal.moveToAddress || "—"}
            </div>
          )}
        </div>
      </div>

      {/* Operations bar: transporter + people needed/assigned */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        {/* Transporter dropdown */}
        <div className="flex items-center gap-1.5 text-sm">
          <Truck className="h-3.5 w-3.5 text-muted-foreground" />
          <select
            value={deal.transporter?.id ?? ""}
            onChange={(e) => {
              const optId = e.target.value || null;
              onPatchAuftrag({ transporter: optId });
            }}
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
          >
            <option value="">— Transporter wählen —</option>
            {transporterOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </div>

        {/* Needed / assigned */}
        <div
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-sm",
            understaffed ? "bg-red-500/15 text-red-700" : "bg-emerald-500/10 text-emerald-700"
          )}
        >
          <UsersIcon className="h-3.5 w-3.5" />
          {editingWorkers ? (
            <input
              autoFocus
              type="number"
              min={0}
              value={workersDraft}
              onChange={(e) => setWorkersDraft(e.target.value)}
              onBlur={() => {
                setEditingWorkers(false);
                const n = workersDraft === "" ? null : Number(workersDraft);
                if (n !== deal.workerCount) onPatchAuftrag({ worker_count: n });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setWorkersDraft(deal.workerCount?.toString() ?? "");
                  setEditingWorkers(false);
                }
              }}
              className="w-12 rounded border border-input bg-background px-1 text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setWorkersDraft(deal.workerCount?.toString() ?? "");
                setEditingWorkers(true);
              }}
              className="hover:underline"
              title="Anzahl benötigter Helfer"
            >
              {assignedCount} / {needed || "?"}
            </button>
          )}
          {understaffed && (
            <>
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-xs">{needed - assignedCount} fehlen</span>
            </>
          )}
        </div>
      </div>

      {/* Assigned employee chips */}
      <div className="flex flex-wrap gap-1.5">
        {deal.assignedEmployees.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Niemand zugewiesen — Mitarbeiter aus der Seitenleiste hierhin ziehen.
          </p>
        ) : (
          deal.assignedEmployees.map((emp) => (
            <div
              key={emp.assignmentId}
              className="group flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-sm"
            >
              <EmployeeAvatar name={emp.name} photoBase64={emp.photoBase64} size="xs" />
              <span>{emp.name}</span>
              <button
                type="button"
                onClick={() => onUnassign(emp.assignmentId)}
                className="opacity-50 hover:opacity-100 hover:text-destructive"
                title="Entfernen"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
