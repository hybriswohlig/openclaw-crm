"use client";

import { useState, useEffect, useCallback } from "react";
import { DocumentPreviewModal } from "@/components/documents/document-preview-modal";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Upload,
  Download,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { prepareReceiptDataUrl } from "@/lib/receipt-image";
import { EXPENSE_CATEGORIES, EXPENSE_TAX_TREATMENT_LABELS } from "@/lib/expense-categories";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfitSummary {
  revenue: number;
  costs: {
    expenses: { total: number; byCategory: Record<string, number> };
    employees: { total: number; byPerson: Array<{ name: string; total: number }> };
    total: number;
  };
  profit: number;
  margin: number | null;
}

interface Payment {
  id: string;
  date: string;
  amount: string;
  payer: string | null;
  paymentMethod: string | null;
  reference: string | null;
  notes: string | null;
  receiptNumber: string | null;
}

type ExpenseTaxTreatment = "voll" | "teilweise" | "nicht";

interface Expense {
  id: string;
  date: string;
  amount: string;
  category: string;
  description: string | null;
  recipient: string | null;
  paymentMethod: string | null;
  taxTreatment: ExpenseTaxTreatment;
  deductiblePercent: number | null;
  receiptNumber: string | null;
  hasReceipt: boolean;
  payingOperatingCompanyId: string | null;
}

interface EmployeeCost {
  id: string;
  date: string;
  employeeId: string;
  employeeName: string;
  kind: "earning" | "reimbursement" | "payment" | "in_kind";
  amount: string;
  description: string | null;
  paymentMethod: "cash" | "bank_transfer" | "other" | null;
  isTaxDeductible: boolean;
  payingOperatingCompanyId: string | null;
  operatingCompanyId: string | null;
  receiptFile: string | null;
  hasReceipt?: boolean;
}

interface OperatingCompany {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  name: string;
  hourlyRate: string;
}

interface DealDocument {
  id: string;
  documentType:
    | "order_confirmation"
    | "invoice"
    | "payment_confirmation"
    | "worker_instructions";
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eur(n: number | string) {
  return Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

async function saveErrorDescription(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return "Bitte erneut versuchen.";
}

// Fallback-Labels für Alt-Einträge, deren Kategorie nicht (mehr) in der
// zentralen Liste vorkommt. Picker und Anzeige nutzen EXPENSE_CATEGORIES.
const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Kraftstoff",
  truck_rental: "LKW-Miete",
  equipment: "Ausstattung",
  subcontractor: "Subunternehmer",
  toll: "Maut",
  other: "Sonstiges",
};

const LIB_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label])
);

function expenseCategoryLabel(category: string) {
  return LIB_CATEGORY_LABELS[category] ?? CATEGORY_LABELS[category] ?? category;
}

/** Kompakte Anzeige der steuerlichen Behandlung: "voll" / "70%" / "nicht". */
function expenseTreatmentCompact(e: Expense) {
  const t = e.taxTreatment ?? "voll";
  if (t === "teilweise") return `${e.deductiblePercent ?? 70}%`;
  return t;
}

const TYPE_LABELS: Record<string, string> = {
  earning: "Verdienst",
  reimbursement: "Erstattung",
  payment: "Auszahlung",
  in_kind: "Sachbezug",
};

// ─── Profit KPIs ─────────────────────────────────────────────────────────────

