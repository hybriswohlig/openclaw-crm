"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Building2,
  ArrowRightLeft,
  Plus,
  Pencil,
  Trash2,
  Wallet,
  ChevronRight,
} from "lucide-react";
import { CompanyDetailDialog } from "@/components/financial/company-detail-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  totalDeductibleExpenses: number;
  totalNonDeductibleExpenses: number;
  totalEmployeeCosts: number;
  totalPrivateEinlagen: number;
  totalPrivateEntnahmen: number;
  totalCosts: number;
  netProfit: number;
  margin: number | null;
}

interface DealRow {
  dealRecordId: string;
  dealNumber: string;
  name: string;
  income: number;
  costs: number;
  profit: number;
}

interface CompanyRow {
  companyId: string | null;
  companyName: string;
  income: number;
  deductibleExpenses: number;
  nonDeductibleExpenses: number;
  employeeCosts: number;
  crossSubsidyIn: number;
  crossSubsidyOut: number;
  privateEinlagen: number;
  privateEntnahmen: number;
  netResult: number;
}

interface PrivateTxRow {
  id: string;
  date: string;
  amount: number;
  method: "cash" | "bank_transfer" | "other";
  fromPartner: string;
  toPartner: string | null;
  operatingCompanyId: string;
  operatingCompanyName: string;
  direction: "einlage" | "entnahme";
  notes: string | null;
}

interface FinancialData {
  summary: FinancialSummary;
  expensesByCategory: Record<string, number>;
  employeeBalances: Array<{ name: string; total: number }>;
  deals: DealRow[];
  companyBreakdown: CompanyRow[];
  privateTransactions: PrivateTxRow[];
}

