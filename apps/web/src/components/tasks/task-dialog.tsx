"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TaskComments } from "./task-comments";
import { TaskSubtasks } from "./task-subtasks";
import {
  WORK_TYPE_LABELS,
  GROWTH_CATEGORIES,
} from "@/lib/sprint-constants";
import { PRIORITIES } from "@/lib/task-priority";

function formatRelativeDe(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `vor ${hr} h`;
  const d = Math.round(hr / 24);
  if (d < 7) return `vor ${d} ${d === 1 ? "Tag" : "Tagen"}`;
  return new Date(iso).toLocaleDateString("de-DE");
}

// Kanban status options for the in-dialog status dropdown (mirrors the board).
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Automatisch" },
  { value: "backlog", label: "Backlog" },
  { value: "heute", label: "Heute" },
  { value: "laeuft", label: "Läuft jetzt" },
  { value: "warte", label: "Wartet" },
  { value: "erledigt", label: "Erledigt" },
];
import {
  format,
  isToday,
  isTomorrow,
  addDays,
  startOfWeek,
  endOfWeek,
  addWeeks,
} from "date-fns";
import { de } from "date-fns/locale";

// ─── Types ───────────────────────────────────────────────────────────

interface TaskFormData {
  id?: string;
  content: string;
  deadline: Date | null;
  assigneeIds: string[];
  recordIds: string[];
  linkedRecords?: { id: string; displayName: string; objectSlug: string }[];
  assignees?: { id: string; name: string; email: string }[];
  /** Fibonacci size (1,2,3,5,8,13) or null. */
  pointEstimate?: number | null;
  /** Sprint membership; null/"" = Kein Sprint. */
  sprintId?: string | null;
  /** 'flow' | 'build' | null. */
  workType?: string | null;
  /** Growth-category slug for build tasks. */
  growthCategory?: string | null;
  /** Free-text details. */
  description?: string | null;
  /** 'niedrig' | 'mittel' | 'hoch' | null. */
  priority?: string | null;
  /** Kanban column. */
  kanbanStatus?: string | null;
  /** For the activity footer. */
  createdBy?: string | null;
  createdAt?: string | null;
}

interface SprintOption {
  id: string;
  name: string;
  state: string;
}

const POINT_OPTIONS: { value: number; label: string; hint: string }[] = [
  { value: 1, label: "1", hint: "XS · < 15 min" },
  { value: 2, label: "2", hint: "S · ~ 30 min" },
  { value: 3, label: "3", hint: "M · ~ 1 h" },
  { value: 5, label: "5", hint: "L · halber Tag" },
  { value: 8, label: "8", hint: "XL · ganzer Tag" },
  { value: 13, label: "13", hint: "XXL · mehrtägig, bitte in Unteraufgaben splitten" },
];

