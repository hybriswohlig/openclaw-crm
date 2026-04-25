"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Loader2,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  X,
  Briefcase,
  Wallet,
  Receipt,
  AlertCircle,
  CalendarClock,
  FileText,
  Scale,
  ShieldOff,
} from "lucide-react";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { cn } from "@/lib/utils";

interface Employee {
  id: string;
  name: string;
  experience: string | null;
  hourlyRate: string;
  photoBase64: string | null;
  createdAt: string;
  contractCount: number;
}

interface AuftragRow {
  assignmentId: string;
  dealRecordId: string;
  dealNumber: string | null;
  dealName: string;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
  role: string;
  assignedAt: string;
}

interface TransactionRow {
  id: string;
  date: string;
  type: "salary" | "advance" | "reimbursement";
  amount: number;
  amountPaid: number;
  amountOutstanding: number;
  status: "offen" | "teilweise bezahlt" | "bezahlt";
  dueDate: string | null;
  description: string | null;
  notes: string | null;
  dealRecordId: string;
  dealNumber: string | null;
  dealName: string;
  isTaxDeductible: boolean;
  hasReceipt: boolean;
}

interface EmployeeDetail {
  contracts: { assignmentId: string; dealRecordId: string; role: string; assignedAt: string }[];
  auftraege: AuftragRow[];
  paymentsReceived: TransactionRow[];
  outOfPocket: TransactionRow[];
  totals: {
    receivedTotal: number;
    outstandingTotal: number;
    outOfPocketOpen: number;
    deductibleReceived: number;
    nonDeductibleReceived: number;
    receiptCount: number;
  };
}

const TYPE_LABEL: Record<TransactionRow["type"], string> = {
  salary: "Lohn",
  advance: "Vorschuss",
  reimbursement: "Erstattung",
};

const STATUS_BADGE: Record<TransactionRow["status"], { label: string; cls: string }> = {
  offen: { label: "offen", cls: "bg-amber-500/15 text-amber-700" },
  "teilweise bezahlt": { label: "teilweise bezahlt", cls: "bg-blue-500/15 text-blue-700" },
  bezahlt: { label: "bezahlt", cls: "bg-emerald-500/15 text-emerald-700" },
};

function fmtEUR(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("de-DE");
}

