"use client";

// One task row, used by the dashboard, the operative list, the project
// "Aufgaben" tab and the reports page. The checkbox writes `status` (the
// business field per Invariant I3) and never `isCompleted` directly.
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  FileText,
  ClipboardList,
  LifeBuoy,
  AlertTriangle,
  Users,
  Truck,
  Package,
  Receipt,
  MessageSquare,
  Circle,
  Check,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { TaskJSON } from "@/lib/work-types";
import { deadlineLabel, readApiError, type Tone } from "@/lib/work-ui";
import { operativeAreaLabel } from "@/lib/project-constants";
import { AvatarStack } from "./avatar-stack";
import { StatusChip } from "./status-chip";
import { cn } from "@/lib/utils";

const AREA_ICONS: Record<string, LucideIcon> = {
  angebot: FileText,
  auftrag: ClipboardList,
  nachsorge: LifeBuoy,
  schaden: AlertTriangle,
  personal: Users,
  fahrzeuge: Truck,
  beschaffung: Package,
  buchhaltung: Receipt,
  kunde: MessageSquare,
  sonstiges: Circle,
};

export function AreaIcon({ area, className }: { area: string | null; className?: string }) {
  const Icon = (area && AREA_ICONS[area]) || Circle;
  return <Icon className={cn("h-[15px] w-[15px]", className)} />;
}

const TONE_TEXT: Record<Tone, string> = {
  ok: "var(--ok)",
  warn: "var(--warn)",
  danger: "var(--danger)",
  info: "var(--info)",
  accent: "var(--kottke-accent)",
  neutral: "var(--muted-foreground)",
};

export function TaskRow({
  task,
  onOpen,
  onToggled,
  showProject = true,
  showArea = true,
  dense = false,
}: {
  task: TaskJSON;
  onOpen?: (task: TaskJSON) => void;
  /** Awaited — the row stays optimistic until the parent's refetch is done. */
  onToggled?: () => void | Promise<void>;
  showProject?: boolean;
  showArea?: boolean;
  dense?: boolean;
}) {
  // The optimistic value is the source of truth until the PROP catches up.
  // Clearing it as soon as the PATCH resolves is not enough: the parent's
  // refetch (getWorkDashboard is ~30 round trips) takes far longer, and during
  // that window the row would fall back to the stale prop and render unticked
  // — users click again and the second PATCH undoes the first (defect R4).
  const serverDone = task.status === "erledigt";
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const done = pending ?? serverDone;
  const dl = deadlineLabel(task.deadline, { done });

  // Drop the optimistic value only once the prop actually agrees with it.
  useEffect(() => {
    if (pending !== null && pending === serverDone) setPending(null);
  }, [pending, serverDone]);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    const next = !done;
    setPending(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next ? "erledigt" : "geplant" }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Status konnte nicht geändert werden"));
      // Awaited: the button must stay disabled and the row must keep showing
      // the new state for the whole refetch, not just for the PATCH.
      await onToggled?.();
    } catch (err) {
      setPending(null);
      toast.error("Status konnte nicht geändert werden", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(task)}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen(task);
        }
      }}
      className={cn(
        "group flex items-center gap-3 rounded-lg px-2 transition-colors",
        dense ? "py-1.5" : "py-2.5",
        onOpen && "cursor-pointer hover:bg-muted/60"
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={done ? "Als offen markieren" : "Als erledigt markieren"}
        className="shrink-0"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--muted-foreground)" }} />
        ) : done ? (
          <span
            className="flex h-4 w-4 items-center justify-center rounded-full"
            style={{ background: "var(--ok)" }}
          >
            <Check className="h-[10px] w-[10px] text-white" />
          </span>
        ) : (
          <span className="block h-4 w-4 rounded-full border-2 border-border transition-colors group-hover:border-foreground/40" />
        )}
      </button>

      {showArea && (
        <span className="shrink-0" style={{ color: "var(--muted-foreground)" }}>
          <AreaIcon area={task.area} />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div
          className={cn("truncate text-[13.5px]", done && "line-through")}
          style={{ color: done ? "var(--muted-foreground)" : "var(--foreground)" }}
        >
          {task.content}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {showProject && task.projectId && task.projectName && (
            <Link
              href={`/tasks/projects/${task.projectId}`}
              onClick={(e) => e.stopPropagation()}
              className="max-w-[180px] truncate"
            >
              <StatusChip tone="accent">{task.projectName}</StatusChip>
            </Link>
          )}
          {showArea && task.area && <StatusChip>{operativeAreaLabel(task.area)}</StatusChip>}
        </div>
      </div>

      {task.assignees.length > 0 && (
        <AvatarStack
          className="hidden sm:inline-flex"
          people={task.assignees.map((a) => ({ id: a.id, name: a.name || a.email }))}
          max={2}
        />
      )}

      <span
        className="k-mono shrink-0 text-[11px] tabular-nums"
        style={{ color: TONE_TEXT[dl.tone] }}
      >
        {dl.text}
      </span>
    </div>
  );
}