function ProfitKPIs({ profit }: { profit: ProfitSummary }) {
  const isPositive = profit.profit > 0;
  const isNeutral = profit.profit === 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Einnahmen</p>
          <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
        </div>
        <p className="text-xl font-semibold text-emerald-600 dark:text-emerald-400">
          {eur(profit.revenue)}
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Ausgaben</p>
          <TrendingDown className="h-3.5 w-3.5 text-red-500" />
        </div>
        <p className="text-xl font-semibold text-red-600 dark:text-red-400">
          {eur(profit.costs.expenses.total)}
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Personalkosten</p>
          <TrendingDown className="h-3.5 w-3.5 text-orange-500" />
        </div>
        <p className="text-xl font-semibold text-orange-600 dark:text-orange-400">
          {eur(profit.costs.employees.total)}
        </p>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-muted-foreground">Gewinn</p>
          {isPositive ? (
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
          ) : isNeutral ? (
            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ArrowDownRight className="h-3.5 w-3.5 text-red-500" />
          )}
        </div>
        <p
          className={`text-xl font-semibold ${
            isPositive
              ? "text-emerald-600 dark:text-emerald-400"
              : isNeutral
                ? "text-muted-foreground"
                : "text-red-600 dark:text-red-400"
          }`}
        >
          {eur(profit.profit)}
        </p>
        {profit.margin !== null && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {profit.margin}% Marge
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Payments Section ─────────────────────────────────────────────────────────

function PaymentsSection({
  recordId,
  payments,
  dealValue,
  onChanged,
}: {
  recordId: string;
  payments: Payment[];
  dealValue: number | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    date: "",
    amount: "",
    payer: "",
    paymentMethod: "",
    reference: "",
    notes: "",
  });

  function openAdd() {
    setEditing(null);
    setForm({ date: new Date().toISOString().slice(0, 10), amount: "", payer: "", paymentMethod: "", reference: "", notes: "" });
    setOpen(true);
  }

  function openEdit(p: Payment) {
    setEditing(p);
    setForm({
      date: p.date,
      amount: String(Number(p.amount).toFixed(2)),
      payer: p.payer ?? "",
      paymentMethod: p.paymentMethod ?? "",
      reference: p.reference ?? "",
      notes: p.notes ?? "",
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.date || !form.amount) return;
    setSaving(true);
    try {
      const body = {
        date: form.date,
        amount: form.amount,
        payer: form.payer || null,
        paymentMethod: form.paymentMethod || null,
        reference: form.reference || null,
        notes: form.notes || null,
      };
      let res: Response;
      if (editing) {
        res = await fetch(`/api/v1/deals/${recordId}/payments/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/v1/deals/${recordId}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        toast.error("Buchung konnte nicht gespeichert werden", {
          description: await saveErrorDescription(res),
        });
        return;
      }
      toast.success("Buchung gespeichert");
      setOpen(false);
      onChanged();
    } catch {
      toast.error("Buchung konnte nicht gespeichert werden", {
        description: "Netzwerkfehler. Bitte erneut versuchen.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Zahlung löschen?")) return;
    let res: Response;
    try {
      res = await fetch(`/api/v1/deals/${recordId}/payments/${id}`, { method: "DELETE" });
    } catch {
      toast.error("Löschen fehlgeschlagen", { description: "Netzwerkfehler. Bitte erneut versuchen." });
      return;
    }
    if (!res.ok) {
      toast.error("Löschen fehlgeschlagen");
      return;
    }
    onChanged();
  }

  const totalPaid = payments.reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = dealValue != null ? Math.max(0, dealValue - totalPaid) : null;
  const progress = dealValue && dealValue > 0 ? Math.min(100, (totalPaid / dealValue) * 100) : null;
  const fullyPaid = dealValue != null && totalPaid + 0.005 >= dealValue;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">
          Zahlungseingänge
          {payments.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {eur(totalPaid)} gesamt
            </span>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Hinzufügen
        </Button>
      </div>

      {dealValue != null && dealValue > 0 && (
        <div className="mb-3 rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              <span className="font-medium text-foreground">{eur(totalPaid)}</span>
              {" von "}
              <span className="font-medium text-foreground">{eur(dealValue)}</span>
              {" bezahlt"}
            </span>
            <span className={`font-medium tabular-nums ${fullyPaid ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
              {fullyPaid ? "Vollständig bezahlt" : `${eur(outstanding ?? 0)} offen`}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${fullyPaid ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${progress ?? 0}%` }}
            />
          </div>
        </div>
      )}

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Noch keine Zahlungen eingetragen
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Datum</th>
                <th className="text-left px-3 py-2 font-medium">Zahler</th>
                <th className="text-left px-3 py-2 font-medium">Methode</th>
                <th className="text-left px-3 py-2 font-medium">Referenz</th>
                <th className="text-right px-3 py-2 font-medium">Betrag</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                    {fmtDate(p.date)}
                    {p.receiptNumber && (
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                        {p.receiptNumber}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{p.payer ?? "·"}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{p.paymentMethod ?? "·"}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs max-w-[120px] truncate">{p.reference ?? "·"}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                    {eur(p.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => openEdit(p)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Zahlung bearbeiten" : "Zahlung hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
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
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Zahler</label>
              <input
                type="text"
                placeholder="Kundenname"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.payer}
                onChange={(e) => setForm((f) => ({ ...f, payer: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Zahlungsart</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.paymentMethod}
                  onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                >
                  <option value="">(keine Angabe)</option>
                  <option value="bar">Bar</option>
                  <option value="ueberweisung">Überweisung</option>
                  <option value="karte">Karte</option>
                  <option value="paypal">PayPal</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Referenz</label>
                <input
                  type="text"
                  placeholder="Rechnungsnummer o.ä."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.reference}
                  onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notiz</label>
              <textarea
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saving || !form.date || !form.amount}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── Expenses Section ─────────────────────────────────────────────────────────

function ExpensesSection({
  recordId,
  expenses,
  operatingCompanies,
  onChanged,
}: {
  recordId: string;
  expenses: Expense[];
  operatingCompanies: OperatingCompany[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    date: "",
    amount: "",
    category: "other",
    description: "",
    recipient: "",
    paymentMethod: "",
    taxTreatment: "voll" as ExpenseTaxTreatment,
    deductiblePercent: "70",
    payingOperatingCompanyId: "",
    receiptFile: null as string | null,
    receiptName: "" as string,
  });

  const categoryDef = EXPENSE_CATEGORIES.find((c) => c.value === form.category);

  function openAdd() {
    setEditing(null);
    const def = EXPENSE_CATEGORIES.find((c) => c.value === "other");
    setForm({ date: new Date().toISOString().slice(0, 10), amount: "", category: "other", description: "", recipient: "", paymentMethod: "", taxTreatment: def?.defaultTreatment ?? "voll", deductiblePercent: String(def?.defaultPercent ?? 70), payingOperatingCompanyId: "", receiptFile: null, receiptName: "" });
    setOpen(true);
  }

  function openEdit(e: Expense) {
    setEditing(e);
    const def = EXPENSE_CATEGORIES.find((c) => c.value === e.category);
    setForm({
      date: e.date,
      amount: String(Number(e.amount).toFixed(2)),
      category: e.category,
      description: e.description ?? "",
      recipient: e.recipient ?? "",
      paymentMethod: e.paymentMethod ?? "",
      taxTreatment: e.taxTreatment ?? "voll",
      deductiblePercent: String(e.deductiblePercent ?? def?.defaultPercent ?? 70),
      payingOperatingCompanyId: e.payingOperatingCompanyId ?? "",
      receiptFile: null,
      receiptName: e.hasReceipt ? "Vorhandener Beleg" : "",
    });
    setOpen(true);
  }

  async function handleReceiptPick(file: File) {
    try {
      const dataUrl = await prepareReceiptDataUrl(file);
      setForm((f) => ({ ...f, receiptFile: dataUrl, receiptName: file.name }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSave() {
    if (!form.date || !form.amount) return;
    const deductiblePercent = Number(form.deductiblePercent);
    if (
      form.taxTreatment === "teilweise" &&
      (!Number.isFinite(deductiblePercent) || deductiblePercent < 1 || deductiblePercent > 99)
    ) {
      toast.error("Buchung konnte nicht gespeichert werden", {
        description: "Absetzbarer Anteil muss zwischen 1 und 99 Prozent liegen.",
      });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        date: form.date,
        amount: form.amount,
        category: form.category,
        description: form.description || null,
        recipient: form.recipient || null,
        paymentMethod: form.paymentMethod || null,
        taxTreatment: form.taxTreatment,
        payingOperatingCompanyId: form.payingOperatingCompanyId || null,
      };
      if (form.taxTreatment === "teilweise") body.deductiblePercent = deductiblePercent;
      // Only send receiptFile when a new file was picked, so editing without
      // re-uploading keeps the existing Beleg.
      if (form.receiptFile !== null) body.receiptFile = form.receiptFile;
      let res: Response;
      if (editing) {
        res = await fetch(`/api/v1/deals/${recordId}/expenses/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/v1/deals/${recordId}/expenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        toast.error("Buchung konnte nicht gespeichert werden", {
          description: await saveErrorDescription(res),
        });
        return;
      }
      toast.success("Buchung gespeichert");
      setOpen(false);
      onChanged();
    } catch {
      toast.error("Buchung konnte nicht gespeichert werden", {
        description: "Netzwerkfehler. Bitte erneut versuchen.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Ausgabe löschen?")) return;
    let res: Response;
    try {
      res = await fetch(`/api/v1/deals/${recordId}/expenses/${id}`, { method: "DELETE" });
    } catch {
      toast.error("Löschen fehlgeschlagen", { description: "Netzwerkfehler. Bitte erneut versuchen." });
      return;
    }
    if (!res.ok) {
      toast.error("Löschen fehlgeschlagen");
      return;
    }
    onChanged();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">
          Ausgaben
          {expenses.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {eur(expenses.reduce((s, e) => s + Number(e.amount), 0))} gesamt
            </span>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Hinzufügen
        </Button>
      </div>

      {expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Noch keine Ausgaben eingetragen
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Datum</th>
                <th className="text-left px-3 py-2 font-medium">Kategorie</th>
                <th className="text-left px-3 py-2 font-medium">Beschreibung</th>
                <th className="text-left px-3 py-2 font-medium">Empfänger</th>
                <th className="text-left px-3 py-2 font-medium">Steuer</th>
                <th className="text-left px-3 py-2 font-medium">Beleg-Nr.</th>
                <th className="text-right px-3 py-2 font-medium">Betrag</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary" className="text-xs">
                      {expenseCategoryLabel(e.category)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">{e.description ?? "·"}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{e.recipient ?? "·"}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs whitespace-nowrap">
                    {expenseTreatmentCompact(e)}
                  </td>
                  <td className="px-3 py-2 font-mono text-muted-foreground text-xs whitespace-nowrap">
                    {e.receiptNumber ?? "·"}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-red-600 dark:text-red-400">
                    {eur(e.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      {e.hasReceipt && (
                        <button
                          onClick={() => window.open(`/api/v1/financial/receipt?type=expense&id=${e.id}`, "_blank", "noopener,noreferrer")}
                          className="p-1 rounded hover:bg-muted text-primary"
                          title="Beleg ansehen"
                          aria-label="Beleg ansehen"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(e)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(e.id)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Ausgabe bearbeiten" : "Ausgabe hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
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
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Kategorie</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.category}
                onChange={(e) => {
                  const def = EXPENSE_CATEGORIES.find((c) => c.value === e.target.value);
                  setForm((f) => ({
                    ...f,
                    category: e.target.value,
                    taxTreatment: def?.defaultTreatment ?? f.taxTreatment,
                    deductiblePercent: String(def?.defaultPercent ?? 70),
                  }));
                }}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
                {!EXPENSE_CATEGORIES.some((c) => c.value === form.category) && (
                  <option value={form.category}>{expenseCategoryLabel(form.category)}</option>
                )}
              </select>
              {categoryDef?.hint && (
                <p className="text-[11px] text-muted-foreground mt-1">{categoryDef.hint}</p>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Beschreibung</label>
              <input
                type="text"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Empfänger</label>
                <input
                  type="text"
                  placeholder="Tankstelle, Vermieter…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.recipient}
                  onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Zahlungsart</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.paymentMethod}
                  onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                >
                  <option value="">(keine Angabe)</option>
                  <option value="bar">Bar</option>
                  <option value="ueberweisung">Überweisung</option>
                  <option value="karte">Karte</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Bezahlt durch andere Firma</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.payingOperatingCompanyId}
                  onChange={(e) => setForm((f) => ({ ...f, payingOperatingCompanyId: e.target.value }))}
                >
                  <option value="">(Standard: Auftragsfirma)</option>
                  {operatingCompanies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Steuerliche Behandlung</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
                  value={form.taxTreatment}
                  disabled={categoryDef?.locked ?? false}
                  onChange={(e) => setForm((f) => ({ ...f, taxTreatment: e.target.value as ExpenseTaxTreatment }))}
                >
                  {(["voll", "teilweise", "nicht"] as const).map((t) => (
                    <option key={t} value={t}>{EXPENSE_TAX_TREATMENT_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>
            {form.taxTreatment === "teilweise" && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Absetzbarer Anteil (%)</label>
                <input
                  type="number"
                  min="1"
                  max="99"
                  step="1"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.deductiblePercent}
                  onChange={(e) => setForm((f) => ({ ...f, deductiblePercent: e.target.value }))}
                />
              </div>
            )}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Beleg / Rechnung (Bild oder PDF)</label>
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
                {form.receiptFile && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, receiptFile: null, receiptName: "" }))}
                    className="text-xs text-muted-foreground hover:text-destructive shrink-0"
                  >
                    Entfernen
                  </button>
                )}
              </div>
              {form.receiptName && (
                <p className="text-[11px] text-muted-foreground mt-1 truncate">{form.receiptName}</p>
              )}
              {editing?.hasReceipt && (
                <a
                  href={`/api/v1/financial/receipt?type=expense&id=${editing.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline mt-1"
                >
                  <FileText className="h-3 w-3" />
                  Vorhandenen Beleg ansehen
                </a>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saving || !form.date || !form.amount}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── Employee Costs Section ───────────────────────────────────────────────────

function EmployeeCostsSection({
  recordId,
  costs,
  employees,
  operatingCompanies,
  onChanged,
}: {
  recordId: string;
  costs: EmployeeCost[];
  employees: Employee[];
  operatingCompanies: OperatingCompany[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeCost | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    employeeId: "",
    date: "",
    kind: "earning" as "earning" | "reimbursement" | "payment" | "in_kind",
    amount: "",
    description: "",
    paymentMethod: "" as "" | "cash" | "bank_transfer" | "other",
    isTaxDeductible: true,
    payingOperatingCompanyId: "",
    receiptFile: null as string | null,
    receiptName: "" as string,
  });

  function openAdd() {
    setEditing(null);
    setForm({
      employeeId: employees[0]?.id ?? "",
      date: new Date().toISOString().slice(0, 10),
      kind: "earning",
      amount: "",
      description: "",
      paymentMethod: "",
      isTaxDeductible: true,
      payingOperatingCompanyId: "",
      receiptFile: null,
      receiptName: "",
    });
    setOpen(true);
  }

  function openEdit(c: EmployeeCost) {
    setEditing(c);
    setForm({
      employeeId: c.employeeId,
      date: c.date,
      kind: c.kind,
      amount: String(Number(c.amount).toFixed(2)),
      description: c.description ?? "",
      paymentMethod: c.paymentMethod ?? "",
      isTaxDeductible: c.isTaxDeductible,
      payingOperatingCompanyId: c.payingOperatingCompanyId ?? "",
      receiptFile: c.receiptFile,
      receiptName: c.receiptFile ? "Vorhandener Beleg" : "",
    });
    setOpen(true);
  }

  async function handleReceiptPick(file: File) {
    try {
      const dataUrl = await prepareReceiptDataUrl(file);
      setForm((f) => ({ ...f, receiptFile: dataUrl, receiptName: file.name }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSave() {
    if (!form.employeeId || !form.date || !form.amount) return;
    setSaving(true);
    try {
      const body = {
        employeeId: form.employeeId,
        date: form.date,
        kind: form.kind,
        amount: form.amount,
        description: form.description || null,
        paymentMethod: form.kind === "payment" ? form.paymentMethod || null : null,
        isTaxDeductible: form.isTaxDeductible,
        payingOperatingCompanyId: form.payingOperatingCompanyId || null,
        receiptFile: form.receiptFile,
      };
      let res: Response;
      if (editing) {
        res = await fetch(`/api/v1/deals/${recordId}/employee-costs/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/v1/deals/${recordId}/employee-costs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      if (!res.ok) {
        toast.error("Buchung konnte nicht gespeichert werden", {
          description: await saveErrorDescription(res),
        });
        return;
      }
      toast.success("Buchung gespeichert");
      setOpen(false);
      onChanged();
    } catch {
      toast.error("Buchung konnte nicht gespeichert werden", {
        description: "Netzwerkfehler. Bitte erneut versuchen.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Eintrag löschen?")) return;
    let res: Response;
    try {
      res = await fetch(`/api/v1/deals/${recordId}/employee-costs/${id}`, { method: "DELETE" });
    } catch {
      toast.error("Löschen fehlgeschlagen", { description: "Netzwerkfehler. Bitte erneut versuchen." });
      return;
    }
    if (!res.ok) {
      toast.error("Löschen fehlgeschlagen");
      return;
    }
    onChanged();
  }

  // Saldo dieses Auftrags = Verdienste/Erstattungen (Gutschrift) − Auszahlungen/Sachbezüge (Lastschrift).
  const earned = costs
    .filter((c) => c.kind === "earning" || c.kind === "reimbursement")
    .reduce((s, c) => s + Number(c.amount), 0);
  const paid = costs
    .filter((c) => c.kind === "payment" || c.kind === "in_kind")
    .reduce((s, c) => s + Number(c.amount), 0);
  const labourCost = costs
    .filter((c) => c.kind === "earning")
    .reduce((s, c) => s + Number(c.amount), 0);
  const open0 = earned - paid;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">
          Personal
          {costs.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {eur(labourCost)} Lohnkosten · {eur(paid)} ausgezahlt · {eur(open0)} offen
            </span>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={openAdd} disabled={employees.length === 0}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Hinzufügen
        </Button>
      </div>

      {employees.length === 0 && (
        <p className="text-sm text-muted-foreground py-2">
          Zuerst Mitarbeiter unter Einstellungen anlegen.
        </p>
      )}

      {costs.length === 0 && employees.length > 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Noch nichts eingetragen. Verdienste, Belege oder Auszahlungen hinzufügen
        </p>
      ) : costs.length > 0 ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Datum</th>
                <th className="text-left px-3 py-2 font-medium">Mitarbeiter</th>
                <th className="text-left px-3 py-2 font-medium">Art</th>
                <th className="text-left px-3 py-2 font-medium">Beschreibung</th>
                <th className="text-right px-3 py-2 font-medium">Betrag</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => {
                const isDebit = c.kind === "payment" || c.kind === "in_kind";
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDate(c.date)}</td>
                    <td className="px-3 py-2 font-medium">{c.employeeName}</td>
                    <td className="px-3 py-2">
                      <Badge variant="secondary" className="text-xs">
                        {TYPE_LABELS[c.kind] ?? c.kind}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs max-w-[160px] truncate">
                      {c.description ?? "·"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">
                      <span className={isDebit ? "text-blue-600 dark:text-blue-400" : "text-orange-600 dark:text-orange-400"}>
                        {isDebit ? "−" : "+"}{eur(c.amount)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        {(c.hasReceipt ?? c.receiptFile != null) && (
                          <button
                            onClick={() => window.open(`/api/v1/financial/receipt?type=ledger&id=${c.id}`, "_blank", "noopener,noreferrer")}
                            className="p-1 rounded hover:bg-muted text-primary"
                            title="Beleg ansehen"
                            aria-label="Beleg ansehen"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => openEdit(c)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <Dialog open={open} onOpenChange={(v) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Eintrag bearbeiten" : "Personal-Buchung hinzufügen"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Mitarbeiter *</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.employeeId}
                onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({eur(emp.hourlyRate)}/h)
                  </option>
                ))}
              </select>
            </div>
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
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Art</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as typeof form.kind }))}
              >
                <option value="earning">Verdienst (Lohn), erhöht Saldo</option>
                <option value="reimbursement">Beleg / Auslage, erhöht Saldo</option>
                <option value="payment">Auszahlung, senkt Saldo</option>
                <option value="in_kind">Sachbezug (gegen Lohn verrechnet), senkt Saldo</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Beschreibung</label>
              <input
                type="text"
                placeholder="z.B. Umzug Müller, 8h"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {form.kind === "payment" && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Zahlungsart</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.paymentMethod}
                    onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as typeof form.paymentMethod }))}
                  >
                    <option value="">(keine Angabe)</option>
                    <option value="cash">Bar</option>
                    <option value="bank_transfer">Überweisung</option>
                    <option value="other">Sonstiges</option>
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Bezahlt durch andere Firma</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.payingOperatingCompanyId}
                  onChange={(e) => setForm((f) => ({ ...f, payingOperatingCompanyId: e.target.value }))}
                >
                  <option value="">(Standard: Auftragsfirma)</option>
                  {operatingCompanies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Beleg / Rechnung (Bild oder PDF)</label>
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
                {form.receiptFile && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, receiptFile: null, receiptName: "" }))}
                    className="text-xs text-muted-foreground hover:text-destructive shrink-0"
                  >
                    Entfernen
                  </button>
                )}
              </div>
              {form.receiptName && (
                <p className="text-[11px] text-muted-foreground mt-1 truncate">{form.receiptName}</p>
              )}
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input"
                  checked={form.isTaxDeductible}
                  onChange={(e) => setForm((f) => ({ ...f, isTaxDeductible: e.target.checked }))}
                />
                Steuerlich absetzbar
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button onClick={handleSave} disabled={saving || !form.employeeId || !form.date || !form.amount}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

// ─── Documents Section ────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  order_confirmation: "Auftragsbestätigung",
  invoice: "Rechnung",
  payment_confirmation: "Zahlungsbestätigung",
  worker_instructions: "Auftragsanweisung (Crew)",
};

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function DocumentsSection({
  recordId,
  documents,
  onChanged,
}: {
  recordId: string;
  documents: DealDocument[];
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState<string | null>(null); // documentType being uploaded
  const [deleting, setDeleting] = useState<string | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DealDocument | null>(null);

  async function handleUpload(documentType: string, file: File) {
    setUploading(documentType);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentType", documentType);
      const res = await fetch(`/api/v1/deals/${recordId}/documents`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? "Upload fehlgeschlagen");
        return;
      }
      onChanged();
    } finally {
      setUploading(null);
    }
  }

  async function handleDelete(docId: string) {
    if (!confirm("Dokument löschen?")) return;
    setDeleting(docId);
    try {
      const res = await fetch(`/api/v1/deals/${recordId}/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) toast.error("Löschen fehlgeschlagen");
      onChanged();
    } catch {
      toast.error("Löschen fehlgeschlagen", { description: "Netzwerkfehler. Bitte erneut versuchen." });
    } finally {
      setDeleting(null);
    }
  }

  function handleDownload(doc: DealDocument) {
    // Force download (the endpoint defaults to inline for preview).
    const a = document.createElement("a");
    a.href = `/api/v1/deals/${recordId}/documents/${doc.id}?download=1`;
    a.download = doc.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const docsByType = Object.fromEntries(
    (["order_confirmation", "invoice", "payment_confirmation", "worker_instructions"] as const).map((t) => [
      t,
      documents.filter((d) => d.documentType === t),
    ])
  );

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-sm">Dokumente</h3>
      </div>

      <div className="space-y-4">
        {(["order_confirmation", "invoice", "payment_confirmation", "worker_instructions"] as const).map((docType) => {
          const docs = docsByType[docType];
          const isUploading = uploading === docType;

          return (
            <div key={docType} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{DOC_TYPE_LABELS[docType]}</span>
                </div>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(docType, file);
                      e.target.value = "";
                    }}
                    disabled={isUploading}
                  />
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      isUploading
                        ? "opacity-50 cursor-not-allowed bg-muted text-muted-foreground border-border"
                        : "bg-background text-foreground border-border hover:bg-muted cursor-pointer"
                    }`}
                  >
                    {isUploading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    Hochladen
                  </span>
                </label>
              </div>

              {docs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Noch kein Dokument hochgeladen</p>
              ) : (
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 rounded-md bg-muted/40 px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(doc)}
                        className="flex-1 text-left text-sm truncate hover:underline"
                        title="Vorschau öffnen"
                      >
                        {doc.fileName}
                      </button>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {fmtBytes(doc.fileSize)}
                      </span>
                      <button
                        onClick={() => setPreviewDoc(doc)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Vorschau"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDownload(doc)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="Herunterladen"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(doc.id)}
                        disabled={deleting === doc.id}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Löschen"
                      >
                        {deleting === doc.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {previewDoc && (
        <DocumentPreviewModal
          url={`/api/v1/deals/${recordId}/documents/${previewDoc.id}`}
          downloadUrl={`/api/v1/deals/${recordId}/documents/${previewDoc.id}?download=1`}
          fileName={previewDoc.fileName}
          mimeType={previewDoc.mimeType}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </section>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function FinancialTab({ recordId }: { recordId: string }) {
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [costs, setCosts] = useState<EmployeeCost[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [operatingCompanies, setOperatingCompanies] = useState<OperatingCompany[]>([]);
  const [documents, setDocuments] = useState<DealDocument[]>([]);
  const [dealNumber, setDealNumber] = useState<string | null>(null);
  const [dealValue, setDealValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [profitRes, paymentsRes, expensesRes, costsRes, empRes, numRes, docsRes, ocRes, dealRes] = await Promise.all([
        fetch(`/api/v1/deals/${recordId}/profit`),
        fetch(`/api/v1/deals/${recordId}/payments`),
        fetch(`/api/v1/deals/${recordId}/expenses`),
        fetch(`/api/v1/deals/${recordId}/employee-costs`),
        fetch(`/api/v1/employees`),
        fetch(`/api/v1/deals/${recordId}/deal-number`),
        fetch(`/api/v1/deals/${recordId}/documents`),
        fetch(`/api/v1/operating-companies`),
        fetch(`/api/v1/objects/deals/records/${recordId}`),
      ]);
      if (profitRes.ok) setProfit(await profitRes.json().then((r) => r.data));
      if (paymentsRes.ok) setPayments(await paymentsRes.json().then((r) => r.data));
      if (expensesRes.ok) setExpenses(await expensesRes.json().then((r) => r.data));
      if (costsRes.ok) setCosts(await costsRes.json().then((r) => r.data));
      if (empRes.ok) setEmployees(await empRes.json().then((r) => r.data));
      if (numRes.ok) setDealNumber(await numRes.json().then((r) => r.data.dealNumber));
      if (docsRes.ok) setDocuments(await docsRes.json().then((r) => r.data));
      if (ocRes.ok) setOperatingCompanies(await ocRes.json().then((r) => r.data));
      if (dealRes.ok) {
        const dealJson = await dealRes.json();
        const valueAttr = dealJson?.data?.values?.value;
        const n = valueAttr != null ? Number(valueAttr) : NaN;
        setDealValue(Number.isFinite(n) ? n : null);
      }
    } finally {
      setLoading(false);
    }
  }, [recordId, refreshKey]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function refresh() {
    setRefreshKey((k) => k + 1);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 py-4">
      {dealNumber && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Auftragsnummer</span>
          <span className="font-mono text-sm font-semibold bg-muted px-2 py-0.5 rounded">
            {dealNumber}
          </span>
        </div>
      )}

      {profit && <ProfitKPIs profit={profit} />}

      <div className="border-t border-border pt-6">
        <PaymentsSection recordId={recordId} payments={payments} dealValue={dealValue} onChanged={refresh} />
      </div>

      <div className="border-t border-border pt-6">
        <ExpensesSection recordId={recordId} expenses={expenses} operatingCompanies={operatingCompanies} onChanged={refresh} />
      </div>

      <div className="border-t border-border pt-6">
        <EmployeeCostsSection
          recordId={recordId}
          costs={costs}
          employees={employees}
          operatingCompanies={operatingCompanies}
          onChanged={refresh}
        />
      </div>

      <div className="border-t border-border pt-6">
        <DocumentsSection recordId={recordId} documents={documents} onChanged={refresh} />
      </div>
    </div>
  );
}
