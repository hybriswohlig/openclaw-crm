"use client";

// The task dialog of the new work model. Replaces components/tasks/task-dialog.tsx,
// which stays behind as a thin compatibility wrapper because
// components/layout/command-palette.tsx must not be touched (see plan R5).
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Calendar as CalendarIcon,
  User,
  Link2,
  X,
  Search,
  Check,
  Building2,
  FolderKanban,
} from "lucide-react";
import { format, isToday, isTomorrow, addDays, startOfWeek, addWeeks } from "date-fns";
import { de } from "date-fns/locale";
import { toast } from "sonner";
import { TaskComments } from "@/components/tasks/task-comments";
import { TaskSubtasks } from "@/components/tasks/task-subtasks";
import { PRIORITIES } from "@/lib/task-priority";
import { OPERATIVE_AREAS, TASK_STATUS, taskStatusLabel } from "@/lib/project-constants";
import type { PhaseJSON, ProjectJSON, SprintJSON, TaskJSON } from "@/lib/work-types";
import { cn } from "@/lib/utils";

export interface WorkTaskSavePayload {
  content: string;
  description: string | null;
  /**
   * Absent when unchanged — never send it "just in case": the server treats
   * any present value as a deadline edit and re-arms the overdue notification.
   * A full local-time ISO string, because `tasks.deadline` is a timestamp.
   */
  deadline?: string | null;
  /** Local "YYYY-MM-DD" — `tasks.start_date` is a real `date` column. */
  startDate: string | null;
  status: string;
  priority: string | null;
  kind: "projekt" | "operativ";
  projectId: string | null;
  phaseId: string | null;
  area: string | null;
  sprintId: string | null;
  recordIds: string[];
  assigneeIds: string[];
}

export interface WorkTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  task?: TaskJSON | null;
  currentUserId?: string;
  /** Pre-set project context when opened from a project page. */
  defaultProjectId?: string | null;
  defaultPhaseId?: string | null;
  defaultKind?: "projekt" | "operativ";
  defaultArea?: string | null;
  defaultSprintId?: string | null;
  defaultContent?: string;
  defaultDeadline?: Date | null;
  defaultRecordId?: string;
  defaultRecordName?: string;
  defaultRecordSlug?: string;
  onSave: (data: WorkTaskSavePayload) => Promise<void>;
  onDelete?: () => Promise<void>;
}

interface Member {
  userId: string;
  name: string;
  email: string;
}

interface SearchResult {
  id: string;
  displayName: string;
  subtitle: string;
  objectSlug: string;
  objectName: string;
}

