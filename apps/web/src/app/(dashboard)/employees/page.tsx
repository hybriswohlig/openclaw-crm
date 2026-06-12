"use client";

import { useRef, useState, useEffect, useCallback, Fragment } from "react";
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
  Eye,
  Scale,
  ShieldOff,
  ArrowRightLeft,
  Building2,
  Package,
  KeyRound,
  Copy,
  Check,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import { cn } from "@/lib/utils";
import { prepareReceiptDataUrl } from "@/lib/receipt-image";

async function saveErrorDescription(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return "Bitte erneut versuchen.";
}

interface Employee {
  id: string;
  name: string;
  experience: string | null;
  hourlyRate: string;
  photoBase64: string | null;
  createdAt: string;
  contractCount: number;
  saldoTotal: number;
  userId: string | null;
  username: string | null;
  hasAccount: boolean;
  hasPasswordSet: boolean;
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

type LedgerKind = "earning" | "reimbursement" | "payment" | "in_kind";

interface LedgerRow {
  id: string;
  date: string;
  kind: LedgerKind;
  amount: number;
  signedAmount: number;
  operatingCompanyId: string | null;
  operatingCompanyName: string;
  payingOperatingCompanyId: string | null;
  payingOperatingCompanyName: string | null;
  isCrossSubsidy: boolean;
  dealRecordId: string | null;
  dealNumber: string | null;
  dealName: string | null;
  paymentMethod: string | null;
  description: string | null;
  notes: string | null;
  isTaxDeductible: boolean;
  hasReceipt: boolean;
  dueDate: string | null;
}

interface CompanySaldo {
  companyId: string | null;
  companyName: string;
  earned: number;
  paid: number;
  balance: number;
}

interface EmployeeDetail {
  auftraege: AuftragRow[];
  ledger: LedgerRow[];
  saldoTotal: number;
  saldoByCompany: CompanySaldo[];
  totals: {
    earnedTotal: number;
    paidTotal: number;
    reimbursementTotal: number;
    inKindTotal: number;
    receiptCount: number;
  };
}

interface OperatingCompany {
  id: string;
  name: string;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  earning: "Verdienst",
  reimbursement: "Erstattung",
  payment: "Auszahlung",
  in_kind: "Sachbezug",
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Bar",
  bank_transfer: "Überweisung",
  other: "Sonstiges",
};

function fmtEUR(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "·";
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("de-DE");
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<OperatingCompany[]>([]);
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

  // Ledger entry dialog
  const [ledgerDialog, setLedgerDialog] = useState<{
    employeeId: string;
    entry: LedgerRow | null;
    defaultKind: LedgerKind;
  } | null>(null);

  // `silent` refreshes do NOT toggle the full-page loading spinner. Without
  // this, refreshing after an action (e.g. creating a portal link) unmounts the
  // whole table — including the expanded card — and the just-shown setup link
  // disappears immediately.
  const fetchEmployees = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/v1/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.data || []);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
    fetch("/api/v1/operating-companies")
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d) => setCompanies(d.data || []))
      .catch(() => {});
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
      } else {
        toast.error("Speichern fehlgeschlagen", {
          description: await saveErrorDescription(res),
        });
      }
    } catch {
      toast.error("Speichern fehlgeschlagen", {
        description: "Netzwerkfehler. Bitte erneut versuchen.",
      });
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
    if (!confirm("Diesen Mitarbeiter löschen?")) return;
    try {
      const res = await fetch(`/api/v1/employees/${id}`, { method: "DELETE" });
      if (res.ok) fetchEmployees();
      else
        toast.error("Löschen nicht möglich", {
          description: "Es existieren noch Buchungen zu diesem Mitarbeiter.",
        });
    } catch {
      toast.error("Löschen fehlgeschlagen", { description: "Netzwerkfehler. Bitte erneut versuchen." });
    }
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
      auftraege: data.data?.auftraege ?? [],
      ledger: data.data?.ledger ?? [],
      saldoTotal: data.data?.saldoTotal ?? 0,
      saldoByCompany: data.data?.saldoByCompany ?? [],
      totals: data.data?.totals ?? { earnedTotal: 0, paidTotal: 0, reimbursementTotal: 0, inKindTotal: 0, receiptCount: 0 },
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

  async function afterLedgerChange(employeeId: string) {
    setLedgerDialog(null);
    await reloadDetail(employeeId);
    fetchEmployees(true); // refresh saldo column silently (keep row expanded)
  }

  async function deleteEntry(employeeId: string, entryId: string) {
    if (!confirm("Diese Buchung löschen?")) return;
    let res: Response;
    try {
      res = await fetch(`/api/v1/employee-ledger/${entryId}`, { method: "DELETE" });
    } catch {
      toast.error("Löschen fehlgeschlagen", { description: "Netzwerkfehler. Bitte erneut versuchen." });
      return;
    }
    if (res.ok) {
      await reloadDetail(employeeId);
      fetchEmployees(true);
    } else {
      toast.error("Löschen fehlgeschlagen");
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Mitarbeiter</h1>
        <Button
          onClick={() => {
            setEditId(null);
            setForm({ name: "", experience: "", hourlyRate: "", photoBase64: null });
            setShowForm(true);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Mitarbeiter hinzufügen
        </Button>
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
                <label className="text-xs text-muted-foreground">Erfahrung</label>
                <input
                  type="text"
                  value={form.experience}
                  onChange={(e) => setForm({ ...form, experience: e.target.value })}
                  placeholder="z.B. 5 Jahre, Senior"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Stundenlohn (EUR) *</label>
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
              {editId ? "Aktualisieren" : "Anlegen"}
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

      {employees.length === 0 ? (
        <p className="text-muted-foreground text-sm">Noch keine Mitarbeiter. Lege oben den ersten an.</p>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-4 py-3 font-medium w-8" />
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Erfahrung</th>
                <th className="text-right px-4 py-3 font-medium">Stundenlohn</th>
                <th className="text-right px-4 py-3 font-medium">Aufträge</th>
                <th className="text-right px-4 py-3 font-medium">Saldo (offen)</th>
                <th className="text-right px-4 py-3 font-medium w-24" />
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <Fragment key={emp.id}>
                  <tr
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
                    <td className="px-4 py-3 text-muted-foreground">{emp.experience || "·"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtEUR(Number(emp.hourlyRate))}</td>
                    <td className="px-4 py-3 text-right">{emp.contractCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      <SaldoBadge value={emp.saldoTotal} />
                    </td>
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
                      <td colSpan={7} className="bg-muted/10 px-6 py-4 space-y-5">
                        <PortalAccessSection emp={emp} onChanged={() => fetchEmployees(true)} />
                        {!detail ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Lade Details…
                          </div>
                        ) : (
                          <EmployeeDetailView
                            detail={detail}
                            onAddEntry={(defaultKind) =>
                              setLedgerDialog({ employeeId: emp.id, entry: null, defaultKind })
                            }
                            onEditEntry={(entry) =>
                              setLedgerDialog({ employeeId: emp.id, entry, defaultKind: entry.kind })
                            }
                            onDeleteEntry={(entryId) => deleteEntry(emp.id, entryId)}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ledgerDialog && (
        <LedgerEntryDialog
          employeeId={ledgerDialog.employeeId}
          entry={ledgerDialog.entry}
          defaultKind={ledgerDialog.defaultKind}
          companies={companies}
          onClose={() => setLedgerDialog(null)}
          onSaved={() => afterLedgerChange(ledgerDialog.employeeId)}
        />
      )}
    </div>
  );
}

// ─── Portal-Zugang (Mitarbeiter-App Account) ────────────────────────────────────

function slugUsername(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 20);
}

function PortalAccessSection({ emp, onChanged }: { emp: Employee; onChanged: () => void }) {
  const [username, setUsername] = useState(emp.username ?? slugUsername(emp.name));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The API returns errors as { error: { code, message } }. Extract a string.
  function errMsg(data: unknown, status: number): string {
    const e = (data as { error?: unknown } | null)?.error;
    if (typeof e === "string") return e;
    if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
    return `Fehler (${status}). Bitte erneut versuchen.`;
  }

  async function call(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    setSetupUrl(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      let data: { data?: { setupUrl?: string } } | null = null;
      try {
        data = await res.json();
      } catch {
        /* non-JSON (e.g. 500 HTML) */
      }
      if (!res.ok) {
        setError(errMsg(data, res.status));
        return;
      }
      if (!data?.data?.setupUrl) {
        setError("Unerwartete Antwort vom Server.");
        return;
      }
      setSetupUrl(data.data.setupUrl);
      onChanged();
    } catch (e) {
      setError("Netzwerkfehler: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function create() {
    return call(`/api/v1/employees/${emp.id}/account`, { username });
  }

  function reset() {
    return call(`/api/v1/employees/${emp.id}/account/reset`);
  }

  function copy() {
    if (!setupUrl) return;
    navigator.clipboard?.writeText(setupUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2 mb-2">
        <Smartphone className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Portal-Zugang (Mitarbeiter-App)
        </h4>
        {emp.hasAccount && (
          <span
            className={cn(
              "ml-auto inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
              emp.hasPasswordSet
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            )}
          >
            {emp.hasPasswordSet ? "Aktiv" : "Wartet auf Passwort"}
          </span>
        )}
      </div>

      {!emp.hasAccount ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Lege einen Login an. {emp.name} setzt das Passwort über den Link selbst.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-muted-foreground mb-1 block">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder="z.B. mehmet"
              />
            </div>
            <Button size="sm" onClick={create} disabled={busy || username.length < 3}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5 mr-1.5" />}
              Zugang erstellen
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Username: <span className="font-mono text-foreground">{emp.username}</span>
          </p>
          <Button size="sm" variant="outline" onClick={reset} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5 mr-1.5" />}
            Neuen Passwort-Link erzeugen
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive mt-2">{error}</p>}

      {setupUrl && (
        <div className="mt-3 rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground mb-1.5">
            Diesen Link an {emp.name} geben (öffnet er am Handy, setzt sein Passwort):
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[11px] break-all bg-background rounded px-2 py-1.5 border border-border">
              {setupUrl}
            </code>
            <Button size="sm" variant="outline" onClick={copy} className="shrink-0">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Saldo badge ─────────────────────────────────────────────────────────────

function SaldoBadge({ value, small }: { value: number; small?: boolean }) {
  // Positive = wir schulden (amber). ~0 = ausgeglichen (muted). Negative = überzahlt (emerald).
  const positive = value > 0.005;
  const negative = value < -0.005;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 font-medium tabular-nums",
        small ? "text-xs" : "text-sm",
        positive && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        negative && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        !positive && !negative && "text-muted-foreground"
      )}
      title={positive ? "Wir schulden dem Mitarbeiter" : negative ? "Überzahlt (Mitarbeiter schuldet uns)" : "Ausgeglichen"}
    >
      {fmtEUR(value)}
    </span>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function EmployeeDetailView({
  detail,
  onAddEntry,
  onEditEntry,
  onDeleteEntry,
}: {
  detail: EmployeeDetail;
  onAddEntry: (kind: LedgerKind) => void;
  onEditEntry: (entry: LedgerRow) => void;
  onDeleteEntry: (entryId: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Saldo block */}
      <div className="rounded-lg border border-border bg-background p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Saldo gesamt (firmenübergreifend)</p>
            <div className="flex items-center gap-2">
              <SaldoBadge value={detail.saldoTotal} />
              <span className="text-xs text-muted-foreground">
                {detail.saldoTotal > 0.005
                  ? "offen, das schulden wir noch"
                  : detail.saldoTotal < -0.005
                  ? "überzahlt"
                  : "ausgeglichen"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.saldoByCompany.map((c) => (
                <span
                  key={c.companyId ?? "unassigned"}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
                >
                  <Building2 className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">{c.companyName}:</span>
                  <span
                    className={cn(
                      "font-medium tabular-nums",
                      c.balance > 0.005 && "text-amber-700 dark:text-amber-400",
                      c.balance < -0.005 && "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    {fmtEUR(c.balance)}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 items-end">
            <Button size="sm" onClick={() => onAddEntry("payment")}>
              <Wallet className="h-3.5 w-3.5 mr-1.5" />
              Zahlung erfassen
            </Button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => onAddEntry("earning")}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Verdienst
              </Button>
              <Button size="sm" variant="outline" onClick={() => onAddEntry("reimbursement")}>
                <Receipt className="h-3.5 w-3.5 mr-1" />
                Beleg
              </Button>
              <Button size="sm" variant="outline" onClick={() => onAddEntry("in_kind")}>
                <Package className="h-3.5 w-3.5 mr-1" />
                Sachbezug
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground border-t border-border pt-3">
          <span>Verdient gesamt: <span className="font-medium text-foreground">{fmtEUR(detail.totals.earnedTotal)}</span></span>
          <span>Ausgezahlt gesamt: <span className="font-medium text-foreground">{fmtEUR(detail.totals.paidTotal)}</span></span>
          {detail.totals.inKindTotal > 0.005 && (
            <span>Sachbezug gesamt: <span className="font-medium text-foreground">{fmtEUR(detail.totals.inKindTotal)}</span></span>
          )}
          <span>Belege (Erstattungen): <span className="font-medium text-foreground">{fmtEUR(detail.totals.reimbursementTotal)}</span></span>
          <span>Belege angehängt: <span className="font-medium text-foreground">{detail.totals.receiptCount}</span></span>
        </div>
      </div>

      {/* Aufträge */}
      <DetailSection title="Aufträge" icon={<Briefcase className="h-4 w-4" />} count={detail.auftraege.length}>
        {detail.auftraege.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 px-1">Noch keine Aufträge zugewiesen.</p>
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

      {/* Buchungsverlauf */}
      <DetailSection title="Buchungsverlauf" icon={<Wallet className="h-4 w-4" />} count={detail.ledger.length}>
        {detail.ledger.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2 px-1">Noch keine Buchungen.</p>
        ) : (
          <LedgerTable rows={detail.ledger} onEdit={onEditEntry} onDelete={onDeleteEntry} />
        )}
      </DetailSection>
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

function LedgerTable({
  rows,
  onEdit,
  onDelete,
}: {
  rows: LedgerRow[];
  onEdit: (entry: LedgerRow) => void;
  onDelete: (entryId: string) => void;
}) {
  return (
    <div className="rounded-md border border-border bg-background overflow-x-auto">
      <table className="w-full text-sm min-w-[760px]">
        <thead className="bg-muted/40">
          <tr className="text-xs text-muted-foreground">
            <th className="text-left px-3 py-1.5 font-medium">Datum</th>
            <th className="text-left px-3 py-1.5 font-medium">Art</th>
            <th className="text-left px-3 py-1.5 font-medium">Firma</th>
            <th className="text-left px-3 py-1.5 font-medium">Auftrag</th>
            <th className="text-right px-3 py-1.5 font-medium">Betrag</th>
            <th className="text-left px-3 py-1.5 font-medium">Zahlart</th>
            <th className="text-left px-3 py-1.5 font-medium">Beleg</th>
            <th className="text-left px-3 py-1.5 font-medium">Steuer</th>
            <th className="text-left px-3 py-1.5 font-medium">Kommentar</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((t) => {
            const isDebit = t.kind === "payment" || t.kind === "in_kind";
            return (
              <tr key={t.id} className="hover:bg-muted/30">
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(t.date)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span
                    className={cn(
                      "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium",
                      t.kind === "payment" && "bg-blue-500/15 text-blue-700 dark:text-blue-400",
                      t.kind === "earning" && "bg-orange-500/15 text-orange-700 dark:text-orange-400",
                      t.kind === "reimbursement" && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
                      t.kind === "in_kind" && "bg-violet-500/15 text-violet-700 dark:text-violet-400"
                    )}
                  >
                    {KIND_LABEL[t.kind]}
                  </span>
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                  <span className="text-muted-foreground">{t.operatingCompanyName}</span>
                  {t.isCrossSubsidy && t.payingOperatingCompanyName && (
                    <span
                      className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-amber-700 dark:text-amber-500"
                      title={`Bezahlt von ${t.payingOperatingCompanyName} (Quersubvention)`}
                    >
                      <ArrowRightLeft className="h-2.5 w-2.5" />
                      {t.payingOperatingCompanyName}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  {t.dealRecordId ? (
                    <Link href={`/objects/deals/${t.dealRecordId}`} className="hover:underline">
                      {t.dealNumber ? <span className="font-mono mr-1.5">{t.dealNumber}</span> : null}
                      <span>{t.dealName}</span>
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">frei</span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right tabular-nums font-medium",
                    t.kind === "payment" && "text-blue-700 dark:text-blue-400",
                    t.kind === "in_kind" && "text-violet-700 dark:text-violet-400",
                    !isDebit && "text-foreground"
                  )}
                >
                  {isDebit ? "−" : "+"}
                  {fmtEUR(t.amount)}
                </td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                  {t.paymentMethod ? METHOD_LABEL[t.paymentMethod] ?? t.paymentMethod : "·"}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {t.hasReceipt ? (
                    <button
                      type="button"
                      onClick={() => window.open(`/api/v1/financial/receipt?type=ledger&id=${t.id}`, "_blank", "noopener,noreferrer")}
                      className="p-1 rounded hover:bg-muted text-primary"
                      title="Beleg öffnen"
                      aria-label="Beleg öffnen"
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">·</span>
                  )}
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                  {t.isTaxDeductible ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <Scale className="h-3 w-3" />
                      abz.
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <ShieldOff className="h-3 w-3" />
                      nicht
                    </span>
                  )}
                </td>
                <td
                  className="px-3 py-1.5 text-xs text-muted-foreground max-w-[22ch] truncate"
                  title={[t.description, t.notes].filter(Boolean).join(" · ") || undefined}
                >
                  {[t.description, t.notes].filter(Boolean).join(" · ") || "·"}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  <button
                    onClick={() => onEdit(t)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    title="Bearbeiten"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(t.id)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                    title="Löschen"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Ledger entry dialog (create / edit) ────────────────────────────────────

function LedgerEntryDialog({
  employeeId,
  entry,
  defaultKind,
  companies,
  onClose,
  onSaved,
}: {
  employeeId: string;
  entry: LedgerRow | null;
  defaultKind: LedgerKind;
  companies: OperatingCompany[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    kind: entry?.kind ?? defaultKind,
    date: entry?.date ?? new Date().toISOString().slice(0, 10),
    amount: entry ? String(entry.amount.toFixed(2)) : "",
    operatingCompanyId: entry?.operatingCompanyId ?? (companies[0]?.id ?? ""),
    payingOperatingCompanyId: entry?.payingOperatingCompanyId ?? "",
    paymentMethod: entry?.paymentMethod ?? "cash",
    description: entry?.description ?? "",
    isTaxDeductible: entry?.isTaxDeductible ?? true,
    receiptFile: null as string | null,
    receiptName: entry?.hasReceipt ? "Vorhandener Beleg" : "",
  });

  const isPayment = form.kind === "payment";
  const isDebit = form.kind === "payment" || form.kind === "in_kind";

  async function handleReceiptPick(file: File) {
    try {
      const dataUrl = await prepareReceiptDataUrl(file);
      setForm((f) => ({ ...f, receiptFile: dataUrl, receiptName: file.name }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSave() {
    if (!form.date || !form.amount || Number(form.amount) <= 0) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        kind: form.kind,
        date: form.date,
        amount: form.amount,
        operatingCompanyId: form.operatingCompanyId || null,
        payingOperatingCompanyId: form.payingOperatingCompanyId || null,
        paymentMethod: isPayment ? form.paymentMethod || null : null,
        description: form.description || null,
        isTaxDeductible: form.isTaxDeductible,
      };
      if (form.receiptFile !== null) payload.receiptFile = form.receiptFile;

      let res: Response;
      if (entry) {
        res = await fetch(`/api/v1/employee-ledger/${entry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/v1/employees/${employeeId}/ledger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      if (res.ok) {
        toast.success("Buchung gespeichert");
        onSaved();
      } else {
        toast.error("Buchung konnte nicht gespeichert werden", {
          description: await saveErrorDescription(res),
        });
      }
    } catch {
      toast.error("Buchung konnte nicht gespeichert werden", {
        description: "Netzwerkfehler. Bitte erneut versuchen.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {entry ? "Buchung bearbeiten" : "Buchung erfassen"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Kind selector */}
        <div className="grid grid-cols-2 gap-2">
          {(["payment", "earning", "reimbursement", "in_kind"] as LedgerKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setForm((f) => ({ ...f, kind: k }))}
              className={cn(
                "rounded-md border px-2 py-2 text-xs font-medium transition",
                form.kind === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/40"
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground -mt-2">
          {form.kind === "payment"
            ? "Auszahlung an den Mitarbeiter, senkt den Saldo."
            : form.kind === "earning"
            ? "Verdienst (Lohn), erhöht den Saldo (wir schulden)."
            : form.kind === "reimbursement"
            ? "Beleg / Auslage des Mitarbeiters (z.B. Sprit), erhöht den Saldo."
            : "Sachbezug: du kaufst dem Mitarbeiter etwas (z.B. Werkzeug) und verrechnest es gegen den Lohn. Senkt den Saldo. Kaufbeleg optional."}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Datum *</label>
            <input
              type="date"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Betrag (€) *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {isDebit ? "Firma (deren Schuld wird beglichen) *" : "Firma (Auftrags-/Kostenfirma) *"}
            </label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.operatingCompanyId}
              onChange={(e) => setForm((f) => ({ ...f, operatingCompanyId: e.target.value }))}
            >
              <option value="">Bitte wählen</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Bezahlt von anderer Firma</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.payingOperatingCompanyId}
              onChange={(e) => setForm((f) => ({ ...f, payingOperatingCompanyId: e.target.value }))}
            >
              <option value="">(gleiche Firma)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
        {form.payingOperatingCompanyId &&
          form.payingOperatingCompanyId !== form.operatingCompanyId && (
            <p className="text-[11px] text-amber-700 dark:text-amber-500 -mt-1 inline-flex items-center gap-1">
              <ArrowRightLeft className="h-3 w-3" />
              Quersubvention, fließt in den 50/50-Ausgleich zwischen den Firmen ein.
            </p>
          )}

        {isPayment && (
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Zahlungsart</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.paymentMethod}
              onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
            >
              <option value="cash">Bar</option>
              <option value="bank_transfer">Überweisung</option>
              <option value="other">Sonstiges</option>
            </select>
          </div>
        )}

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Kommentar</label>
          <input
            type="text"
            placeholder={isPayment ? "z.B. Restlohn Juni" : "z.B. Umzug Müller, 8h / Tankquittung"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </div>

        <div>
            <label className="text-xs text-muted-foreground mb-1 block">
              {form.kind === "in_kind"
                ? "Kaufbeleg (Bild oder PDF)"
                : form.kind === "payment"
                ? "Auszahlungsbeleg / Quittung (Bild oder PDF)"
                : "Beleg (Bild oder PDF)"}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:cursor-pointer hover:file:bg-muted"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleReceiptPick(f);
                }}
              />
              {form.receiptName && (
                <span className="text-[11px] text-muted-foreground shrink-0 max-w-[120px] truncate">
                  {form.receiptName}
                </span>
              )}
            </div>
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-input"
            checked={form.isTaxDeductible}
            onChange={(e) => setForm((f) => ({ ...f, isTaxDeductible: e.target.checked }))}
          />
          Steuerlich absetzbar
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button
            onClick={handleSave}
            disabled={saving || !form.date || !form.amount || Number(form.amount) <= 0}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Speichern
          </Button>
        </div>
      </div>
    </div>
  );
}
