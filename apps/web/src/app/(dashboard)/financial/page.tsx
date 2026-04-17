"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  totalEmployeeCosts: number;
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
  companyName: string;
  income: number;
  expenses: number;
  employeeCosts: number;
  profit: number;
}

interface FinancialData {
  summary: FinancialSummary;
  expensesByCategory: Record<string, number>;
  employeeBalances: Array<{ name: string; total: number }>;
  deals: DealRow[];
  companyBreakdown: CompanyRow[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eur(n: number) {
  return Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/** Generate months from March 2026 up to and including the current month. */
function generateMonths(): Array<{ value: string; label: string }> {
  const months: Array<{ value: string; label: string }> = [];
  const start = new Date(2026, 2, 1); // March 2026
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), 1);

  const cursor = new Date(start);
  while (cursor <= end) {
    const value = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
    const label = cursor.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    months.push({ value, label });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months.reverse(); // newest first
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Kraftstoff",
  truck_rental: "LKW-Miete",
  equipment: "Ausstattung",
  subcontractor: "Subunternehmer",
  toll: "Maut",
  other: "Sonstiges",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function BarChart({ data, color }: { data: Record<string, number>; color: string }) {
  const entries = Object.entries(data)
    .map(([k, v]) => [CATEGORY_LABELS[k] ?? k, v] as [string, number])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, v]) => v), 1);

  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Keine Daten</p>;

  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => (
        <div key={label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="truncate max-w-[55%]">{label}</span>
            <span className="font-medium tabular-nums">{eur(value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${(value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function KPICards({ summary }: { summary: FinancialSummary }) {
  const positive = summary.netProfit > 0;
  const neutral  = summary.netProfit === 0;

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
          <p className="text-xs text-muted-foreground mt-1">+ {eur(summary.totalEmployeeCosts)} Personal</p>
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
          <CardTitle className="text-sm text-muted-foreground">Gewinn</CardTitle>
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

function DealsTable({ deals }: { deals: DealRow[] }) {
  if (deals.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">Keine Aufträge in diesem Zeitraum</p>;

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

function CompanyBreakdown({ companies }: { companies: CompanyRow[] }) {
  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Keine Daten — Aufträgen eine Betriebsgesellschaft zuweisen</p>;
  }

  const totalProfit = companies.reduce((s, c) => s + c.profit, 0);
  const fairShare = totalProfit / 2;

  // Calculate settlement: each company should end up with fairShare.
  // If company has more profit than fairShare, they owe the difference to the other.
  const settlements: Array<{ from: string; to: string; amount: number }> = [];
  const sorted = [...companies].sort((a, b) => b.profit - a.profit);

  if (sorted.length === 2) {
    const diff = sorted[0].profit - fairShare;
    if (diff > 0.01) {
      settlements.push({ from: sorted[0].companyName, to: sorted[1].companyName, amount: diff });
    }
  }

  return (
    <div className="space-y-4">
      {/* Company rows */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 font-medium">Betriebsgesellschaft</th>
              <th className="text-right px-4 py-3 font-medium">Einnahmen</th>
              <th className="text-right px-4 py-3 font-medium">Ausgaben</th>
              <th className="text-right px-4 py-3 font-medium">Personalkosten</th>
              <th className="text-right px-4 py-3 font-medium">Überschuss</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.companyName} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    {c.companyName}
                  </div>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{eur(c.income)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400">{eur(c.expenses)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400">{eur(c.employeeCosts)}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-semibold ${c.profit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                  {eur(c.profit)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted/50 font-semibold">
              <td className="px-4 py-3">Gesamt</td>
              <td className="px-4 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{eur(companies.reduce((s, c) => s + c.income, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400">{eur(companies.reduce((s, c) => s + c.expenses, 0))}</td>
              <td className="px-4 py-3 text-right tabular-nums text-red-600 dark:text-red-400">{eur(companies.reduce((s, c) => s + c.employeeCosts, 0))}</td>
              <td className={`px-4 py-3 text-right tabular-nums ${totalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {eur(totalProfit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 50/50 Settlement */}
      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
          50/50 Ausgleich
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <p className="text-muted-foreground">Gesamtgewinn</p>
            <p className={`text-lg font-bold ${totalProfit >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
              {eur(totalProfit)}
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
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {s.from}
                </span>
                <span className="text-muted-foreground">schuldet</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {s.to}
                </span>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function FinancialPage() {
  const MONTHS = generateMonths();
  // "gesamt" = all-time, otherwise a "YYYY-MM" value
  const [selectedMonth, setSelectedMonth] = useState<string>("gesamt");
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    const url = selectedMonth === "gesamt"
      ? "/api/v1/financial/overview"
      : `/api/v1/financial/overview?month=${selectedMonth}`;

    fetch(url)
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((json) => setData(json.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedMonth]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selectedLabel = selectedMonth === "gesamt"
    ? "Gesamt"
    : MONTHS.find((m) => m.value === selectedMonth)?.label ?? selectedMonth;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header + month filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Finanzen</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedMonth === "gesamt" ? "Gesamtübersicht aller Aufträge" : `Übersicht für ${selectedLabel}`}
          </p>
        </div>

        {/* Month selector */}
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

      {/* Content */}
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

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Ausgaben nach Kategorie</CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart data={data.expensesByCategory} color="bg-blue-500" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Personalkosten pro Mitarbeiter</CardTitle>
              </CardHeader>
              <CardContent>
                {data.employeeBalances.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Daten</p>
                ) : (
                  <BarChart
                    data={Object.fromEntries(data.employeeBalances.map((e) => [e.name, e.total]))}
                    color="bg-violet-500"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {/* Company breakdown + 50/50 settlement */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Genaue Aufteilung aller Ausgaben &amp; Einnahmen</CardTitle>
            </CardHeader>
            <CardContent>
              <CompanyBreakdown companies={data.companyBreakdown} />
            </CardContent>
          </Card>

          {/* Per-deal breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Aufträge — {selectedLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <DealsTable deals={data.deals} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
