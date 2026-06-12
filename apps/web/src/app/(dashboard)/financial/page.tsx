"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
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
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Eye,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { CompanyDetailDialog } from "@/components/financial/company-detail-dialog";
import {
  CompanyBookingDialog,
  type BookingEditTarget,
} from "@/components/financial/company-booking-dialog";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_TAX_TREATMENT_LABELS,
  INCOME_TAX_TREATMENT_LABELS,
} from "@/lib/expense-categories";

async function saveErrorDescription(res: Response): Promise<string> {
  const data = await res.json().catch(() => null);
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message);
  }
  return "Bitte erneut versuchen.";
}

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
  totalKassenstand: number;
}

interface DealRow {
  /** null = Buchungen ohne Auftrag ("Ohne Auftrag"). */
  dealRecordId: string | null;
  dealNumber: string | null;
  name: string | null;
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
  /** Betriebsergebnis (operativ, ohne Privatbewegungen und Quersubventionen). */
  netResult: number;
  /** Kassenstand = netResult + Privateinlagen - Privatentnahmen. */
  kassenstand: number;
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

interface EmployeeLiabilities {
  totalEarned: number;
  totalPaid: number;
  totalOpen: number;
  byEmployee: Array<{
    employeeId: string;
    employeeName: string;
    earned: number;
    paid: number;
    open: number;
  }>;
  byCompany: Array<{
    companyId: string | null;
    companyName: string;
    earned: number;
    paid: number;
    open: number;
  }>;
}

/** Row from GET /api/v1/financial/bookings. */
interface BookingRow {
  id: string;
  type: "income" | "expense";
  date: string;
  amount: number;
  category?: string | null;
  taxTreatment: string;
  deductiblePercent?: number | null;
  receiptNumber: string | null;
  hasReceipt: boolean;
  description?: string | null;
  payer?: string | null;
  recipient?: string | null;
  dealRecordId: string | null;
  dealName: string | null;
  operatingCompanyId: string;
  operatingCompanyName: string;
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

const EXPENSE_CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.value, c.label])
);

const METHOD_LABELS: Record<string, string> = {
  cash: "Bar",
  bank_transfer: "Überweisung",
  other: "Sonstiges",
};

function openReceipt(type: "income" | "expense", id: string) {
  window.open(
    `/api/v1/financial/receipt?type=${type}&id=${encodeURIComponent(id)}`,
    "_blank",
    "noopener"
  );
}

// Widened views of the label maps for lookups with plain string keys from the API.
const INCOME_TREATMENT_LABELS: Record<string, string> = INCOME_TAX_TREATMENT_LABELS;
const EXPENSE_TREATMENT_LABELS: Record<string, string> = EXPENSE_TAX_TREATMENT_LABELS;

/** Compact tax treatment for table cells: "voll", "70%", "nicht", "n. steuerbar". */
function taxShort(row: BookingRow): { short: string; full: string } {
  if (row.type === "income") {
    const full = INCOME_TREATMENT_LABELS[row.taxTreatment] ?? row.taxTreatment;
    return row.taxTreatment === "nicht_steuerbar"
      ? { short: "n. steuerbar", full }
      : { short: "voll", full };
  }
  const full = EXPENSE_TREATMENT_LABELS[row.taxTreatment] ?? row.taxTreatment;
  if (row.taxTreatment === "teilweise") {
    return { short: `${row.deductiblePercent ?? 70}%`, full };
  }
  if (row.taxTreatment === "nicht") return { short: "nicht", full };
  return { short: "voll", full };
}

// ─── KPI Cards ─────────────────────────────────────────────────────────────────

