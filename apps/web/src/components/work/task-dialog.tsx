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
}