interface OperatingCompany {
  id: string;
  name: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eur(n: number) {
  return Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Months from March 2026 through the current month, newest first. */
function generateMonths(): Array<{ value: string; label: string }> {
  const months: Array<{ value: string; label: string }> = [];
  const start = new Date(2026, 2, 1);
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 1);
  const cursor = new Date(start);
  while (cursor <= end) {
    const value = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const label = cursor.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    months.push({ value, label });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months.reverse();
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Kraftstoff",
  truck_rental: "LKW-Miete",
  equipment: "Ausstattung",
  subcontractor: "Subunternehmer",
  toll: "Maut",
  other: "Sonstiges",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Bar",
  bank_transfer: "Überweisung",
  other: "Sonstiges",
};

// ─── KPI Cards ─────────────────────────────────────────────────────────────────

function KPICards({ summary }: { summary: FinancialSummary }) {
  const positive = summary.netProfit > 0;
  const neutral = summary.netProfit === 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm text-muted-foreground">Einnahmen</CardTitle>
          <TrendingUp className="h-4 w-4 text-emerald-500" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{eur(summary.totalIncome)}</p>
          <p className="text-xs text-muted-foreground mt-1">Zahlungseingänge</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm text-muted-foreground">Ausgaben</CardTitle>
          <TrendingDown className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">{eur(summary.totalExpenses)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            davon nicht abz.: {eur(summary.totalNonDeductibleExpenses)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm text-muted-foreground">Personalkosten</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{eur(summary.totalEmployeeCosts)}</p>
          <p className="text-xs text-muted-foreground mt-1">Löhne &amp; Vorschüsse</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm text-muted-foreground">Netto-Ergebnis</CardTitle>
          {positive ? <ArrowUpRight className="h-4 w-4 text-emerald-500" /> : neutral ? <Minus className="h-4 w-4 text-muted-foreground" /> : <ArrowDownRight className="h-4 w-4 text-red-500" />}
        </CardHeader>
        <CardContent>
          <p className={`text-2xl font-bold ${positive ? "text-emerald-600 dark:text-emerald-400" : neutral ? "text-muted-foreground" : "text-red-600 dark:text-red-400"}`}>
            {eur(summary.netProfit)}
          </p>
          {summary.margin !== null && (
            <p className="text-xs text-muted-foreground mt-1">{summary.margin}% Marge</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Company breakdown + 50/50 settlement ─────────────────────────────────────

function CompanyBreakdown({
  companies,
  onSelect,
}: {
  companies: CompanyRow[];
  onSelect: (c: CompanyRow) => void;
}) {
  if (companies.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        Keine Daten — Aufträgen eine Betriebsgesellschaft zuweisen
      </p>
    );
  }

  const totalNet = companies.reduce((s, c) => s + c.netResult, 0);
  const fairShare = totalNet / 2;

  const settlements: Array<{ from: string; to: string; amount: number }> = [];
  const sorted = [...companies].sort((a, b) => b.netResult - a.netResult);
  if (sorted.length === 2) {
    const diff = sorted[0].netResult - fairShare;
    if (diff > 0.01) {
      settlements.push({
        from: sorted[0].companyName,
        to: sorted[1].companyName,
        amount: diff,
      });
    }
  }

  const Row = ({ label, values, muted = false, emphasise = false }: {
    label: string;
    values: number[];
    muted?: boolean;
    emphasise?: boolean;
  }) => (
    <tr className={emphasise ? "border-t border-border bg-muted/40" : ""}>
      <td className={`px-4 py-2 ${emphasise ? "font-semibold" : muted ? "text-muted-foreground" : ""}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`px-4 py-2 text-right tabular-nums ${emphasise ? "font-semibold" : ""}`}>
          {eur(v)}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 font-medium">Betriebsgesellschaft</th>
              {companies.map((c) => (
                <th key={c.companyId ?? "unassigned"} className="text-right px-0 py-0 font-medium">
                  <button
                    type="button"
                    onClick={() => onSelect(c)}
                    className="w-full flex items-center gap-2 justify-end px-4 py-3 hover:bg-muted/60 hover:text-primary transition-colors group"
                    title="Details öffnen"
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0 group-hover:text-primary" />
                    <span className="underline-offset-2 group-hover:underline">
                      {c.companyName}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row label="Einnahmen" values={companies.map((c) => c.income)} />
            <Row label="Ausgaben (abzugsfähig)" values={companies.map((c) => -c.deductibleExpenses)} />
            <Row label="Ausgaben (nicht abz.)" values={companies.map((c) => -c.nonDeductibleExpenses)} />
            <Row label="Personalkosten" values={companies.map((c) => -c.employeeCosts)} />
            <Row label="Quersubventionen +in" values={companies.map((c) => c.crossSubsidyIn)} muted />
            <Row label="Quersubventionen −out" values={companies.map((c) => -c.crossSubsidyOut)} muted />
            <Row label="Privateinlagen" values={companies.map((c) => c.privateEinlagen)} />
            <Row label="Privatentnahmen" values={companies.map((c) => -c.privateEntnahmen)} />
            <Row label="Netto-Ergebnis" values={companies.map((c) => c.netResult)} emphasise />
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          50/50 Ausgleich
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">Gesamtergebnis</p>
            <p className={`text-lg font-bold ${totalNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {eur(totalNet)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Anteil pro Partner (50%)</p>
            <p className="text-lg font-bold">{eur(fairShare)}</p>
          </div>
        </div>
        {settlements.length > 0 ? (
          <div className="pt-2 border-t border-border">
            {settlements.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-semibold text-amber-600 dark:text-amber-400">{s.from}</span>
                <span className="text-muted-foreground">schuldet</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">{s.to}</span>
                <span className="ml-auto font-bold text-lg">{eur(s.amount)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground pt-2 border-t border-border">
            Kein Ausgleich nötig — beide Seiten sind ausgeglichen.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Private Transactions section ─────────────────────────────────────────────

function PrivateTransactionsSection({
  transactions,
  operatingCompanies,
  onChanged,
}: {
  transactions: PrivateTxRow[];
  operatingCompanies: OperatingCompany[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrivateTxRow | null>(null);
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    method: "cash" as "cash" | "bank_transfer" | "other",
    fromPartner: "",
    toPartner: "",
    operatingCompanyId: operatingCompanies[0]?.id ?? "",
    direction: "entnahme" as "einlage" | "entnahme",
    notes: "",
  };
  const [form, setForm] = useState(emptyForm);

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, operatingCompanyId: operatingCompanies[0]?.id ?? "" });
    setOpen(true);
  }

  function openEdit(t: PrivateTxRow) {
    setEditing(t);
    setForm({
      date: t.date,
      amount: String(t.amount.toFixed(2)),
      method: t.method,
      fromPartner: t.fromPartner,
      toPartner: t.toPartner ?? "",
      operatingCompanyId: t.operatingCompanyId,
      direction: t.direction,
      notes: t.notes ?? "",
    });
    setOpen(true);
  }

  async function handleSave() {
    if (!form.date || !form.amount || !form.fromPartner || !form.operatingCompanyId) return;
    setSaving(true);
    try {
      const body = {
        date: form.date,
        amount: form.amount,
        method: form.method,
        fromPartner: form.fromPartner,
        toPartner: form.toPartner || null,
        operatingCompanyId: form.operatingCompanyId,
        direction: form.direction,
        notes: form.notes || null,
      };
      if (editing) {
        await fetch(`/api/v1/private-transactions/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await fetch(`/api/v1/private-transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setOpen(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Privatbewegung löschen?")) return;
    await fetch(`/api/v1/private-transactions/${id}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Wallet className="h-4 w-4 text-muted-foreground" />
          Privatbewegungen
          {transactions.length > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {transactions.length} {transactions.length === 1 ? "Eintrag" : "Einträge"}
            </span>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={openAdd} disabled={operatingCompanies.length === 0}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Hinzufügen
        </Button>
      </div>

      {transactions.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Keine Privatbewegungen erfasst
        </p>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Datum</th>
                <th className="text-left px-3 py-2 font-medium">Richtung</th>
                <th className="text-left px-3 py-2 font-medium">Von</th>
                <th className="text-left px-3 py-2 font-medium">An</th>
                <th className="text-left px-3 py-2 font-medium">Firma</th>
                <th className="text-left px-3 py-2 font-medium">Methode</th>
                <th className="text-right px-3 py-2 font-medium">Betrag</th>
                <th className="px-3 py-2 w-16" />
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{fmtDate(t.date)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.direction === "einlage"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
                    }`}>
                      {t.direction === "einlage" ? "Einlage" : "Entnahme"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{t.fromPartner}</td>
                  <td className="px-3 py-2 text-muted-foreground">{t.toPartner ?? "—"}</td>
                  <td className="px-3 py-2">{t.operatingCompanyName}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{METHOD_LABELS[t.method] ?? t.method}</td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${
                    t.direction === "einlage" ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"
                  }`}>
                    {t.direction === "einlage" ? "+" : "−"}{eur(t.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => openEdit(t)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(t.id)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive">
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
            <DialogTitle>{editing ? "Privatbewegung bearbeiten" : "Privatbewegung hinzufügen"}</DialogTitle>
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
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Richtung *</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.direction}
                  onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value as typeof form.direction }))}
                >
                  <option value="entnahme">Entnahme (aus Firma)</option>
                  <option value="einlage">Einlage (in Firma)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Methode *</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.method}
                  onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as typeof form.method }))}
                >
                  <option value="cash">Bar</option>
                  <option value="bank_transfer">Überweisung</option>
                  <option value="other">Sonstiges</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Von Partner *</label>
                <input
                  type="text"
                  placeholder="z.B. Dario"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.fromPartner}
                  onChange={(e) => setForm((f) => ({ ...f, fromPartner: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">An Partner</label>
                <input
                  type="text"
                  placeholder="leer = auf eigene Kappe / an Firma"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.toPartner}
                  onChange={(e) => setForm((f) => ({ ...f, toPartner: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Firma (Topf) *</label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.operatingCompanyId}
                onChange={(e) => setForm((f) => ({ ...f, operatingCompanyId: e.target.value }))}
              >
                {operatingCompanies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Notizen</label>
              <input
                type="text"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.date || !form.amount || !form.fromPartner || !form.operatingCompanyId}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Deals Table ─────────────────────────────────────────────────────────────

function DealsTable({ deals }: { deals: DealRow[] }) {
  if (deals.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Keine Aufträge in diesem Zeitraum</p>;
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left px-4 py-3 font-medium">Nr.</th>
            <th className="text-left px-4 py-3 font-medium">Auftrag</th>
            <th className="text-right px-4 py-3 font-medium">Einnahmen</th>
            <th className="text-right px-4 py-3 font-medium">Kosten</th>
            <th className="text-right px-4 py-3 font-medium">Gewinn</th>
            <th className="text-right px-4 py-3 font-medium">Marge</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => {
            const margin = d.income > 0 ? Math.round((d.profit / d.income) * 100) : null;
            const positive = d.profit > 0;
            return (
              <tr key={d.dealRecordId} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{d.dealNumber}</span>
                </td>
                <td className="px-4 py-3 font-medium">{d.name}</td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{eur(d.income)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400">{eur(d.costs)}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-semibold ${positive ? "text-emerald-600 dark:text-emerald-400" : d.profit < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                  {eur(d.profit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {margin !== null ? `${margin}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/50 font-semibold">
            <td className="px-4 py-3" colSpan={2}>Gesamt</td>
            <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{eur(deals.reduce((s, d) => s + d.income, 0))}</td>
            <td className="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400">{eur(deals.reduce((s, d) => s + d.costs, 0))}</td>
            <td className="px-4 py-3 text-right tabular-nums">
              {(() => {
                const p = deals.reduce((s, d) => s + d.profit, 0);
                return <span className={p >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>{eur(p)}</span>;
              })()}
            </td>
            <td className="px-4 py-3" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FinancialPage() {
  const MONTHS = generateMonths();
  const [selectedMonth, setSelectedMonth] = useState<string>("gesamt");
  const [data, setData] = useState<FinancialData | null>(null);
  const [operatingCompanies, setOperatingCompanies] = useState<OperatingCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState<CompanyRow | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const url = selectedMonth === "gesamt"
      ? "/api/v1/financial/overview"
      : `/api/v1/financial/overview?month=${selectedMonth}`;
    Promise.all([
      fetch(url).then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }),
      fetch("/api/v1/operating-companies").then((res) => res.json()),
    ])
      .then(([overview, oc]) => {
        setData(overview.data);
        setOperatingCompanies(oc.data ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedMonth, refreshKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const selectedLabel = selectedMonth === "gesamt"
    ? "Gesamt"
    : MONTHS.find((m) => m.value === selectedMonth)?.label ?? selectedMonth;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Finanzen</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedMonth === "gesamt" ? "Gesamtübersicht aller Aufträge" : `Übersicht für ${selectedLabel}`}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSelectedMonth("gesamt")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              selectedMonth === "gesamt"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Gesamt
          </button>
          {MONTHS.map((m) => (
            <button
              key={m.value}
              onClick={() => setSelectedMonth(m.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                selectedMonth === m.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error || !data ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-2">
            <p className="text-destructive font-medium">Fehler beim Laden</p>
            <p className="text-sm text-muted-foreground">{error ?? "Keine Daten"}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <KPICards summary={data.summary} />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Aufteilung pro Betriebsgesellschaft</CardTitle>
              <p className="text-xs text-muted-foreground">
                Auf eine Firma klicken für Details, Tortendiagramme und Drilldown.
              </p>
            </CardHeader>
            <CardContent>
              <CompanyBreakdown
                companies={data.companyBreakdown}
                onSelect={setSelectedCompany}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Aufträge — {selectedLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <DealsTable deals={data.deals} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <PrivateTransactionsSection
                transactions={data.privateTransactions}
                operatingCompanies={operatingCompanies}
                onChanged={refresh}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {selectedCompany && (
        <CompanyDetailDialog
          open={selectedCompany !== null}
          onClose={() => setSelectedCompany(null)}
          companyId={selectedCompany.companyId}
          companyName={selectedCompany.companyName}
          monthLabel={selectedLabel}
          monthQuery={selectedMonth === "gesamt" ? null : selectedMonth}
        />
      )}
    </div>
  );
}