/** For true `date` columns (tasks.start_date): local Y-M-D, no timezone shift. */
function toISODate(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * For `tasks.deadline`, which is a TIMESTAMP, not a date. Sending "2026-08-18"
 * makes the server do `new Date("2026-08-18")` = UTC midnight — the exact
 * off-by-one this plan forbids everywhere else. A full local-time ISO string
 * keeps the day the user picked.
 */
function toISOTimestamp(d: Date | null): string | null {
  if (!d) return null;
  const at = new Date(d);
  at.setHours(23, 59, 0, 0); // "due by end of that day"
  return at.toISOString();
}

/** Same calendar day, or both empty. */
function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export function WorkTaskDialog({
  open,
  onOpenChange,
  mode,
  task,
  currentUserId,
  defaultProjectId,
  defaultPhaseId,
  defaultKind,
  defaultArea,
  defaultSprintId,
  defaultContent,
  defaultDeadline,
  defaultRecordId,
  defaultRecordName,
  defaultRecordSlug,
  onSave,
  onDelete,
}: WorkTaskDialogProps) {
  const [content, setContent] = useState("");
  const [description, setDescription] = useState("");
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [status, setStatus] = useState<string>("geplant");
  const [priority, setPriority] = useState<string>("");
  const [kind, setKind] = useState<"projekt" | "operativ">("operativ");
  const [projectId, setProjectId] = useState<string>("");
  const [phaseId, setPhaseId] = useState<string>("");
  const [area, setArea] = useState<string>("");
  const [sprintId, setSprintId] = useState<string>("");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [linkedRecords, setLinkedRecords] = useState<
    { id: string; displayName: string; objectSlug: string }[]
  >([]);
  const [createMore, setCreateMore] = useState(false);
  const [saving, setSaving] = useState(false);

  const [projects, setProjects] = useState<ProjectJSON[]>([]);
  const [phases, setPhases] = useState<PhaseJSON[]>([]);
  const [sprints, setSprints] = useState<SprintJSON[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [recordPickerOpen, setRecordPickerOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const contentRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const datePickerRef = useRef<HTMLDivElement>(null);
  const startPickerRef = useRef<HTMLDivElement>(null);
  const assigneePickerRef = useRef<HTMLDivElement>(null);
  const recordPickerRef = useRef<HTMLDivElement>(null);

  // Close any open picker on an outside click — same mechanic as the old dialog.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (datePickerOpen && datePickerRef.current && !datePickerRef.current.contains(t)) setDatePickerOpen(false);
      if (startPickerOpen && startPickerRef.current && !startPickerRef.current.contains(t)) setStartPickerOpen(false);
      if (assigneePickerOpen && assigneePickerRef.current && !assigneePickerRef.current.contains(t)) setAssigneePickerOpen(false);
      if (recordPickerOpen && recordPickerRef.current && !recordPickerRef.current.contains(t)) setRecordPickerOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [datePickerOpen, startPickerOpen, assigneePickerOpen, recordPickerOpen]);

  // Seed the form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && task) {
      setContent(task.content);
      setDescription(task.description ?? "");
      setDeadline(task.deadline ? new Date(task.deadline) : null);
      setStartDate(task.startDate ? new Date(task.startDate) : null);
      setStatus(task.status);
      setPriority(task.priority ?? "");
      setKind(task.kind);
      setProjectId(task.projectId ?? "");
      setPhaseId(task.phaseId ?? "");
      setArea(task.area ?? "");
      setSprintId(task.sprintId ?? "");
      setAssigneeIds(task.assignees.map((a) => a.id));
      setLinkedRecords(task.linkedRecords);
    } else {
      setContent(defaultContent ?? "");
      setDescription("");
      setDeadline(defaultDeadline ?? null);
      setStartDate(null);
      setStatus("geplant");
      setPriority("");
      setKind(defaultKind ?? (defaultProjectId ? "projekt" : "operativ"));
      setProjectId(defaultProjectId ?? "");
      setPhaseId(defaultPhaseId ?? "");
      setArea(defaultArea ?? "");
      setSprintId(defaultSprintId ?? "");
      setAssigneeIds(currentUserId ? [currentUserId] : []);
      setLinkedRecords(
        defaultRecordId && defaultRecordName
          ? [{ id: defaultRecordId, displayName: defaultRecordName, objectSlug: defaultRecordSlug ?? "" }]
          : []
      );
    }
    setDatePickerOpen(false);
    setStartPickerOpen(false);
    setAssigneePickerOpen(false);
    setRecordPickerOpen(false);
    setMemberSearch("");
    setRecordSearch("");
    setSearchResults([]);
    setTimeout(() => contentRef.current?.focus(), 100);
    // Deps are deliberately narrow: `[open, task?.id, mode]` and nothing else.
    // The raw `task` object and `defaultDeadline: Date | null` are new
    // identities on every parent render for any caller that derives them or
    // writes `new Date()` inline — and this effect calls setContent(), so a
    // re-run would wipe whatever the user has typed mid-edit (defect R12).
    // Everything else is read at seeding time only, which is exactly right.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id, mode]);

  // Members, sprints and projects load once per open; phases follow the
  // selected project (Invariant I2: a phase must belong to its project).
  useEffect(() => {
    if (!open) return;
    if (members.length === 0) {
      fetch("/api/v1/workspace-members", { cache: "no-store" })
        .then((r) => r.json())
        .then((json) =>
          setMembers(
            ((json?.data ?? []) as Array<{ userId: string; userName?: string; userEmail?: string }>).map((m) => ({
              userId: m.userId,
              name: m.userName ?? "",
              email: m.userEmail ?? "",
            }))
          )
        )
        .catch(() => {});
    }
    if (sprints.length === 0) {
      fetch("/api/v1/sprints", { cache: "no-store" })
        .then((r) => r.json())
        .then((json) =>
          setSprints(
            ((json?.data?.sprints ?? []) as SprintJSON[]).filter(
              (s) => s.state === "planung" || s.state === "aktiv"
            )
          )
        )
        .catch(() => {});
    }
    if (projects.length === 0) {
      fetch("/api/v1/projects?limit=200", { cache: "no-store" })
        .then((r) => r.json())
        .then((json) => setProjects((json?.data?.projects ?? []) as ProjectJSON[]))
        .catch(() => {});
    }
  }, [open, members.length, sprints.length, projects.length]);

  useEffect(() => {
    if (!open || !projectId) {
      setPhases([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/v1/projects/${projectId}/phases`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setPhases((json?.data ?? []) as PhaseJSON[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const loadBrowseResults = useCallback(async () => {
    setSearchLoading(true);
    try {
      const res = await fetch("/api/v1/records/browse?limit=30");
      if (!res.ok) return;
      const json = await res.json();
      setSearchResults(
        ((json?.data ?? []) as Array<{
          recordId: string;
          displayName: string;
          subtitle?: string;
          objectSlug: string;
          objectName: string;
        }>).map((r) => ({
          id: r.recordId,
          displayName: r.displayName,
          subtitle: r.subtitle ?? "",
          objectSlug: r.objectSlug,
          objectName: r.objectName,
        }))
      );
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const searchRecords = useCallback(
    (query: string) => {
      if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
      if (!query.trim()) {
        loadBrowseResults();
        return;
      }
      setSearchLoading(true);
      searchTimerRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/v1/search?q=${encodeURIComponent(query)}&limit=10`);
          if (!res.ok) return;
          const json = await res.json();
          setSearchResults(
            ((json?.data ?? []) as Array<{
              id: string;
              title: string;
              subtitle: string;
              objectSlug: string;
              objectName: string;
              type: string;
            }>)
              .filter((r) => r.type === "record")
              .map((r) => ({
                id: r.id,
                displayName: r.title,
                subtitle: r.subtitle ?? "",
                objectSlug: r.objectSlug ?? "",
                objectName: r.objectName ?? "",
              }))
          );
        } finally {
          setSearchLoading(false);
        }
      }, 300);
    },
    [loadBrowseResults]
  );

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      // Invariant I1 is enforced server-side, but the payload is kept clean
      // here so the two fields can never disagree in the request itself.
      const isProject = kind === "projekt" && !!projectId;
      // Only send `deadline` when it actually changed: Phase 2's updateTask
      // resets overdueNotifiedAt whenever `deadline !== undefined`, so an
      // unrelated edit would re-arm the overdue push and the cron would send
      // the same notification again on every save (defect R8).
      const initialDeadline = mode === "edit" && task?.deadline ? new Date(task.deadline) : null;
      const deadlineChanged = mode === "create" || !sameDay(deadline, initialDeadline);
      await onSave({
        content: content.trim(),
        description: description.trim() || null,
        ...(deadlineChanged ? { deadline: toISOTimestamp(deadline) } : {}),
        startDate: toISODate(startDate),
        status,
        priority: priority || null,
        kind: isProject ? "projekt" : "operativ",
        projectId: isProject ? projectId : null,
        phaseId: isProject && phaseId ? phaseId : null,
        area: isProject ? null : area || null,
        sprintId: sprintId || null,
        recordIds: linkedRecords.map((r) => r.id),
        assigneeIds,
      });
      if (createMore && mode === "create") {
        setContent("");
        setDescription("");
        setDeadline(null);
        setStartDate(null);
        setTimeout(() => contentRef.current?.focus(), 50);
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error("Aufgabe konnte nicht gespeichert werden", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  }

  function setQuickDate(which: "deadline" | "start", option: "today" | "tomorrow" | "next_week" | "none") {
    const now = new Date();
    const value =
      option === "today"
        ? now
        : option === "tomorrow"
          ? addDays(now, 1)
          : option === "next_week"
            ? startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 })
            : null;
    if (which === "deadline") {
      setDeadline(value);
      setDatePickerOpen(false);
    } else {
      setStartDate(value);
      setStartPickerOpen(false);
    }
  }

  function dateLabel(d: Date | null, empty: string): string {
    if (!d) return empty;
    if (isToday(d)) return "Heute";
    if (isTomorrow(d)) return "Morgen";
    return format(d, "d. MMM", { locale: de });
  }

  const filteredMembers = members.filter(
    (m) =>
      !memberSearch ||
      m.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
      m.email.toLowerCase().includes(memberSearch.toLowerCase())
  );
  const assignedMembers = members.filter((m) => assigneeIds.includes(m.userId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Neue Aufgabe" : "Aufgabe bearbeiten"}</DialogTitle>
          <DialogDescription className="sr-only">
            {mode === "create"
              ? "Details ausfüllen, um eine neue Aufgabe zu erstellen"
              : "Details der Aufgabe bearbeiten"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Was ist zu tun?"
            className="text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                handleSave();
              }
            }}
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Beschreibung (optional)…"
            rows={2}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          />

          {/* ── Art der Aufgabe ────────────────────────────────────────
              Invariant I1: a task is a project task exactly when it has a
              project. Switching to "Operativ" clears project and phase. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Art</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {(
                [
                  { k: "operativ", label: "Operativ" },
                  { k: "projekt", label: "Projekt" },
                ] as const
              ).map((o) => {
                const active = kind === o.k;
                return (
                  <button
                    key={o.k}
                    type="button"
                    onClick={() => {
                      setKind(o.k);
                      if (o.k === "operativ") {
                        setProjectId("");
                        setPhaseId("");
                      } else {
                        setArea("");
                      }
                    }}
                    className={cn(
                      "border-r border-border px-2.5 py-1 transition-colors last:border-r-0",
                      active ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>

          {kind === "projekt" ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setPhaseId("");
                }}
                className="h-7 max-w-[200px] rounded-md border border-border bg-background px-2 text-xs text-foreground"
                aria-label="Projekt"
              >
                <option value="">Projekt wählen</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                value={phaseId}
                onChange={(e) => setPhaseId(e.target.value)}
                disabled={!projectId || phases.length === 0}
                className="h-7 max-w-[200px] rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:opacity-40"
                aria-label="Arbeitsbereich"
              >
                <option value="">Ohne Arbeitsbereich</option>
                {phases.map((ph) => (
                  <option key={ph.id} value={ph.id}>
                    {ph.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Bereich</span>
              <select
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                aria-label="Bereich"
              >
                <option value="">Bereich wählen</option>
                {OPERATIVE_AREAS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* Fälligkeit */}
            <div className="relative" ref={datePickerRef}>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 text-xs", deadline ? "text-foreground" : "text-muted-foreground")}
                onClick={() => {
                  setDatePickerOpen(!datePickerOpen);
                  setStartPickerOpen(false);
                  setAssigneePickerOpen(false);
                  setRecordPickerOpen(false);
                }}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateLabel(deadline, "Kein Fälligkeitsdatum")}
              </Button>
              {datePickerOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-border bg-popover shadow-lg">
                  <Calendar
                    mode="single"
                    selected={deadline || undefined}
                    onSelect={(d) => {
                      setDeadline(d ?? null);
                      setDatePickerOpen(false);
                    }}
                    defaultMonth={deadline || new Date()}
                  />
                  <div className="flex flex-wrap gap-1.5 border-t border-border px-3 pb-3 pt-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setQuickDate("deadline", "today")}>Heute</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setQuickDate("deadline", "tomorrow")}>Morgen</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setQuickDate("deadline", "next_week")}>Nächste Woche</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setQuickDate("deadline", "none")}>Kein Datum</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Start — treibt den Balkenanfang in der Zeitleiste */}
            <div className="relative" ref={startPickerRef}>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 text-xs", startDate ? "text-foreground" : "text-muted-foreground")}
                onClick={() => {
                  setStartPickerOpen(!startPickerOpen);
                  setDatePickerOpen(false);
                  setAssigneePickerOpen(false);
                  setRecordPickerOpen(false);
                }}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                Start: {dateLabel(startDate, "offen")}
              </Button>
              {startPickerOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-border bg-popover shadow-lg">
                  <Calendar
                    mode="single"
                    selected={startDate || undefined}
                    onSelect={(d) => {
                      setStartDate(d ?? null);
                      setStartPickerOpen(false);
                    }}
                    defaultMonth={startDate || new Date()}
                  />
                  <div className="flex flex-wrap gap-1.5 border-t border-border px-3 pb-3 pt-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setQuickDate("start", "today")}>Heute</Button>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setQuickDate("start", "none")}>Kein Datum</Button>
                  </div>
                </div>
              )}
            </div>

            {/* Zuweisen */}
            <div className="relative" ref={assigneePickerRef}>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 text-xs", assigneeIds.length > 0 ? "text-foreground" : "text-muted-foreground")}
                onClick={() => {
                  setAssigneePickerOpen(!assigneePickerOpen);
                  setDatePickerOpen(false);
                  setStartPickerOpen(false);
                  setRecordPickerOpen(false);
                }}
              >
                <User className="h-3.5 w-3.5" />
                {assignedMembers.length > 0
                  ? assignedMembers.length === 1 && assignedMembers[0].userId === currentUserId
                    ? "Dir zugewiesen"
                    : `${assignedMembers.length} ${assignedMembers.length > 1 ? "Personen" : "Person"}`
                  : "Zuweisen"}
              </Button>
              {assigneePickerOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-popover shadow-lg">
                  <div className="p-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder="Person suchen…"
                        className="h-8 pl-8 text-xs"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-40 overflow-auto px-1 pb-2">
                    {filteredMembers.length === 0 && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">Keine Personen</p>
                    )}
                    {filteredMembers.map((m) => (
                      <button
                        key={m.userId}
                        onClick={() =>
                          setAssigneeIds((prev) =>
                            prev.includes(m.userId) ? prev.filter((id) => id !== m.userId) : [...prev, m.userId]
                          )
                        }
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                      >
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground">
                          {(m.name || m.email || "?")[0].toUpperCase()}
                        </span>
                        <span className="flex-1 truncate text-left text-xs">
                          {m.name || m.email}
                          {m.userId === currentUserId && " (Du)"}
                        </span>
                        {assigneeIds.includes(m.userId) && <Check className="h-3.5 w-3.5 shrink-0 text-foreground" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Eintrag verknüpfen */}
            <div className="relative" ref={recordPickerRef}>
              <Button
                variant="outline"
                size="sm"
                className={cn("gap-1.5 text-xs", linkedRecords.length > 0 ? "text-foreground" : "text-muted-foreground")}
                onClick={() => {
                  const opening = !recordPickerOpen;
                  setRecordPickerOpen(opening);
                  setDatePickerOpen(false);
                  setStartPickerOpen(false);
                  setAssigneePickerOpen(false);
                  if (opening) loadBrowseResults();
                }}
              >
                <Link2 className="h-3.5 w-3.5" />
                {linkedRecords.length > 0
                  ? linkedRecords.length === 1
                    ? "1 verknüpfter Eintrag"
                    : `${linkedRecords.length} verknüpfte Einträge`
                  : "Eintrag verknüpfen"}
              </Button>
              {recordPickerOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-popover shadow-lg">
                  {linkedRecords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 border-b border-border p-2">
                      {linkedRecords.map((r) => (
                        <span
                          key={r.id}
                          className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs"
                        >
                          <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                          {r.objectSlug ? (
                            <Link
                              href={`/objects/${r.objectSlug}/${r.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="max-w-[120px] truncate hover:underline"
                            >
                              {r.displayName}
                            </Link>
                          ) : (
                            <span className="max-w-[120px] truncate">{r.displayName}</span>
                          )}
                          <button
                            onClick={() => setLinkedRecords((prev) => prev.filter((x) => x.id !== r.id))}
                            className="shrink-0 text-muted-foreground hover:text-destructive"
                            aria-label="Verknüpfung entfernen"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="p-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={recordSearch}
                        onChange={(e) => {
                          setRecordSearch(e.target.value);
                          searchRecords(e.target.value);
                        }}
                        placeholder="Einträge suchen…"
                        className="h-8 pl-8 text-xs"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-auto px-1 pb-2">
                    {searchLoading && searchResults.length === 0 && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">Suche…</p>
                    )}
                    {!searchLoading && recordSearch && searchResults.length === 0 && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">Keine Ergebnisse</p>
                    )}
                    {searchResults
                      .filter((r) => !linkedRecords.some((lr) => lr.id === r.id))
                      .map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setLinkedRecords((prev) => [
                              ...prev,
                              { id: r.id, displayName: r.displayName, objectSlug: r.objectSlug },
                            ]);
                            setRecordSearch("");
                            setSearchResults([]);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                        >
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate text-left text-xs font-medium">{r.displayName}</span>
                          {r.subtitle && r.subtitle !== r.objectName && (
                            <span className="shrink-0 text-[11px] text-muted-foreground">{r.subtitle}</span>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Status</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {TASK_STATUS.map((s) => {
                const active = status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={cn(
                      "border-r border-border px-2.5 py-1 transition-colors last:border-r-0",
                      active ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {taskStatusLabel(s)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Priorität</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              {PRIORITIES.map((p) => {
                const active = priority === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(active ? "" : p.value)}
                    className={cn(
                      "inline-flex items-center gap-1 border-r border-border px-2.5 py-1 transition-colors last:border-r-0",
                      active ? "bg-foreground text-background" : "bg-background text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: p.dot }} />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Sprint</span>
            <select
              value={sprintId}
              onChange={(e) => setSprintId(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              aria-label="Sprint"
            >
              <option value="">Kein Sprint</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.state === "aktiv" ? " (aktiv)" : " (Planung)"}
                </option>
              ))}
            </select>
          </div>

          {mode === "edit" && task?.id && (
            <div className="mt-1 flex flex-col gap-4 border-t border-dashed border-border pt-3">
              <TaskSubtasks
                taskId={task.id}
                members={members.map((m) => ({ id: m.userId, userId: m.userId, name: m.name, email: m.email }))}
                currentUserId={currentUserId}
              />
              <TaskComments taskId={task.id} currentUserId={currentUserId} />
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            {mode === "create" && (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={createMore}
                  onChange={(e) => setCreateMore(e.target.checked)}
                  className="rounded border-border"
                />
                Weitere erstellen
              </label>
            )}
            {mode === "edit" && onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-destructive hover:text-destructive"
                onClick={async () => {
                  if (!window.confirm("Aufgabe wirklich löschen? Unteraufgaben und Kommentare werden mit gelöscht.")) return;
                  await onDelete();
                  onOpenChange(false);
                }}
              >
                Löschen
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!content.trim() || saving}>
              {saving ? "Speichert…" : "Speichern"}
              <span className="ml-1.5 text-[10px] opacity-60">Ctrl+Enter</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
