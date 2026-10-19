"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  DndContext,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

const MapView = dynamic(
  () => import("@/components/operations/map-view").then((m) => m.MapView),
  { ssr: false, loading: () => <MapLoadingFallback /> }
);

function MapLoadingFallback() {
  return (
    <div
      style={{
        height: "min(70vh, 600px)",
        borderRadius: 14,
        border: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--paper)",
        color: "var(--ink-muted)",
        fontSize: 13,
      }}
    >
      Karte wird geladen …
    </div>
  );
}
import {
  Loader2,
  Truck,
  Users as UsersIcon,
  AlertTriangle,
  Calendar,
  ExternalLink,
  X,
  Plus,
} from "lucide-react";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import {
  UNSCHEDULED_KEY,
  compareByToday,
  groupByDay,
  resolveListAnchor,
} from "@/components/operations/list-anchor";
import { berlinDateString } from "@/lib/berlin-date";
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

function motionBehavior(): ScrollBehavior {
  if (typeof window === "undefined") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function scrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll" || overflow === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Prefer the list pane. Fall back to whichever ancestor actually scrolls (usually <main>). */
function activeScroller(preferred: HTMLElement | null, child: HTMLElement): HTMLElement | null {
  if (preferred && preferred.contains(child) && preferred.scrollHeight > preferred.clientHeight + 1) {
    return preferred;
  }
  return scrollableAncestor(child) ?? preferred;
}

function scrollChildToTop(scroller: HTMLElement, child: HTMLElement, behavior: ScrollBehavior) {
  const top = Math.max(
    0,
    child.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8,
  );
  if (behavior === "auto") scroller.scrollTop = top;
  else scroller.scrollTo({ top, behavior });
}

type OpsView = "list" | "pipeline" | "map";

export default function OperationsPage() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDealId, setBusyDealId] = useState<string | null>(null);
  const [view, setView] = useState<OpsView>("list");
  // Mobile-only state: which deal's "add employee" sheet is open + standalone employee sheet.
  const [addEmployeeForDealId, setAddEmployeeForDealId] = useState<string | null>(null);
  const [employeeSheetOpen, setEmployeeSheetOpen] = useState(false);

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

  // Group by day. Order stays chronological; the list opens on today by scrolling.
  const grouped = useMemo(() => {
    if (!data) return [] as { dayKey: string; label: string; deals: OpsDeal[] }[];
    return groupByDay(data.deals, (deal) => deal.moveDate).map((group) => ({
      dayKey: group.dayKey,
      label: group.dayKey === UNSCHEDULED_KEY ? "Ohne Datum" : formatDayHeader(group.dayKey),
      deals: group.items,
    }));
  }, [data]);

  const today = berlinDateString();
  const anchor = useMemo(
    () => resolveListAnchor(grouped.map((group) => group.dayKey), today),
    [grouped, today],
  );
  const pastJobCount = useMemo(
    () =>
      grouped.reduce(
        (count, group) =>
          group.dayKey !== UNSCHEDULED_KEY && group.dayKey < today ? count + group.deals.length : count,
        0,
      ),
    [grouped, today],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef(true);

  const scrollToAnchor = useCallback((behavior: ScrollBehavior) => {
    const child = anchorRef.current;
    const scroller = child ? activeScroller(scrollRef.current, child) : null;
    if (!child || !scroller) return;
    scrollChildToTop(scroller, child, behavior);
  }, []);

  const scrollToPast = useCallback((behavior: ScrollBehavior) => {
    const child = anchorRef.current;
    const scroller = (child && activeScroller(scrollRef.current, child)) || scrollRef.current;
    scroller?.scrollTo({ top: 0, behavior });
  }, []);

  useLayoutEffect(() => {
    if (view !== "list" || !pendingAnchor.current || !anchorRef.current) return;
    scrollToAnchor("auto");
    pendingAnchor.current = false;
    // Webfonts finish after the first layout and push the anchor down.
    // Realign once the frame and the font load have settled.
    let alive = true;
    const realign = () => {
      if (alive) scrollToAnchor("auto");
    };
    const frame = requestAnimationFrame(realign);
    const fonts = document.fonts?.ready.then(realign);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      void fonts;
    };
  }, [view, grouped, loading, scrollToAnchor]);

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

  const handleAssign = useCallback(
    async (dealId: string, employeeId: string) => {
      if (!data) return;
      const targetDeal = data.deals.find((d) => d.dealId === dealId);
      if (targetDeal?.assignedEmployees.some((a) => a.employeeId === employeeId)) {
        setAddEmployeeForDealId(null);
        return;
      }
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
        setAddEmployeeForDealId(null);
      }
    },
    [data, load]
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

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Keine Daten verfügbar.</div>;
  }

  const addingForDeal = addEmployeeForDealId
    ? data.deals.find((d) => d.dealId === addEmployeeForDealId) ?? null
    : null;

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-0">
        {/* Main column. The toolbar stays put; the list pane is what scrolls. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:items-end sm:px-6 sm:py-5">
            <div className="min-w-0">
              <div className="k-label hidden sm:block" style={{ fontSize: 11 }}>
                Operations
              </div>
              <h1
                className="k-display mt-1"
                style={{
                  margin: 0,
                  fontSize: "clamp(24px, 4vw, 34px)",
                  fontVariationSettings: '"opsz" 96, "SOFT" 100',
                }}
              >
                Aufträge
              </h1>
              <p
                className="text-sm mt-1 hidden sm:block"
                style={{ color: "var(--ink-soft)" }}
              >
                {data.deals.length} aktiv · Ansicht wechseln mit dem Umschalter.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {view === "list" && grouped.length > 0 && (
                <button
                  type="button"
                  onClick={() => scrollToAnchor(motionBehavior())}
                  className="rounded-[10px] border px-3 py-[5px] text-[12.5px] font-medium"
                  style={{ borderColor: "var(--line)", background: "#fff", color: "var(--ink)" }}
                >
                  Heute
                </button>
              )}
              <div
                className="inline-flex rounded-[10px] p-[3px]"
                style={{ background: "#fff", border: "1px solid var(--line)" }}
              >
                {([
                  { k: "pipeline", label: "Pipeline" },
                  { k: "list", label: "Liste" },
                  { k: "map", label: "Karte" },
                ] as const).map((o) => (
                  <button
                    key={o.k}
                    onClick={() => {
                      if (o.k === "list") pendingAnchor.current = true;
                      setView(o.k);
                    }}
                    className="rounded-[7px] px-3 py-[5px] text-[12.5px] font-medium transition"
                    style={{
                      background: view === o.k ? "var(--ink)" : "transparent",
                      color: view === o.k ? "var(--paper)" : "var(--ink-soft)",
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {view === "map" ? (
            <div className="p-4 sm:p-6 pb-24 lg:pb-6">
              <MapView deals={data.deals} today={today} />
            </div>
          ) : view === "pipeline" ? (
            <PipelineView
              deals={data.deals}
              today={today}
              busyDealId={busyDealId}
              onCardClick={() => {}}
              transporterOptions={data.transporterOptions}
              onPatchAuftrag={ensureAuftragAndPatch}
              onUnassign={handleUnassign}
              onAddEmployee={(dealId) => setAddEmployeeForDealId(dealId)}
            />
          ) : (
          <OpsDayList
            grouped={grouped}
            today={today}
            anchor={anchor}
            pastJobCount={pastJobCount}
            anchorRef={anchorRef}
            onShowPast={() => scrollToPast(motionBehavior())}
            transporterOptions={data.transporterOptions}
            busyDealId={busyDealId}
            onUnassign={handleUnassign}
            onPatchAuftrag={ensureAuftragAndPatch}
            onAddEmployee={setAddEmployeeForDealId}
          />
          )}
          </div>
        </div>

        {/* Right sidebar: draggable employees — desktop / large only */}
        <aside className="hidden lg:flex flex-col w-64 shrink-0 border-l border-border bg-muted/20 overflow-auto">
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

        {/* Mobile FAB to view employees */}
        <button
          type="button"
          onClick={() => setEmployeeSheetOpen(true)}
          className="lg:hidden fixed bottom-4 right-4 z-30 flex items-center gap-2 rounded-full bg-primary text-primary-foreground shadow-lg px-4 py-3 text-sm font-medium active:scale-95 transition"
        >
          <UsersIcon className="h-4 w-4" />
          Mitarbeiter
        </button>

        {/* Mobile bottom sheet: standalone employee browser (informational) */}
        {employeeSheetOpen && (
          <BottomSheet onClose={() => setEmployeeSheetOpen(false)} title="Mitarbeiter">
            <p className="text-xs text-muted-foreground mb-3">
              Tipp: Tippe auf einer Auftragskarte „+ Mitarbeiter", um jemanden zuzuweisen.
            </p>
            <div className="space-y-1.5">
              {data.allEmployees.map((emp) => (
                <div
                  key={emp.id}
                  className="flex items-center gap-3 rounded-md bg-background border border-border px-3 py-2"
                >
                  <EmployeeAvatar name={emp.name} photoBase64={emp.photoBase64} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{emp.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {Number(emp.hourlyRate).toFixed(2)} €/h
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </BottomSheet>
        )}

        {/* Mobile bottom sheet: pick an employee to assign to a specific deal */}
        {addingForDeal && (
          <BottomSheet
            onClose={() => setAddEmployeeForDealId(null)}
            title={`Mitarbeiter zu „${addingForDeal.name}" zuweisen`}
          >
            <div className="space-y-1">
              {data.allEmployees
                .filter(
                  (emp) =>
                    !addingForDeal.assignedEmployees.some((a) => a.employeeId === emp.id)
                )
                .map((emp) => (
                  <button
                    key={emp.id}
                    type="button"
                    onClick={() => handleAssign(addingForDeal.dealId, emp.id)}
                    className="w-full flex items-center gap-3 rounded-md bg-background border border-border px-3 py-2.5 active:bg-muted/40 transition text-left"
                  >
                    <EmployeeAvatar name={emp.name} photoBase64={emp.photoBase64} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{emp.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {Number(emp.hourlyRate).toFixed(2)} €/h
                      </div>
                    </div>
                    <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))}
              {data.allEmployees.filter(
                (emp) => !addingForDeal.assignedEmployees.some((a) => a.employeeId === emp.id)
              ).length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  Alle Mitarbeiter sind bereits zugewiesen.
                </p>
              )}
            </div>
          </BottomSheet>
        )}
      </div>
    </DndContext>
  );
}

// ─── Bottom sheet (mobile) ──────────────────────────────────────────

function BottomSheet({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        onClick={onClose}
      />
      <div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-background border-t border-border shadow-2xl lg:hidden">
        <div className="sticky top-0 flex items-center justify-between bg-background border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold truncate pr-2">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
        {/* iOS safe-area */}
        <div className="pb-[env(safe-area-inset-bottom)]" />
      </div>
    </>
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
  onAddEmployee,
}: {
  deal: OpsDeal;
  transporterOptions: TransporterOption[];
  busy: boolean;
  onUnassign: (assignmentId: string) => void;
  onPatchAuftrag: (patch: Record<string, unknown>) => void;
  onAddEmployee: () => void;
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
                {deal.timeEnd ? ` bis ${formatTime(deal.timeEnd)}` : ""}
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
              {deal.moveFromAddress || "·"} → {deal.moveToAddress || "·"}
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
            <option value="">Transporter wählen</option>
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
      <div className="flex flex-wrap gap-1.5 items-center">
        {deal.assignedEmployees.length === 0 && (
          <p className="text-xs text-muted-foreground italic flex-1">
            <span className="hidden lg:inline">
              Niemand zugewiesen. Mitarbeiter aus der Seitenleiste hierhin ziehen.
            </span>
            <span className="lg:hidden">Niemand zugewiesen.</span>
          </p>
        )}
        {deal.assignedEmployees.map((emp) => (
          <div
            key={emp.assignmentId}
            className="group flex items-center gap-1.5 rounded-full bg-muted pl-1 pr-1.5 py-0.5 text-sm"
          >
            <EmployeeAvatar name={emp.name} photoBase64={emp.photoBase64} size="xs" />
            <span>{emp.name}</span>
            <button
              type="button"
              onClick={() => onUnassign(emp.assignmentId)}
              className="opacity-50 hover:opacity-100 hover:text-destructive p-0.5"
              title="Entfernen"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {/* Mobile-only tap-to-add button */}
        <button
          type="button"
          onClick={onAddEmployee}
          className="lg:hidden inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground active:bg-muted/40"
        >
          <Plus className="h-3 w-3" />
          Mitarbeiter
        </button>
      </div>
    </div>
  );
}

// ─── Date-grouped list ──────────────────────────────────────────────

function OpsDayList({
  grouped,
  today,
  anchor,
  pastJobCount,
  anchorRef,
  onShowPast,
  transporterOptions,
  busyDealId,
  onUnassign,
  onPatchAuftrag,
  onAddEmployee,
}: {
  grouped: { dayKey: string; label: string; deals: OpsDeal[] }[];
  today: string;
  anchor: ReturnType<typeof resolveListAnchor>;
  pastJobCount: number;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  onShowPast: () => void;
  transporterOptions: TransporterOption[];
  busyDealId: string | null;
  onUnassign: (dealId: string, assignmentId: string) => void;
  onPatchAuftrag: (deal: OpsDeal, patch: Record<string, unknown>) => void;
  onAddEmployee: (dealId: string) => void;
}) {
  const dated = grouped.filter((group) => group.dayKey !== UNSCHEDULED_KEY);
  const unscheduled = grouped.find((group) => group.dayKey === UNSCHEDULED_KEY) ?? null;

  function cards(deals: OpsDeal[]) {
    return (
      <div className="space-y-3">
        {deals.map((deal) => (
          <OpsCard
            key={deal.dealId}
            deal={deal}
            transporterOptions={transporterOptions}
            busy={busyDealId === deal.dealId}
            onUnassign={(assignmentId) => onUnassign(deal.dealId, assignmentId)}
            onPatchAuftrag={(patch) => onPatchAuftrag(deal, patch)}
            onAddEmployee={() => onAddEmployee(deal.dealId)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 pb-24 sm:space-y-8 sm:p-6 lg:pb-6">
      {grouped.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">Keine offenen Aufträge.</div>
      )}
      {dated.map((group) => (
        <Fragment key={group.dayKey}>
          {anchor.marker === "before-next" && group.dayKey === anchor.anchorDayKey && (
            <div ref={anchorRef} id="ops-heute">
              <PastJump count={pastJobCount} onClick={onShowPast} />
              <HeuteMarker label={formatDayHeader(today)} />
            </div>
          )}
          <div
            ref={anchor.marker === "on-today" && group.dayKey === today ? anchorRef : undefined}
            id={group.dayKey === today ? "ops-heute" : undefined}
          >
            {anchor.marker === "on-today" && group.dayKey === today && (
              <PastJump count={pastJobCount} onClick={onShowPast} />
            )}
            <DayHeading label={group.label} count={group.deals.length} today={group.dayKey === today} />
            {cards(group.deals)}
          </div>
        </Fragment>
      ))}
      {anchor.marker === "after-past" && grouped.length > 0 && (
        <div ref={anchorRef} id="ops-heute">
          <PastJump count={pastJobCount} onClick={onShowPast} />
          <HeuteMarker label={formatDayHeader(today)} />
        </div>
      )}
      {unscheduled && (
        <section>
          <DayHeading label={unscheduled.label} count={unscheduled.deals.length} today={false} />
          {cards(unscheduled.deals)}
        </section>
      )}
      {/* Lets Heute reach the top even when little follows it. */}
      <div aria-hidden="true" className="h-[55vh]" />
    </div>
  );
}

function DayHeading({ label, count, today }: { label: string; count: number; today: boolean }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
      {today && <HeutePill />}
      <span className="text-xs text-muted-foreground">· {count}</span>
    </div>
  );
}

function HeutePill() {
  return (
    <span className="inline-flex items-center rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
      Heute
    </span>
  );
}

function HeuteMarker({ label }: { label: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5">
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <HeutePill />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{label}</h2>
      <span className="text-xs text-muted-foreground">Keine Aufträge an diesem Tag.</span>
    </div>
  );
}

function PastJump({ count, onClick }: { count: number; onClick: () => void }) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
    >
      Vergangene anzeigen · {count}
    </button>
  );
}

// ─── Pipeline view (kanban-by-stage) ────────────────────────────────

function PipelineView({
  deals,
  today,
  busyDealId,
  transporterOptions,
  onPatchAuftrag,
  onUnassign,
  onAddEmployee,
}: {
  deals: OpsDeal[];
  today: string;
  busyDealId: string | null;
  onCardClick: (dealId: string) => void;
  transporterOptions: TransporterOption[];
  onPatchAuftrag: (deal: OpsDeal, patch: Record<string, unknown>) => void;
  onUnassign: (dealId: string, assignmentId: string) => void;
  onAddEmployee: (dealId: string) => void;
}) {
  // Columns stay in first-seen stage order. Within a column, today and later
  // come first so the lane does not open on the oldest job.
  const columns = useMemo(() => {
    const byStage = new Map<
      string,
      { title: string; color: string; deals: OpsDeal[] }
    >();
    for (const d of deals) {
      const title = d.stage?.title ?? "Ohne Phase";
      const color = d.stage?.color ?? "#8a7f72";
      let col = byStage.get(title);
      if (!col) {
        col = { title, color, deals: [] };
        byStage.set(title, col);
      }
      col.deals.push(d);
    }
    for (const col of byStage.values()) {
      col.deals.sort((a, b) => compareByToday(a.moveDate, b.moveDate, today));
    }
    return Array.from(byStage.values());
  }, [deals, today]);

  void transporterOptions;
  void onPatchAuftrag;

  return (
    <div className="p-4 sm:p-6 pb-24 lg:pb-6 overflow-x-auto">
      <div className="flex gap-3 min-w-max">
        {columns.length === 0 && (
          <div
            className="text-sm py-12"
            style={{ color: "var(--ink-muted)" }}
          >
            Keine offenen Aufträge.
          </div>
        )}
        {columns.map((col) => (
          <div
            key={col.title}
            className="flex-shrink-0 flex flex-col gap-2"
            style={{ width: 280 }}
          >
            <div className="flex items-center justify-between px-1.5 py-1">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-[7px] w-[7px] rounded-full"
                  style={{ background: col.color }}
                />
                <span
                  className="k-display"
                  style={{ fontSize: 14, fontWeight: 500 }}
                >
                  {col.title}
                </span>
                <span
                  className="k-mono"
                  style={{ fontSize: 11, color: "var(--ink-muted)" }}
                >
                  {col.deals.length}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {col.deals.map((deal) => (
                <PipelineCard
                  key={deal.dealId}
                  deal={deal}
                  busy={busyDealId === deal.dealId}
                  onUnassign={(asgId) => onUnassign(deal.dealId, asgId)}
                  onAddEmployee={() => onAddEmployee(deal.dealId)}
                />
              ))}
              {col.deals.length === 0 && (
                <div
                  className="text-[11.5px] italic px-1.5 py-2"
                  style={{ color: "var(--ink-muted)" }}
                >
                  Leer.
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PipelineCard({
  deal,
  busy,
  onUnassign,
  onAddEmployee,
}: {
  deal: OpsDeal;
  busy: boolean;
  onUnassign: (assignmentId: string) => void;
  onAddEmployee: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `pipeline-${deal.dealId}` });
  const needed = deal.workerCount ?? 0;
  const assigned = deal.assignedEmployees.length;
  const understaffed = needed > 0 && assigned < needed;

  return (
    <div
      ref={setNodeRef}
      className={cn("k-card p-3 transition", busy && "opacity-60")}
      style={isOver ? { borderColor: "var(--kottke-accent)", boxShadow: "0 0 0 2px color-mix(in oklch, var(--kottke-accent) 25%, transparent)" } : undefined}
    >
      <div className="flex items-baseline justify-between">
        <span
          className="k-mono"
          style={{ fontSize: 10.5, color: "var(--ink-muted)" }}
        >
          {deal.dealNumber ?? "·"}
        </span>
        {deal.moveDate && (
          <span
            className="k-mono"
            style={{ fontSize: 10.5, color: "var(--ink-muted)" }}
          >
            {new Date(deal.moveDate + "T00:00:00").toLocaleDateString("de-DE", {
              day: "2-digit",
              month: "2-digit",
            })}
          </span>
        )}
      </div>
      <Link
        href={`/objects/deals/${deal.dealId}`}
        className="mt-1 block text-[13.5px] font-medium hover:underline"
      >
        {deal.name}
      </Link>
      {(deal.moveFromAddress || deal.moveToAddress) && (
        <div
          className="mt-1 truncate text-[11.5px]"
          style={{ color: "var(--ink-muted)" }}
        >
          {deal.moveFromAddress ?? "·"} → {deal.moveToAddress ?? "·"}
        </div>
      )}

      <div
        className="mt-2.5 flex items-center justify-between pt-2.5"
        style={{ borderTop: "1px dashed var(--line)" }}
      >
        <div
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px]",
            understaffed ? "text-red-700" : ""
          )}
          style={
            understaffed
              ? { background: "oklch(0.94 0.05 25)" }
              : {
                  background: "var(--paper)",
                  color: "var(--ink-soft)",
                }
          }
        >
          <UsersIcon className="h-[11px] w-[11px]" />
          {assigned}/{needed || "?"}
          {understaffed && <AlertTriangle className="h-[11px] w-[11px]" />}
        </div>
        {deal.transporter && (
          <span
            className="inline-flex items-center gap-1 text-[10.5px]"
            style={{ color: "var(--ink-muted)" }}
          >
            <Truck className="h-[11px] w-[11px]" />
            {deal.transporter.title}
          </span>
        )}
      </div>

      {/* Assigned chips */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {deal.assignedEmployees.slice(0, 3).map((emp) => (
          <div
            key={emp.assignmentId}
            className="group inline-flex items-center gap-1 rounded-full bg-muted pl-0.5 pr-1.5 py-0.5 text-[11px]"
            title={emp.name}
          >
            <EmployeeAvatar
              name={emp.name}
              photoBase64={emp.photoBase64}
              size="xs"
            />
            <button
              type="button"
              onClick={() => onUnassign(emp.assignmentId)}
              className="opacity-40 hover:opacity-100 hover:text-destructive"
              aria-label={`${emp.name} entfernen`}
            >
              <X className="h-[10px] w-[10px]" />
            </button>
          </div>
        ))}
        {deal.assignedEmployees.length > 3 && (
          <span
            className="text-[11px]"
            style={{ color: "var(--ink-muted)" }}
          >
            +{deal.assignedEmployees.length - 3}
          </span>
        )}
        <button
          type="button"
          onClick={onAddEmployee}
          className="inline-flex items-center gap-0.5 rounded-full border border-dashed px-1.5 py-0.5 text-[10.5px] transition"
          style={{
            borderColor: "var(--line-strong)",
            color: "var(--ink-muted)",
          }}
        >
          <Plus className="h-[10px] w-[10px]" />
          Mitarb.
        </button>
      </div>
    </div>
  );
}
