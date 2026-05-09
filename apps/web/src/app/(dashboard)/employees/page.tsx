"use client";

import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Loader2,
  Pencil,
  Trash2,
  ImagePlus,
  X,
  ArrowUpDown,
  ArrowDown,
  ArrowUp,
  Star,
  Clock,
  CalendarRange,
  Search,
} from "lucide-react";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { fmtEUR, fmtDate } from "@/components/employees/employee-detail-view";
import { cn } from "@/lib/utils";

type EmployeeStatus = "active" | "on_leave" | "inactive";

interface OverviewRow {
  id: string;
  name: string;
  role: string | null;
  status: EmployeeStatus;
  photoBase64: string | null;
  hourlyRate: string;
  jobsThisMonth: number;
  hoursThisMonth: number;
  paidYtd: number;
  owedNow: number;
  avgRating: number | null;
  ratedJobCount: number;
  onTimePct: number | null;
  onTimeJobCount: number;
  lastJobDate: string | null;
}

interface BasicEmployee {
  id: string;
  name: string;
  experience: string | null;
  hourlyRate: string;
  role: string | null;
  status: EmployeeStatus;
  photoBase64: string | null;
}

const STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "Aktiv",
  on_leave: "In Urlaub",
  inactive: "Inaktiv",
};

const STATUS_BADGE: Record<EmployeeStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-700",
  on_leave: "bg-amber-500/15 text-amber-700",
  inactive: "bg-zinc-500/15 text-zinc-700",
};

type SortKey =
  | "name"
  | "role"
  | "status"
  | "jobsThisMonth"
  | "hoursThisMonth"
  | "paidYtd"
  | "owedNow"
  | "avgRating"
  | "onTimePct"
  | "lastJobDate";

interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export default function EmployeesPage() {
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [basicById, setBasicById] = useState<Map<string, BasicEmployee>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    name: string;
    experience: string;
    hourlyRate: string;
    role: string;
    status: EmployeeStatus;
    photoBase64: string | null;
  }>({
    name: "",
    experience: "",
    hourlyRate: "",
    role: "",
    status: "active",
    photoBase64: null,
  });
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter state
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("");
  const [filterStatus, setFilterStatus] = useState<EmployeeStatus | "">("");
  const [filterMinOwed, setFilterMinOwed] = useState<string>("");
  const [filterMinRating, setFilterMinRating] = useState<string>("");

  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewRes, basicRes] = await Promise.all([
        fetch("/api/v1/employees/overview"),
        fetch("/api/v1/employees"),
      ]);
      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setRows((data.data as OverviewRow[]) || []);
      }
      if (basicRes.ok) {
        const data = await basicRes.json();
        const map = new Map<string, BasicEmployee>();
        for (const e of (data.data as BasicEmployee[]) || []) map.set(e.id, e);
        setBasicById(map);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleSave() {
    setSaving(true);
    try {
      const url = editId ? `/api/v1/employees/${editId}` : "/api/v1/employees";
      const method = editId ? "PATCH" : "POST";
      const payload = {
        name: form.name,
        experience: form.experience,
        hourlyRate: form.hourlyRate,
        role: form.role.trim() === "" ? null : form.role.trim(),
        status: form.status,
        photoBase64: form.photoBase64,
      };
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setForm({ name: "", experience: "", hourlyRate: "", role: "", status: "active", photoBase64: null });
        fetchAll();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handlePhotoUpload(file: File) {
    if (!file.type.startsWith("image/")) {
      alert("Bitte ein Bild auswählen.");
      return;
    }
    if (file.size > 1024 * 1024) {
      alert("Bild ist zu groß. Bitte unter 1 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setForm((f) => ({ ...f, photoBase64: result }));
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this employee?")) return;
    const res = await fetch(`/api/v1/employees/${id}`, { method: "DELETE" });
    if (res.ok) fetchAll();
  }

  function startEdit(empId: string) {
    const emp = basicById.get(empId);
    if (!emp) return;
    setEditId(empId);
    setForm({
      name: emp.name,
      experience: emp.experience || "",
      hourlyRate: emp.hourlyRate,
      role: emp.role || "",
      status: emp.status,
      photoBase64: emp.photoBase64 || null,
    });
    setShowForm(true);
  }

  const knownRoles = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) if (r.role) s.add(r.role);
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const minOwed = Number(filterMinOwed);
    const minRating = Number(filterMinRating);
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (filterRole && r.role !== filterRole) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (Number.isFinite(minOwed) && filterMinOwed !== "" && r.owedNow < minOwed) return false;
      if (Number.isFinite(minRating) && filterMinRating !== "") {
        if (r.avgRating === null || r.avgRating < minRating) return false;
      }
      return true;
    });
  }, [rows, search, filterRole, filterStatus, filterMinOwed, filterMinRating]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => compareRows(a, b, sort));
    return copy;
  }, [filtered, sort]);

  const totals = useMemo(() => {
    const acc = { paidYtd: 0, owedNow: 0, jobsThisMonth: 0, employees: rows.length, active: 0 };
    for (const r of rows) {
      acc.paidYtd += r.paidYtd;
      acc.owedNow += r.owedNow;
      acc.jobsThisMonth += r.jobsThisMonth;
      if (r.status === "active") acc.active += 1;
    }
    return acc;
  }, [rows]);

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Team</h1>
        <Button
          onClick={() => {
            setEditId(null);
            setForm({ name: "", experience: "", hourlyRate: "", role: "", status: "active", photoBase64: null });
            setShowForm(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Mitarbeiter hinzufügen
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Wer hat diesen Monat gearbeitet, was wurde bezahlt, was ist offen.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryCard label="Mitarbeiter" value={`${totals.active} / ${totals.employees}`} hint="aktiv / gesamt" />
        <SummaryCard label="Aufträge diesen Monat" value={String(totals.jobsThisMonth)} hint="alle Mitarbeiter" />
        <SummaryCard label="Bezahlt YTD" value={fmtEUR(totals.paidYtd)} hint="seit 1. Januar" />
        <SummaryCard
          label="Offen jetzt"
          value={fmtEUR(totals.owedNow)}
          hint="nicht ausgezahlt"
          highlight={totals.owedNow > 0}
        />
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border border-border p-4 space-y-3">
          <h3 className="font-medium text-sm">{editId ? "Mitarbeiter bearbeiten" : "Neuer Mitarbeiter"}</h3>
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative"
                title="Foto hochladen"
              >
                <EmployeeAvatar name={form.name || "?"} photoBase64={form.photoBase64} size="xl" />
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition">
                  <ImagePlus className="h-5 w-5 text-white" />
                </div>
              </button>
              {form.photoBase64 && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, photoBase64: null }))}
                  className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> entfernen
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handlePhotoUpload(file);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full sm:flex-1">
              <FormField label="Name *">
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </FormField>
              <FormField label="Rolle">
                <input
                  type="text"
                  list="role-suggestions"
                  value={form.role}
                  onChange={(e) => setForm({ ...form, role: e.target.value })}
                  placeholder="z. B. Fahrer, Packer, Helfer"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
                <datalist id="role-suggestions">
                  {knownRoles.map((r) => (
                    <option key={r} value={r} />
                  ))}
                  <option value="Fahrer" />
                  <option value="Packer" />
                  <option value="Mover" />
                  <option value="Helfer" />
                </datalist>
              </FormField>
              <FormField label="Status">
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as EmployeeStatus })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="active">Aktiv</option>
                  <option value="on_leave">In Urlaub</option>
                  <option value="inactive">Inaktiv</option>
                </select>
              </FormField>
              <FormField label="Erfahrung">
                <input
                  type="text"
                  value={form.experience}
                  onChange={(e) => setForm({ ...form, experience: e.target.value })}
                  placeholder="z. B. 5 Jahre, Senior"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </FormField>
              <FormField label="Stundensatz (EUR) *">
                <input
                  type="number"
                  step="0.01"
                  value={form.hourlyRate}
                  onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </FormField>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || !form.name || !form.hourlyRate}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editId ? "Aktualisieren" : "Erstellen"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setEditId(null);
              }}
            >
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex-1 min-w-[180px]">
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Suche</label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name…"
              className="w-full rounded-md border border-input bg-background pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Rolle</label>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Alle</option>
            {knownRoles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as EmployeeStatus | "")}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">Alle</option>
            <option value="active">Aktiv</option>
            <option value="on_leave">In Urlaub</option>
            <option value="inactive">Inaktiv</option>
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Offen ≥ €</label>
          <input
            type="number"
            min="0"
            step="50"
            value={filterMinOwed}
            onChange={(e) => setFilterMinOwed(e.target.value)}
            placeholder="z. B. 100"
            className="w-28 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-muted-foreground">Bewertung ≥</label>
          <input
            type="number"
            min="1"
            max="5"
            step="0.5"
            value={filterMinRating}
            onChange={(e) => setFilterMinRating(e.target.value)}
            placeholder="1–5"
            className="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {(search || filterRole || filterStatus || filterMinOwed || filterMinRating) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setFilterRole("");
              setFilterStatus("");
              setFilterMinOwed("");
              setFilterMinRating("");
            }}
            className="h-8"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Zurücksetzen
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {rows.length === 0
            ? "Noch keine Mitarbeiter. Lege oben den ersten an."
            : "Keine Mitarbeiter passen zu den Filtern."}
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <SortHeader sortState={sort} onClick={() => toggleSort("name")} sortKey="name" align="left">
                  Name
                </SortHeader>
                <SortHeader sortState={sort} onClick={() => toggleSort("role")} sortKey="role" align="left">
                  Rolle
                </SortHeader>
                <SortHeader sortState={sort} onClick={() => toggleSort("status")} sortKey="status" align="left">
                  Status
                </SortHeader>
                <SortHeader
                  sortState={sort}
                  onClick={() => toggleSort("jobsThisMonth")}
                  sortKey="jobsThisMonth"
                  align="right"
                >
                  Aufträge / Mon
                </SortHeader>
                <SortHeader
                  sortState={sort}
                  onClick={() => toggleSort("hoursThisMonth")}
                  sortKey="hoursThisMonth"
                  align="right"
                >
                  Stunden / Mon
                </SortHeader>
                <SortHeader
                  sortState={sort}
                  onClick={() => toggleSort("paidYtd")}
                  sortKey="paidYtd"
                  align="right"
                >
                  Bezahlt YTD
                </SortHeader>
                <SortHeader sortState={sort} onClick={() => toggleSort("owedNow")} sortKey="owedNow" align="right">
                  Offen jetzt
                </SortHeader>
                <SortHeader
                  sortState={sort}
                  onClick={() => toggleSort("avgRating")}
                  sortKey="avgRating"
                  align="right"
                >
                  Bewertung
                </SortHeader>
                <SortHeader
                  sortState={sort}
                  onClick={() => toggleSort("onTimePct")}
                  sortKey="onTimePct"
                  align="right"
                >
                  Pünktlich
                </SortHeader>
                <SortHeader
                  sortState={sort}
                  onClick={() => toggleSort("lastJobDate")}
                  sortKey="lastJobDate"
                  align="right"
                >
                  Letzter Auftrag
                </SortHeader>
                <th className="text-right px-3 py-2 font-medium w-24" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">
                    <Link href={`/employees/${r.id}`} className="flex items-center gap-2 hover:underline">
                      <EmployeeAvatar name={r.name} photoBase64={r.photoBase64} size="sm" />
                      <span>{r.name}</span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.role || "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                        STATUS_BADGE[r.status]
                      )}
                    >
                      {STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.jobsThisMonth}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {r.hoursThisMonth > 0 ? `${r.hoursThisMonth.toLocaleString("de-DE")} h` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtEUR(r.paidYtd)}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      r.owedNow > 0 && "text-amber-700 font-medium"
                    )}
                  >
                    {fmtEUR(r.owedNow)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.avgRating === null ? (
                      <span className="text-muted-foreground" title="Noch keine Bewertungen erfasst.">
                        —
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Star className="h-3 w-3 text-amber-500 fill-amber-500" />
                        <span>{r.avgRating.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                        <span className="text-[10px] text-muted-foreground">({r.ratedJobCount})</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.onTimePct === null ? (
                      <span
                        className="text-muted-foreground"
                        title="Tatsächliche Startzeiten werden noch nicht erfasst."
                      >
                        —
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {r.onTimePct}%
                        <span className="text-[10px] text-muted-foreground">({r.onTimeJobCount})</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      <CalendarRange className="h-3 w-3" />
                      {r.lastJobDate ? fmtDate(r.lastJobDate) : "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => startEdit(r.id)}
                        title="Bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(r.id)}
                        title="Löschen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-3 text-[11px] text-muted-foreground">
        Felder mit „—" werden befüllt, sobald Aufträge mit{" "}
        <code className="font-mono text-[10px]">customer_rating</code> bzw.{" "}
        <code className="font-mono text-[10px]">actual_start</code> erfasst werden.
      </div>
    </div>
  );
}

function compareRows(a: OverviewRow, b: OverviewRow, sort: SortState): number {
  const dir = sort.dir === "asc" ? 1 : -1;
  const k = sort.key;
  if (k === "name") return a.name.localeCompare(b.name) * dir;
  if (k === "role") return (a.role ?? "").localeCompare(b.role ?? "") * dir;
  if (k === "status") return STATUS_LABEL[a.status].localeCompare(STATUS_LABEL[b.status]) * dir;
  if (k === "lastJobDate") {
    if (a.lastJobDate === b.lastJobDate) return 0;
    if (!a.lastJobDate) return 1;
    if (!b.lastJobDate) return -1;
    return a.lastJobDate.localeCompare(b.lastJobDate) * dir;
  }
  // numeric fields, with nulls always last
  const av = (a as unknown as Record<string, number | null>)[k];
  const bv = (b as unknown as Record<string, number | null>)[k];
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return ((av as number) - (bv as number)) * dir;
}

function SummaryCard({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-background px-4 py-3",
        highlight ? "border-amber-500/40 bg-amber-500/5" : "border-border"
      )}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-semibold mt-0.5", highlight && "text-amber-700")}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function SortHeader({
  children,
  sortState,
  sortKey,
  onClick,
  align,
}: {
  children: React.ReactNode;
  sortState: SortState;
  sortKey: SortKey;
  onClick: () => void;
  align: "left" | "right";
}) {
  const active = sortState.key === sortKey;
  const Icon = !active ? ArrowUpDown : sortState.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-2 font-medium select-none", align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <span>{children}</span>
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}