function KPICards({ summary }: { summary: FinancialSummary }) {
  const positive = summary.netProfit > 0;
  const neutral = summary.netProfit === 0;
  const kassePositive = summary.totalKassenstand > 0;
  const kasseNeutral = summary.totalKassenstand === 0;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
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
          <CardTitle className="text-sm text-muted-foreground">Betriebsergebnis</CardTitle>
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm text-muted-foreground">Kassenstand gesamt</CardTitle>
          <Wallet className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <p className={`text-2xl font-bold ${kassePositive ? "text-emerald-600 dark:text-emerald-400" : kasseNeutral ? "text-muted-foreground" : "text-red-600 dark:text-red-400"}`}>
            {eur(summary.totalKassenstand)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">inkl. Privateinlagen und Entnahmen</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Buchungen section ───────────────────────────────────────────────────────

const TYPE_FILTERS = [
  { value: "alle", label: "Alle" },
  { value: "income", label: "Einnahmen" },
  { value: "expense", label: "Ausgaben" },
] as const;

type TypeFilter = (typeof TYPE_FILTERS)[number]["value"];

function BookingsSection({
  month,
  operatingCompanies,
  refreshKey,
  onChanged,
}: {
  /** "gesamt" or "YYYY-MM". */
  month: string;
  operatingCompanies: OperatingCompany[];
  refreshKey: number;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("alle");
  const [companyFilter, setCompanyFilter] = useState("");
  const [editTarget, setEditTarget] = useState<BookingEditTarget | null>(null);
  const hasRowsRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (hasRowsRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (month !== "gesamt") params.set("month", month);
    const qs = params.toString();
    fetch(`/api/v1/financial/bookings${qs ? `?${qs}` : ""}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setRows((json.data as BookingRow[]) ?? []);
        hasRowsRef.current = true;
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unbekannter Fehler");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month, refreshKey]);

  const filtered = rows.filter(
    (r) =>
      (typeFilter === "alle" || r.type === typeFilter) &&
      (companyFilter === "" || r.operatingCompanyId === companyFilter)
  );

  async function handleDelete(row: BookingRow) {
    const label = row.type === "income" ? "Einnahme" : "Ausgabe";
    if (!confirm(`${label} vom ${fmtDate(row.date)} über ${eur(row.amount)} wirklich löschen?`)) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/financial/bookings/${row.id}?type=${row.type}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error("Löschen fehlgeschlagen", { description: await saveErrorDescription(res) });
        return;
      }
      toast.success("Buchung gelöscht");
      onChanged();
    } catch {
      toast.error("Löschen fehlgeschlagen", {
        description: "Netzwerkfehler. Bitte erneut versuchen.",
      });
    }
  }

  function startEdit(row: BookingRow) {
    setEditTarget({
      id: row.id,
      type: row.type,
      date: row.date,
      amount: row.amount,
      operatingCompanyId: row.operatingCompanyId,
      category: row.category ?? null,
      taxTreatment: row.taxTreatment,
      deductiblePercent: row.deductiblePercent ?? null,
      description: row.description ?? null,
      payer: row.payer ?? null,
      recipient: row.recipient ?? null,
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive py-6 text-center">
        Buchungen konnten nicht geladen werden ({error})
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setTypeFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              typeFilter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
        {refreshing && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
        )}
        {operatingCompanies.length > 0 && (
          <select
            aria-label="Nach Gesellschaft filtern"
            className="ml-auto rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
          >
            <option value="">Alle Gesellschaften</option>
            {operatingCompanies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          {rows.length === 0
            ? "Keine Buchungen in diesem Zeitraum. Mit „Buchung erfassen“ eine Einnahme oder Ausgabe anlegen."
            : "Keine Buchungen für diesen Filter."}
        </p>
      ) : (
        <div
          className={`rounded-lg border border-border overflow-x-auto transition-opacity ${
            refreshing ? "opacity-60" : ""
          }`}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-xs">
                <th className="text-left px-3 py-2 font-medium">Datum</th>
                <th className="text-left px-2 py-2 font-medium">Beleg-Nr</th>
                <th className="text-left px-2 py-2 font-medium">Art</th>
                <th className="text-left px-2 py-2 font-medium">Kategorie</th>
                <th className="text-left px-2 py-2 font-medium">Beschreibung</th>
                <th className="text-left px-2 py-2 font-medium">Auftrag</th>
                <th className="text-left px-2 py-2 font-medium">Gesellschaft</th>
                <th className="text-left px-2 py-2 font-medium" title="Steuerliche Behandlung">Steuer</th>
                <th className="text-right px-2 py-2 font-medium">Betrag</th>
                <th className="text-center px-2 py-2 font-medium">Beleg</th>
                <th className="px-2 py-2 w-16">
                  <span className="sr-only">Aktionen</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const tax = taxShort(r);
                const desc =
                  r.description ||
                  (r.type === "income" ? r.payer : r.recipient) ||
                  null;
                return (
                  <tr key={`${r.type}-${r.id}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap text-xs">
                      {fmtDate(r.date)}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {r.receiptNumber && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {r.receiptNumber}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${
                          r.type === "income"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {r.type === "income" ? "Einnahme" : "Ausgabe"}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {r.type === "expense" && r.category
                        ? (EXPENSE_CATEGORY_LABELS[r.category] ?? r.category)
                        : "·"}
                    </td>
                    <td className="px-2 py-2 text-xs max-w-[180px]">
                      {desc ? (
                        <span className="block truncate" title={desc}>{desc}</span>
                      ) : (
                        <span className="text-muted-foreground">·</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs max-w-[150px]">
                      {r.dealRecordId ? (
                        <Link
                          href={`/objects/deals/${r.dealRecordId}`}
                          className="block truncate text-primary hover:underline"
                          title={r.dealName ?? "Auftrag öffnen"}
                        >
                          {r.dealName ?? "Auftrag"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Ohne Auftrag</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-xs max-w-[120px]">
                      <span className="block truncate" title={r.operatingCompanyName}>
                        {r.operatingCompanyName}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                      <span
                        title={tax.full}
                        className={`tabular-nums ${
                          tax.short === "nicht" || tax.short === "n. steuerbar"
                            ? "text-rose-500"
                            : tax.short === "voll"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {tax.short}
                      </span>
                    </td>
                    <td
                      className={`px-2 py-2 text-right tabular-nums font-medium whitespace-nowrap ${
                        r.type === "income"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {r.type === "income" ? "+" : "−"}{eur(r.amount)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {r.hasReceipt && (
                        <button
                          type="button"
                          onClick={() => openReceipt(r.type, r.id)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Beleg öffnen"
                          aria-label="Beleg öffnen"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        {r.dealRecordId === null ? (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(r)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                              title="Bearbeiten"
                              aria-label="Buchung bearbeiten"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(r)}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                              title="Löschen"
                              aria-label="Buchung löschen"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <Link
                            href={`/objects/deals/${r.dealRecordId}`}
                            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                            title="Im Auftrag bearbeiten"
                            aria-label="Im Auftrag bearbeiten"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <CompanyBookingDialog
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        operatingCompanies={operatingCompanies}
        onSaved={onChanged}
        editing={editTarget}
      />
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
        Keine Daten. Aufträgen eine Betriebsgesellschaft zuweisen
      </p>
    );
  }

  // Settlement basis: operating netResult of real companies only. The
  // "Nicht zugewiesen" bucket (companyId === null) pauses the settlement.
  const realCompanies = companies.filter((c) => c.companyId !== null);
  const unassignedRows = companies.filter((c) => c.companyId === null);
  const unassignedNet = unassignedRows.reduce((s, c) => s + c.netResult, 0);
  const unassignedBlocked = unassignedRows.some((c) =>
    [
      c.income,
      c.deductibleExpenses,
      c.nonDeductibleExpenses,
      c.employeeCosts,
      c.privateEinlagen,
      c.privateEntnahmen,
      c.netResult,
      c.kassenstand,
    ].some((v) => Math.abs(v) > 0.005)
  );

  const totalNet = realCompanies.reduce((s, c) => s + c.netResult, 0);
  const fairShare = totalNet / 2;

  const settlements: Array<{ from: string; to: string; amount: number }> = [];
  if (!unassignedBlocked && realCompanies.length === 2) {
    const sorted = [...realCompanies].sort((a, b) => b.netResult - a.netResult);
    const diff = (sorted[0].netResult - sorted[1].netResult) / 2;
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
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <div className="xl:col-span-2 rounded-lg border border-border overflow-hidden">
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
            <Row label="Betriebsergebnis" values={companies.map((c) => c.netResult)} emphasise />
            <Row label="Quersubventionen erhalten" values={companies.map((c) => c.crossSubsidyIn)} muted />
            <Row label="Quersubventionen gezahlt" values={companies.map((c) => -c.crossSubsidyOut)} muted />
            <Row label="Privateinlagen" values={companies.map((c) => c.privateEinlagen)} />
            <Row label="Privatentnahmen" values={companies.map((c) => -c.privateEntnahmen)} />
            <Row label="Kassenstand" values={companies.map((c) => c.kassenstand)} emphasise />
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          50/50 Ausgleich
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">Betriebsergebnis gesamt</p>
            <p className={`text-lg font-bold ${totalNet >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {eur(totalNet)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground">Anteil pro Partner (50%)</p>
            <p className="text-lg font-bold">{eur(fairShare)}</p>
          </div>
        </div>
        {unassignedBlocked ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20 p-3 text-sm text-amber-800 dark:text-amber-300">
            Ausgleich pausiert: {eur(unassignedNet)} sind keiner Gesellschaft zugeordnet.
            Aufträgen eine Gesellschaft zuweisen, dann rechnet der Ausgleich wieder.
          </div>
        ) : settlements.length > 0 ? (
          <div className="pt-2 border-t border-border">
            {settlements.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm flex-wrap">
                <span className="font-semibold text-amber-600 dark:text-amber-400">{s.from}</span>
                <span className="text-muted-foreground">schuldet</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">{s.to}</span>
                <span className="ml-auto font-bold text-lg">{eur(s.amount)}</span>
              </div>
            ))}
          </div>
        ) : realCompanies.length === 2 ? (
          <p className="text-sm text-muted-foreground pt-2 border-t border-border">
            Kein Ausgleich nötig, beide Seiten sind ausgeglichen.
          </p>
        ) : realCompanies.length > 2 ? (
          <p className="text-sm text-muted-foreground pt-2 border-t border-border">
            Ausgleich ist nur für genau 2 Gesellschaften definiert.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground pt-2 border-t border-border">
            Ausgleich benötigt genau 2 Gesellschaften mit Buchungen.
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
      let res: Response;
      if (editing) {
        res = await fetch(`/api/v1/private-transactions/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/v1/private-transactions`, {
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
    if (!confirm("Privatbewegung löschen?")) return;
    let res: Response;
    try {
      res = await fetch(`/api/v1/private-transactions/${id}`, { method: "DELETE" });
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
    <>
      <div className="flex items-center justify-end mb-3">
        <Button size="sm" variant="outline" onClick={openAdd} disabled={operatingCompanies.length === 0}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Privatbewegung hinzufügen
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
                  <td className="px-3 py-2 text-muted-foreground">{t.toPartner ?? "·"}</td>
                  <td className="px-3 py-2">{t.operatingCompanyName}</td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">{METHOD_LABELS[t.method] ?? t.method}</td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${
                    t.direction === "einlage" ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400"
                  }`}>
                    {t.direction === "einlage" ? "+" : "−"}{eur(t.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => openEdit(t)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                        title="Bearbeiten"
                        aria-label="Privatbewegung bearbeiten"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                        title="Löschen"
                        aria-label="Privatbewegung löschen"
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
          {deals.map((d, i) => {
            const margin = d.income > 0 ? Math.round((d.profit / d.income) * 100) : null;
            const positive = d.profit > 0;
            const noDeal = d.dealRecordId === null;
            return (
              <tr key={d.dealRecordId ?? `ohne-auftrag-${i}`} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  {d.dealNumber ? (
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{d.dealNumber}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">·</span>
                  )}
                </td>
                <td className={`px-4 py-3 ${noDeal ? "text-muted-foreground" : "font-medium"}`}>
                  {noDeal ? (d.name ?? "Ohne Auftrag") : d.name}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{eur(d.income)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400">{eur(d.costs)}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-semibold ${positive ? "text-emerald-600 dark:text-emerald-400" : d.profit < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                  {eur(d.profit)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {margin !== null ? `${margin}%` : "·"}
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

// ─── Employee liabilities ────────────────────────────────────────────────────

function EmployeeLiabilitiesSection({ liabilities }: { liabilities: EmployeeLiabilities }) {
  const openColor = (v: number) =>
    v > 0.005
      ? "text-amber-700 dark:text-amber-400"
      : v < -0.005
      ? "text-emerald-700 dark:text-emerald-400"
      : "text-muted-foreground";

  return (
    <div className="space-y-4">
      {/* Totals + per-company */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Offen gesamt</p>
          <p className={`text-xl font-semibold tabular-nums ${openColor(liabilities.totalOpen)}`}>
            {eur(liabilities.totalOpen)}
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          <span>Verdient gesamt: <span className="font-medium text-foreground">{eur(liabilities.totalEarned)}</span></span>
          <span className="mx-2">·</span>
          <span>Ausgezahlt/Verrechnet: <span className="font-medium text-foreground">{eur(liabilities.totalPaid)}</span></span>
        </div>
        <div className="flex flex-wrap gap-2 ml-auto">
          {liabilities.byCompany.map((c) => (
            <span
              key={c.companyId ?? "unassigned"}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs"
            >
              <Building2 className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">{c.companyName}:</span>
              <span className={`font-medium tabular-nums ${openColor(c.open)}`}>{eur(c.open)}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Per-employee */}
      <div className="rounded-md border border-border overflow-x-auto">
        <table className="w-full text-sm min-w-[420px]">
          <thead className="bg-muted/40">
            <tr className="text-xs text-muted-foreground">
              <th className="text-left px-3 py-1.5 font-medium">Mitarbeiter</th>
              <th className="text-right px-3 py-1.5 font-medium">Verdient</th>
              <th className="text-right px-3 py-1.5 font-medium">Ausgezahlt/Verrechnet</th>
              <th className="text-right px-3 py-1.5 font-medium">Offen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {liabilities.byEmployee.map((e) => (
              <tr key={e.employeeId} className="hover:bg-muted/30">
                <td className="px-3 py-1.5 font-medium">{e.employeeName}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{eur(e.earned)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{eur(e.paid)}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${openColor(e.open)}`}>{eur(e.open)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Collapsible section card ────────────────────────────────────────────────

function CollapsibleCard({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-6 py-4 text-left hover:bg-muted/30 transition-colors rounded-xl"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="min-w-0">
          <span className="block text-base font-semibold truncate">{title}</span>
          {subtitle && (
            <span className="block text-xs text-muted-foreground truncate">{subtitle}</span>
          )}
        </span>
        {badge && (
          <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">{badge}</span>
        )}
      </button>
      {open && <CardContent className="pt-2">{children}</CardContent>}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FinancialPage() {
  const MONTHS = useMemo(generateMonths, []);
  const [selectedMonth, setSelectedMonth] = useState<string>("gesamt");
  const [data, setData] = useState<FinancialData | null>(null);
  const [liabilities, setLiabilities] = useState<EmployeeLiabilities | null>(null);
  const [operatingCompanies, setOperatingCompanies] = useState<OperatingCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedCompany, setSelectedCompany] = useState<CompanyRow | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const hasDataRef = useRef(false);

  const fetchData = useCallback(() => {
    // Initial load shows the big spinner; later switches keep the page
    // rendered and only dim it (refreshing).
    if (hasDataRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const url = selectedMonth === "gesamt"
      ? "/api/v1/financial/overview"
      : `/api/v1/financial/overview?month=${selectedMonth}`;
    Promise.all([
      fetch(url).then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); }),
      fetch("/api/v1/operating-companies").then((res) => res.json()),
      // Cumulative liabilities, independent of the selected month.
      fetch("/api/v1/employees/liabilities").then((res) => (res.ok ? res.json() : { data: null })),
    ])
      .then(([overview, oc, liab]) => {
        setData(overview.data);
        hasDataRef.current = true;
        setOperatingCompanies(oc.data ?? []);
        setLiabilities(liab.data ?? null);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [selectedMonth, refreshKey]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const refresh = () => setRefreshKey((k) => k + 1);

  // Ordered timeline for the arrow navigation: Gesamt, then newest -> oldest.
  const navOrder = useMemo(() => ["gesamt", ...MONTHS.map((m) => m.value)], [MONTHS]);
  const navIndex = navOrder.indexOf(selectedMonth);
  const canGoOlder = navIndex >= 0 && navIndex < navOrder.length - 1;
  const canGoNewer = navIndex > 0;

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
          <Button
            variant="outline"
            size="icon"
            aria-label="Älterer Monat"
            title="Älterer Monat"
            disabled={!canGoOlder}
            onClick={() => setSelectedMonth(navOrder[navIndex + 1])}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <select
            aria-label="Zeitraum wählen"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium min-w-[160px]"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            <option value="gesamt">Gesamt</option>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <Button
            variant="outline"
            size="icon"
            aria-label="Neuerer Monat"
            title="Neuerer Monat"
            disabled={!canGoNewer}
            onClick={() => setSelectedMonth(navOrder[navIndex - 1])}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {refreshing && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          )}
          <Button
            size="sm"
            className="ml-1"
            onClick={() => setBookingOpen(true)}
            disabled={operatingCompanies.length === 0}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Buchung erfassen
          </Button>
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
        <div className={`space-y-6 transition-opacity ${refreshing ? "opacity-60" : ""}`}>
          <KPICards summary={data.summary} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Buchungen · {selectedLabel}</CardTitle>
              <p className="text-xs text-muted-foreground">
                Alle Einnahmen und Ausgaben im Zeitraum. Jeder Beleg lässt sich über das Auge wieder öffnen.
              </p>
            </CardHeader>
            <CardContent>
              <BookingsSection
                month={selectedMonth}
                operatingCompanies={operatingCompanies}
                refreshKey={refreshKey}
                onChanged={refresh}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gesellschaften &amp; Ausgleich</CardTitle>
              <p className="text-xs text-muted-foreground">
                Auf eine Gesellschaft klicken für Details, Tortendiagramme und Drilldown.
              </p>
            </CardHeader>
            <CardContent>
              <CompanyBreakdown
                companies={data.companyBreakdown}
                onSelect={setSelectedCompany}
              />
            </CardContent>
          </Card>

          <CollapsibleCard
            title="Privatbewegungen"
            subtitle="Einlagen und Entnahmen der Partner"
            badge={
              data.privateTransactions.length > 0
                ? `${data.privateTransactions.length} ${data.privateTransactions.length === 1 ? "Eintrag" : "Einträge"}`
                : undefined
            }
          >
            <PrivateTransactionsSection
              transactions={data.privateTransactions}
              operatingCompanies={operatingCompanies}
              onChanged={refresh}
            />
          </CollapsibleCard>

          {liabilities && liabilities.byEmployee.length > 0 && (
            <CollapsibleCard
              title="Schulden-Bilanz Mitarbeiter"
              subtitle="Kumulativ, unabhängig vom Monat: Verdient minus Ausgezahlt/Verrechnet"
              badge={`Offen: ${eur(liabilities.totalOpen)}`}
            >
              <EmployeeLiabilitiesSection liabilities={liabilities} />
            </CollapsibleCard>
          )}

          <CollapsibleCard
            title={`Aufträge · ${selectedLabel}`}
            subtitle="Einnahmen, Kosten und Gewinn pro Auftrag"
            badge={
              data.deals.length > 0
                ? `${data.deals.length} ${data.deals.length === 1 ? "Auftrag" : "Aufträge"}`
                : undefined
            }
          >
            <DealsTable deals={data.deals} />
          </CollapsibleCard>
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

      <CompanyBookingDialog
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        operatingCompanies={operatingCompanies}
        onSaved={refresh}
      />
    </div>
  );
}