function isOverdue(due: string | null, status: TransactionRow["status"]): boolean {
  if (!due) return false;
  if (status === "bezahlt") return false;
  return new Date(due + "T23:59:59") < new Date();
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmployeeDetail | null>(null);
  const [form, setForm] = useState<{ name: string; experience: string; hourlyRate: string; photoBase64: string | null }>({
    name: "",
    experience: "",
    hourlyRate: "",
    photoBase64: null,
  });
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.data || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  async function handleSave() {
    setSaving(true);
    try {
      const url = editId ? `/api/v1/employees/${editId}` : "/api/v1/employees";
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowForm(false);
        setEditId(null);
        setForm({ name: "", experience: "", hourlyRate: "", photoBase64: null });
        fetchEmployees();
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
    if (res.ok) fetchEmployees();
  }

  function startEdit(emp: Employee) {
    setEditId(emp.id);
    setForm({
      name: emp.name,
      experience: emp.experience || "",
      hourlyRate: emp.hourlyRate,
      photoBase64: emp.photoBase64 || null,
    });
    setShowForm(true);
  }

  const reloadDetail = useCallback(async (employeeId: string) => {
    const res = await fetch(`/api/v1/employees/${employeeId}`);
    if (!res.ok) return;
    const data = await res.json();
    setDetail({
      contracts: data.data?.contracts ?? [],
      auftraege: data.data?.auftraege ?? [],
      paymentsReceived: data.data?.paymentsReceived ?? [],
      outOfPocket: data.data?.outOfPocket ?? [],
      totals: data.data?.totals ?? { receivedTotal: 0, outstandingTotal: 0, outOfPocketOpen: 0 },
    });
  }, []);

  async function toggleExpand(emp: Employee) {
    if (expandedId === emp.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(emp.id);
    setDetail(null);
    await reloadDetail(emp.id);
  }

  async function recordPayment(emp: Employee, transactionId: string) {
    const input = prompt("Betrag der Zahlung in EUR (z. B. 50 oder -50 zum Stornieren):");
    if (!input) return;
    const delta = Number(input.replace(",", "."));
    if (!Number.isFinite(delta) || delta === 0) {
      alert("Ungültiger Betrag.");
      return;
    }
    const res = await fetch(`/api/v1/employee-transactions/${transactionId}/record-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delta }),
    });
    if (res.ok) await reloadDetail(emp.id);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Employees</h1>
        <Button
          onClick={() => {
            setEditId(null);
            setForm({ name: "", experience: "", hourlyRate: "", photoBase64: null });
            setShowForm(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add Employee
        </Button>
      </div>

      {showForm && (
        <div className="mb-6 rounded-lg border border-border p-4 space-y-3">
          <h3 className="font-medium text-sm">{editId ? "Edit Employee" : "New Employee"}</h3>
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4">
            {/* Avatar uploader */}
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="group relative"
                title="Foto hochladen"
              >
                <EmployeeAvatar
                  name={form.name || "?"}
                  photoBase64={form.photoBase64}
                  size="xl"
                />
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
              <div>
                <label className="text-xs text-muted-foreground">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Experience</label>
                <input
                  type="text"
                  value={form.experience}
                  onChange={(e) => setForm({ ...form, experience: e.target.value })}
                  placeholder="e.g. 5 years, Senior"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Hourly Rate (EUR) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.hourlyRate}
                  onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || !form.name || !form.hourlyRate}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editId ? "Update" : "Create"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setEditId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {employees.length === 0 ? (
        <p className="text-muted-foreground text-sm">No employees yet. Add your first one above.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium w-8" />
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Experience</th>
                <th className="text-right px-4 py-3 font-medium">Hourly Rate</th>
                <th className="text-right px-4 py-3 font-medium">Contracts</th>
                <th className="text-right px-4 py-3 font-medium w-24" />
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <>
                  <tr
                    key={emp.id}
                    className="border-b border-border hover:bg-muted/30 cursor-pointer"
                    onClick={() => toggleExpand(emp)}
                  >
                    <td className="px-4 py-3">
                      {expandedId === emp.id ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <EmployeeAvatar name={emp.name} photoBase64={emp.photoBase64} size="sm" />
                        <span>{emp.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{emp.experience || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {Number(emp.hourlyRate).toLocaleString("de-DE", {
                        style: "currency",
                        currency: "EUR",
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">{emp.contractCount}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(emp);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(emp.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === emp.id && (
                    <tr key={`${emp.id}-detail`}>
                      <td colSpan={6} className="bg-muted/10 px-8 py-4">
                        {!detail ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Lade Details…
                          </div>
                        ) : (
                          <EmployeeDetailView
                            detail={detail}
                            onRecordPayment={(txId) => recordPayment(emp, txId)}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Detail view (Aufträge / Zahlungen / Auslagen) ──────────────────────────

function EmployeeDetailView({
  detail,
  onRecordPayment,
}: {
  detail: EmployeeDetail;
  onRecordPayment: (transactionId: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Summary stats */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Stat label="Aufträge" value={String(detail.auftraege.length)} icon={<Briefcase className="h-3.5 w-3.5" />} />
        <Stat label="Erhalten" value={fmtEUR(detail.totals.receivedTotal)} icon={<Wallet className="h-3.5 w-3.5" />} />
        <Stat
          label="Abzugsfähig"
          value={fmtEUR(detail.totals.deductibleReceived)}
          icon={<Scale className="h-3.5 w-3.5" />}
        />
        <Stat
          label="Nicht abz."
          value={fmtEUR(detail.totals.nonDeductibleReceived)}
          icon={<ShieldOff className="h-3.5 w-3.5" />}
          highlight={detail.totals.nonDeductibleReceived > 0}
        />
        <Stat
          label="Belege"
          value={String(detail.totals.receiptCount)}
          icon={<FileText className="h-3.5 w-3.5" />}
        />
        <Stat
          label="Offene Auslagen"
          value={fmtEUR(detail.totals.outOfPocketOpen)}
          icon={<Receipt className="h-3.5 w-3.5" />}
          highlight={detail.totals.outOfPocketOpen > 0}
        />
        <Stat
          label="Insgesamt offen"
          value={fmtEUR(detail.totals.outstandingTotal)}
          icon={<AlertCircle className="h-3.5 w-3.5" />}
          highlight={detail.totals.outstandingTotal > 0}
        />
      </div>

      {/* Aufträge */}
      <DetailSection title="Aufträge" icon={<Briefcase className="h-4 w-4" />} count={detail.auftraege.length}>
        {detail.auftraege.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 px-1">Noch keine Aufträge.</p>
        ) : (
          <div className="rounded-md border border-border bg-background divide-y divide-border">
            {detail.auftraege.map((a) => (
              <Link
                key={a.assignmentId}
                href={`/objects/deals/${a.dealRecordId}`}
                className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40 transition"
              >
                {a.dealNumber && <span className="font-mono text-xs text-muted-foreground">{a.dealNumber}</span>}
                <span className="font-medium flex-1 truncate">{a.dealName}</span>
                {a.stage && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    style={{ backgroundColor: a.stage.color + "33", color: a.stage.color }}
                  >
                    {a.stage.title}
                  </span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{a.role}</span>
                <span className="text-xs text-muted-foreground w-24 text-right">
                  {a.moveDate ? fmtDate(a.moveDate) : "kein Datum"}
                </span>
              </Link>
            ))}
          </div>
        )}
      </DetailSection>

      {/* Zahlungen erhalten */}
      <DetailSection
        title="Zahlungen erhalten"
        icon={<Wallet className="h-4 w-4" />}
        count={detail.paymentsReceived.length}
      >
        {detail.paymentsReceived.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 px-1">Noch keine Zahlungen erhalten.</p>
        ) : (
          <TransactionTable rows={detail.paymentsReceived} onRecordPayment={onRecordPayment} />
        )}
      </DetailSection>

      {/* Auslagen (eigene Tasche) */}
      <DetailSection
        title="Auslagen (aus eigener Tasche)"
        icon={<Receipt className="h-4 w-4" />}
        count={detail.outOfPocket.length}
      >
        {detail.outOfPocket.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 px-1">Keine Auslagen erfasst.</p>
        ) : (
          <TransactionTable rows={detail.outOfPocket} onRecordPayment={onRecordPayment} showOutstanding />
        )}
      </DetailSection>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5",
        highlight ? "border-amber-500/40 bg-amber-500/10 text-amber-700" : "border-border bg-background"
      )}
    >
      {icon}
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function DetailSection({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-1.5 px-1">
        {icon}
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
        <span className="text-xs text-muted-foreground">({count})</span>
      </div>
      {children}
    </section>
  );
}

function TransactionTable({
  rows,
  onRecordPayment,
  showOutstanding,
}: {
  rows: TransactionRow[];
  onRecordPayment: (transactionId: string) => void;
  showOutstanding?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-xs text-muted-foreground">
            <th className="text-left px-3 py-1.5 font-medium">Datum</th>
            <th className="text-left px-3 py-1.5 font-medium">Typ</th>
            <th className="text-left px-3 py-1.5 font-medium">Deal</th>
            <th className="text-right px-3 py-1.5 font-medium">Betrag</th>
            <th className="text-right px-3 py-1.5 font-medium">Bezahlt</th>
            {showOutstanding && <th className="text-right px-3 py-1.5 font-medium">Offen</th>}
            <th className="text-left px-3 py-1.5 font-medium">Status</th>
            <th className="text-left px-3 py-1.5 font-medium">Beleg</th>
            <th className="text-left px-3 py-1.5 font-medium">Steuer</th>
            <th className="text-left px-3 py-1.5 font-medium">Fällig</th>
            <th className="text-left px-3 py-1.5 font-medium">Kommentar</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((t) => {
            const overdue = isOverdue(t.dueDate, t.status);
            const sb = STATUS_BADGE[t.status];
            return (
              <tr key={t.id} className="hover:bg-muted/30">
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(t.date)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{TYPE_LABEL[t.type]}</td>
                <td className="px-3 py-1.5">
                  <Link href={`/objects/deals/${t.dealRecordId}`} className="hover:underline">
                    {t.dealNumber ? <span className="font-mono text-xs mr-1.5">{t.dealNumber}</span> : null}
                    <span className="text-xs">{t.dealName}</span>
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtEUR(t.amount)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{fmtEUR(t.amountPaid)}</td>
                {showOutstanding && (
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right tabular-nums",
                      t.amountOutstanding > 0 && "text-amber-700 font-medium"
                    )}
                  >
                    {fmtEUR(t.amountOutstanding)}
                  </td>
                )}
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span className={cn("inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium", sb.cls)}>
                    {sb.label}
                  </span>
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {t.hasReceipt ? (
                    <a
                      href={`/api/v1/employee-transactions/${t.id}/receipt`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      title="Beleg ansehen"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      ansehen
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                  {t.isTaxDeductible ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700">
                      <Scale className="h-3 w-3" />
                      abz.
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ShieldOff className="h-3 w-3" />
                      nicht abz.
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                  {t.dueDate ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        overdue ? "text-red-600 font-medium" : "text-muted-foreground"
                      )}
                    >
                      <CalendarClock className="h-3 w-3" />
                      {fmtDate(t.dueDate)}
                      {overdue && " (überfällig)"}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground max-w-[24ch] truncate" title={[t.description, t.notes].filter(Boolean).join(" – ") || undefined}>
                  {[t.description, t.notes].filter(Boolean).join(" – ") || "—"}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {t.status !== "bezahlt" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRecordPayment(t.id)}
                      className="h-7 text-xs"
                    >
                      + Zahlung
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