interface Member {
  id: string;
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

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  initialData?: TaskFormData;
  currentUserId?: string;
  /** Pre-link to a specific record when creating from a record page */
  defaultRecordId?: string;
  defaultRecordName?: string;
  defaultRecordSlug?: string;
  /** Pre-fill task content (used by quick-action chips on record pages). */
  defaultContent?: string;
  /** Pre-fill deadline (used by quick-action chips). */
  defaultDeadline?: Date | null;
  /** Pre-select a sprint when creating from a sprint context. */
  defaultSprintId?: string | null;
  onSave: (data: {
    content: string;
    deadline: string | null;
    recordIds: string[];
    assigneeIds: string[];
    pointEstimate: number | null;
    sprintId: string | null;
    workType: string | null;
    growthCategory: string | null;
    description: string | null;
    priority: string | null;
    kanbanStatus?: string | null;
  }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

// ─── Component ───────────────────────────────────────────────────────

export function TaskDialog({
  open,
  onOpenChange,
  mode,
  initialData,
  currentUserId,
  defaultRecordId,
  defaultRecordName,
  defaultRecordSlug,
  defaultContent,
  defaultDeadline,
  defaultSprintId,
  onSave,
  onDelete,
}: TaskDialogProps) {
  const [content, setContent] = useState("");
  const [deadline, setDeadline] = useState<Date | null>(null);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [pointEstimate, setPointEstimate] = useState<number | null>(null);
  const [sprintId, setSprintId] = useState<string>("");
  const [workType, setWorkType] = useState<"flow" | "build">("flow");
  const [growthCategory, setGrowthCategory] = useState<string>("");
  const [sprints, setSprints] = useState<SprintOption[]>([]);
  const [description, setDescription] = useState<string>("");
  const [priority, setPriority] = useState<string>("");
  const [kanbanStatus, setKanbanStatus] = useState<string>("");
  const [linkedRecords, setLinkedRecords] = useState<
    { id: string; displayName: string; objectSlug: string }[]
  >([]);
  const [createMore, setCreateMore] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pickers open state
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [assigneePickerOpen, setAssigneePickerOpen] = useState(false);
  const [recordPickerOpen, setRecordPickerOpen] = useState(false);

  // Data for pickers
  const [members, setMembers] = useState<Member[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [recordSearch, setRecordSearch] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const contentRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const datePickerRef = useRef<HTMLDivElement>(null);
  const assigneePickerRef = useRef<HTMLDivElement>(null);
  const recordPickerRef = useRef<HTMLDivElement>(null);

  // Close pickers on click outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (datePickerOpen && datePickerRef.current && !datePickerRef.current.contains(target)) {
        setDatePickerOpen(false);
      }
      if (assigneePickerOpen && assigneePickerRef.current && !assigneePickerRef.current.contains(target)) {
        setAssigneePickerOpen(false);
      }
      if (recordPickerOpen && recordPickerRef.current && !recordPickerRef.current.contains(target)) {
        setRecordPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [datePickerOpen, assigneePickerOpen, recordPickerOpen]);

  // Initialize form data
  useEffect(() => {
    if (open) {
      if (mode === "edit" && initialData) {
        setContent(initialData.content);
        setDeadline(initialData.deadline);
        setAssigneeIds(initialData.assigneeIds);
        setLinkedRecords(initialData.linkedRecords || []);
        setPointEstimate(initialData.pointEstimate ?? null);
        setSprintId(initialData.sprintId ?? "");
        setWorkType(initialData.workType === "build" ? "build" : "flow");
        setGrowthCategory(initialData.growthCategory ?? "");
        setDescription(initialData.description ?? "");
        setPriority(initialData.priority ?? "");
        setKanbanStatus(initialData.kanbanStatus ?? "");
      } else {
        setContent(defaultContent ?? "");
        setDeadline(defaultDeadline ?? null);
        setAssigneeIds(currentUserId ? [currentUserId] : []);
        setPointEstimate(null);
        // Pulling a task into a sprint implies it is growth/build work.
        setSprintId(defaultSprintId ?? "");
        setWorkType(defaultSprintId ? "build" : "flow");
        setGrowthCategory("");
        setDescription("");
        setPriority("");
        setKanbanStatus("");
        setLinkedRecords(
          defaultRecordId && defaultRecordName
            ? [
                {
                  id: defaultRecordId,
                  displayName: defaultRecordName,
                  objectSlug: defaultRecordSlug || "",
                },
              ]
            : []
        );
      }
      setDatePickerOpen(false);
      setAssigneePickerOpen(false);
      setRecordPickerOpen(false);
      setMemberSearch("");
      setRecordSearch("");
      setSearchResults([]);
      // Focus title input after dialog opens
      setTimeout(() => contentRef.current?.focus(), 100);
    }
  }, [
    open,
    mode,
    initialData,
    currentUserId,
    defaultRecordId,
    defaultRecordName,
    defaultRecordSlug,
    defaultContent,
    defaultDeadline,
    defaultSprintId,
  ]);

  // Fetch assignable sprints (Planung + Aktiv) so a task can be slotted
  // into the sprint backlog right from the task dialog.
  useEffect(() => {
    if (open && sprints.length === 0) {
      fetch("/api/v1/sprints")
        .then((r) => r.json())
        .then((data) => {
          const list = (data?.data?.sprints ?? []) as SprintOption[];
          setSprints(
            list.filter((s) => s.state === "planung" || s.state === "aktiv")
          );
        })
        .catch(() => {});
    }
  }, [open, sprints.length]);

  // Fetch workspace members
  useEffect(() => {
    if (open && members.length === 0) {
      fetch("/api/v1/workspace-members")
        .then((r) => r.json())
        .then((data) => {
          if (data.data) {
            setMembers(
              data.data.map((m: { userId: string; userName?: string; userEmail?: string }) => ({
                id: m.userId,
                userId: m.userId,
                name: m.userName || "",
                email: m.userEmail || "",
              }))
            );
          }
        })
        .catch(() => {});
    }
  }, [open, members.length]);

  // Load browse results (no query)
  const loadBrowseResults = useCallback(async () => {
    setSearchLoading(true);
    try {
      const res = await fetch("/api/v1/records/browse?limit=30");
      if (res.ok) {
        const data = await res.json();
        setSearchResults(
          (data.data || []).map(
            (r: { recordId: string; displayName: string; subtitle?: string; objectSlug: string; objectName: string }) => ({
              id: r.recordId,
              displayName: r.displayName,
              subtitle: r.subtitle || "",
              objectSlug: r.objectSlug,
              objectName: r.objectName,
            })
          )
        );
      }
    } catch {
      // ignore
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Search records with debounce
  const searchRecords = useCallback((query: string) => {
    if (searchTimerRef.current !== null) clearTimeout(searchTimerRef.current);
    if (!query.trim()) {
      loadBrowseResults();
      return;
    }
    setSearchLoading(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/v1/search?q=${encodeURIComponent(query)}&limit=10`
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(
            (data.data || [])
              .filter((r: { type: string }) => r.type === "record")
              .map(
                (r: {
                  id: string;
                  title: string;
                  subtitle: string;
                  objectSlug: string;
                  objectName: string;
                }) => ({
                  id: r.id,
                  displayName: r.title,
                  subtitle: r.subtitle || "",
                  objectSlug: r.objectSlug || "",
                  objectName: r.objectName || "",
                })
              )
          );
        }
      } catch {
        // ignore
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  }, [loadBrowseResults]);

  async function handleSave() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await onSave({
        content: content.trim(),
        deadline: deadline ? deadline.toISOString().split("T")[0] : null,
        recordIds: linkedRecords.map((r) => r.id),
        assigneeIds,
        pointEstimate,
        sprintId: sprintId || null,
        workType,
        growthCategory: workType === "build" ? growthCategory || null : null,
        description: description.trim() || null,
        priority: priority || null,
        // Status only carries when editing; new tasks derive their column.
        ...(mode === "edit" ? { kanbanStatus: kanbanStatus || null } : {}),
      });
      if (createMore && mode === "create") {
        setContent("");
        setDeadline(null);
        setPointEstimate(null);
        setDescription("");
        setPriority("");
        setLinkedRecords(
          defaultRecordId && defaultRecordName
            ? [
                {
                  id: defaultRecordId,
                  displayName: defaultRecordName,
                  objectSlug: defaultRecordSlug || "",
                },
              ]
            : []
        );
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

  // Date quick options
  function setQuickDate(option: "today" | "tomorrow" | "next_week" | "none") {
    const now = new Date();
    switch (option) {
      case "today":
        setDeadline(now);
        break;
      case "tomorrow":
        setDeadline(addDays(now, 1));
        break;
      case "next_week":
        setDeadline(startOfWeek(addWeeks(now, 1), { weekStartsOn: 1 }));
        break;
      case "none":
        setDeadline(null);
        break;
    }
    setDatePickerOpen(false);
  }

  function getDeadlineLabel(): string {
    if (!deadline) return "Kein Datum";
    if (isToday(deadline)) return "Heute";
    if (isTomorrow(deadline)) return "Morgen";
    return format(deadline, "d. MMM", { locale: de });
  }

  function addRecord(record: SearchResult) {
    if (!linkedRecords.find((r) => r.id === record.id)) {
      setLinkedRecords((prev) => [
        ...prev,
        {
          id: record.id,
          displayName: record.displayName,
          objectSlug: record.objectSlug,
        },
      ]);
    }
    setRecordSearch("");
    setSearchResults([]);
  }

  function removeRecord(recordId: string) {
    setLinkedRecords((prev) => prev.filter((r) => r.id !== recordId));
  }

  function toggleAssignee(userId: string) {
    setAssigneeIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
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
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Neue Aufgabe" : "Aufgabe bearbeiten"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {mode === "create"
              ? "Details ausfüllen, um eine neue Aufgabe zu erstellen"
              : "Details der Aufgabe bearbeiten"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Task content */}
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

          {/* Beschreibung — the details beyond the one-line title. */}
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Beschreibung (optional)…"
            rows={2}
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          />

          {/* Action buttons row */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date picker */}
            <div className="relative" ref={datePickerRef}>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "text-xs gap-1.5",
                  deadline && "text-foreground",
                  !deadline && "text-muted-foreground"
                )}
                onClick={() => {
                  setDatePickerOpen(!datePickerOpen);
                  setAssigneePickerOpen(false);
                  setRecordPickerOpen(false);
                }}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                {getDeadlineLabel()}
              </Button>
              {datePickerOpen && (
                <div className="absolute top-full left-0 z-50 mt-1 rounded-lg border border-border bg-popover shadow-lg">
                  <Calendar
                    mode="single"
                    selected={deadline || undefined}
                    onSelect={(date) => {
                      setDeadline(date || null);
                      setDatePickerOpen(false);
                    }}
                    defaultMonth={deadline || new Date()}
                  />
                  <div className="border-t border-border px-3 pb-3 pt-2 flex flex-wrap gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setQuickDate("today")}
                    >
                      Heute
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setQuickDate("tomorrow")}
                    >
                      Morgen
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setQuickDate("next_week")}
                    >
                      Nächste Woche
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setQuickDate("none")}
                    >
                      Kein Datum
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Assignee picker */}
            <div className="relative" ref={assigneePickerRef}>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "text-xs gap-1.5",
                  assigneeIds.length > 0 && "text-foreground",
                  assigneeIds.length === 0 && "text-muted-foreground"
                )}
                onClick={() => {
                  setAssigneePickerOpen(!assigneePickerOpen);
                  setDatePickerOpen(false);
                  setRecordPickerOpen(false);
                }}
              >
                <User className="h-3.5 w-3.5" />
                {assignedMembers.length > 0
                  ? assignedMembers.length === 1 &&
                    assignedMembers[0].userId === currentUserId
                    ? "Dir zugewiesen"
                    : `${assignedMembers.length} ${assignedMembers.length > 1 ? "Personen" : "Person"}`
                  : "Zuweisen"}
              </Button>
              {assigneePickerOpen && (
                <div className="absolute top-full left-0 z-50 mt-1 w-56 rounded-lg border border-border bg-popover shadow-lg">
                  <div className="p-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={memberSearch}
                        onChange={(e) => setMemberSearch(e.target.value)}
                        placeholder="Person suchen..."
                        className="h-8 pl-8 text-xs"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-40 overflow-auto px-1 pb-2">
                    {filteredMembers.length === 0 && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        Keine Personen
                      </p>
                    )}
                    {filteredMembers.map((m) => (
                      <button
                        key={m.userId}
                        onClick={() => toggleAssignee(m.userId)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                      >
                        <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-medium text-primary shrink-0">
                          {(m.name || m.email)[0].toUpperCase()}
                        </div>
                        <span className="flex-1 truncate text-left text-xs">
                          {m.name || m.email}
                          {m.userId === currentUserId && " (Du)"}
                        </span>
                        {assigneeIds.includes(m.userId) && (
                          <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Record linking */}
            <div className="relative" ref={recordPickerRef}>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "text-xs gap-1.5",
                  linkedRecords.length > 0 && "text-foreground",
                  linkedRecords.length === 0 && "text-muted-foreground"
                )}
                onClick={() => {
                  const opening = !recordPickerOpen;
                  setRecordPickerOpen(opening);
                  setDatePickerOpen(false);
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
                <div className="absolute top-full left-0 z-50 mt-1 w-64 rounded-lg border border-border bg-popover shadow-lg">
                  {/* Show linked records with remove button */}
                  {linkedRecords.length > 0 && (
                    <div className="border-b border-border p-2 flex flex-wrap gap-1.5">
                      {linkedRecords.map((r) => {
                        const chipColor =
                          r.objectSlug === "companies"
                            ? "bg-blue-500"
                            : r.objectSlug === "people"
                              ? "bg-purple-500"
                              : r.objectSlug === "deals"
                                ? "bg-orange-500"
                                : r.objectSlug === "operating_companies"
                                  ? "bg-teal-600"
                                  : "bg-muted-foreground";
                        return (
                          <div
                            key={r.id}
                            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs bg-muted/30"
                          >
                            <div
                              className={cn(
                                "h-3 w-3 rounded flex items-center justify-center shrink-0",
                                chipColor
                              )}
                            >
                              <Building2 className="h-2 w-2 text-white" />
                            </div>
                            {r.objectSlug ? (
                              <Link
                                href={`/objects/${r.objectSlug}/${r.id}`}
                                onClick={(e) => e.stopPropagation()}
                                title={`${r.displayName} öffnen`}
                                className="truncate max-w-[120px] hover:underline hover:text-primary"
                              >
                                {r.displayName}
                              </Link>
                            ) : (
                              <span className="truncate max-w-[120px]">
                                {r.displayName}
                              </span>
                            )}
                            <button
                              onClick={() => removeRecord(r.id)}
                              className="shrink-0 text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
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
                        placeholder="Einträge suchen..."
                        className="h-8 pl-8 text-xs"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-auto px-1 pb-2">
                    {searchLoading && searchResults.length === 0 && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        Suche...
                      </p>
                    )}
                    {!searchLoading && recordSearch && searchResults.length === 0 && (
                      <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                        Keine Ergebnisse
                      </p>
                    )}
                    {searchResults
                      .filter(
                        (r) => !linkedRecords.find((lr) => lr.id === r.id)
                      )
                      .map((r) => {
                        const color =
                          r.objectSlug === "companies"
                            ? "bg-blue-500"
                            : r.objectSlug === "people"
                              ? "bg-purple-500"
                              : r.objectSlug === "deals"
                                ? "bg-orange-500"
                                : r.objectSlug === "operating_companies"
                                  ? "bg-teal-600"
                                  : "bg-muted-foreground";
                        return (
                          <button
                            key={r.id}
                            onClick={() => addRecord(r)}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                          >
                            <div
                              className={cn(
                                "h-4 w-4 rounded flex items-center justify-center shrink-0",
                                color
                              )}
                            >
                              <Building2 className="h-2.5 w-2.5 text-white" />
                            </div>
                            <span className="font-medium truncate text-left text-xs">
                              {r.displayName}
                            </span>
                            {r.subtitle && r.subtitle !== r.objectName && (
                              <span className="text-[11px] text-muted-foreground shrink-0">
                                {r.subtitle}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
            {linkedRecords.length === 1 && linkedRecords[0].objectSlug && (
              <Link
                href={`/objects/${linkedRecords[0].objectSlug}/${linkedRecords[0].id}`}
                title={`${linkedRecords[0].displayName} öffnen`}
                className="text-xs text-primary hover:underline truncate max-w-[160px]"
              >
                {linkedRecords[0].displayName}
              </Link>
            )}
          </div>

          {/* ── Fibonacci size picker ─────────────────────────────────
              Drives the Team-Pulse points score. Optional — leaving it
              blank counts as 1 in aggregation. Parent tasks with subtasks
              don't score on their own completion; only their leaf
              subtasks do. */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">Größe</span>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {POINT_OPTIONS.map((opt) => {
                const active = pointEstimate === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.hint}
                    onClick={() =>
                      setPointEstimate(active ? null : opt.value)
                    }
                    className={cn(
                      "px-2 py-1 tabular-nums border-r border-border last:border-r-0 transition-colors",
                      active
                        ? "bg-emerald-600 text-white"
                        : "bg-background hover:bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {pointEstimate != null && (
              <span className="text-[11px] text-muted-foreground">
                {POINT_OPTIONS.find((o) => o.value === pointEstimate)?.hint}
              </span>
            )}
          </div>

          {/* ── Art der Arbeit: laufender Betrieb vs Wachstum ─────────────
              'Wachstum' tasks are the finite grow-the-company initiatives
              that belong in a Sprint. 'Laufender Betrieb' is daily ops and
              stays in pure flow. Optional, defaults to laufender Betrieb. */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">Art</span>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {(["flow", "build"] as const).map((wt) => {
                const active = workType === wt;
                return (
                  <button
                    key={wt}
                    type="button"
                    onClick={() => {
                      setWorkType(wt);
                      if (wt === "flow") setGrowthCategory("");
                    }}
                    className={cn(
                      "px-2.5 py-1 border-r border-border last:border-r-0 transition-colors",
                      active
                        ? "bg-emerald-600 text-white"
                        : "bg-background hover:bg-muted/50 text-muted-foreground"
                    )}
                  >
                    {WORK_TYPE_LABELS[wt]}
                  </button>
                );
              })}
            </div>
            {workType === "build" && (
              <select
                value={growthCategory}
                onChange={(e) => setGrowthCategory(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                title="Wachstumsbereich"
              >
                <option value="">Bereich wählen</option>
                {GROWTH_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* ── Sprint-Zuordnung ───────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">Sprint</span>
            <select
              value={sprintId}
              onChange={(e) => setSprintId(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
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

          {/* ── Prioritaet ──────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-muted-foreground">Priorität</span>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {PRIORITIES.map((p) => {
                const active = priority === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(active ? "" : p.value)}
                    className={cn(
                      "inline-flex items-center gap-1 px-2.5 py-1 border-r border-border last:border-r-0 transition-colors",
                      active
                        ? "bg-foreground text-background"
                        : "bg-background hover:bg-muted/50 text-muted-foreground"
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: p.dot }}
                    />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Status (only when editing; new tasks derive their column) ── */}
          {mode === "edit" && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-muted-foreground">Status</span>
              <select
                value={kanbanStatus}
                onChange={(e) => setKanbanStatus(e.target.value)}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {mode === "edit" && initialData?.id && (
            <div
              className="mt-1 pt-3 flex flex-col gap-4"
              style={{ borderTop: "1px dashed var(--line, rgba(0,0,0,0.1))" }}
            >
              <TaskSubtasks
                taskId={initialData.id}
                members={members}
                currentUserId={currentUserId}
              />
              <TaskComments
                taskId={initialData.id}
                currentUserId={currentUserId}
              />
              {/* Aktivitaet — who created this task and when. */}
              {initialData.createdAt && (
                <p className="text-[11px] text-muted-foreground">
                  Erstellt
                  {(() => {
                    const creator = members.find(
                      (m) => m.userId === initialData.createdBy
                    );
                    return creator ? ` von ${creator.name || creator.email}` : "";
                  })()}{" "}
                  · {formatRelativeDe(initialData.createdAt)}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            {mode === "create" && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
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
                  if (
                    !window.confirm(
                      "Aufgabe wirklich löschen? Unteraufgaben und Kommentare werden mit gelöscht."
                    )
                  )
                    return;
                  await onDelete();
                  onOpenChange(false);
                }}
              >
                Löschen
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!content.trim() || saving}
            >
              {saving ? "Speichert..." : "Speichern"}
              <span className="ml-1.5 text-[10px] text-primary-foreground/60">
                Ctrl+Enter
              </span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
