"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Users,
} from "lucide-react";

interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  totalEmployeeCosts: number;
  totalCosts: number;
  netProfit: number;
}

interface EmployeeBalance {
  name: string;
  total: number;
}

interface FinancialData {
  summary: FinancialSummary;
  expensesByCategory: Record<string, number>;
  employeeBalances: EmployeeBalance[];
}

function eur(n: number) {
  return Number(n).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Kraftstoff",
  truck_rental: "LKW-Miete",
  equipment: "Ausstattung",
  subcontractor: "Subunternehmer",
  toll: "Maut",
  other: "Sonstiges",
};

function BarChart({ data, color }: { data: Record<string, number>; color: string }) {
  const entries = Object.entries(data)
    .map(([k, v]) => [CATEGORY_LABELS[k] ?? k, v] as [string, number])
    .sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map(([, v]) => v), 1);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Keine Daten</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => (
        <div key={label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground truncate max-w-[60%]">{label}</span>
            <span className="font-medium tabular-nums">{eur(value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full ${color} transition-all duration-500`}
              style={{ width: `${(value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function FinancialPage() {
  const [data, setData] = useState<FinancialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/financial/overview")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => setData(json.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-destructive font-medium">Fehler beim Laden</p>
          <p className="text-sm text-muted-foreground">{error ?? "Keine Daten"}</p>
        </div>
      </div>
    );
  }

  const { summary, expensesByCategory, employeeBalances } = data;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Finanzen</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gesamtübersicht aller Aufträge — Details pro Auftrag in der jeweiligen Deal-Ansicht
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Einnahmen</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {eur(summary.totalIncome)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Zahlungseingänge gesamt</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Ausgaben</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {eur(summary.totalExpenses)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              + {eur(summary.totalEmployeeCosts)} Personalkosten
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Netto-Ergebnis</CardTitle>
            {summary.netProfit >= 0 ? (
              <ArrowUpRight className="h-4 w-4 text-emerald-500" />
            ) : (
              <ArrowDownRight className="h-4 w-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                summary.netProfit >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {eur(summary.netProfit)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Einnahmen − alle Kosten</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm text-muted-foreground">Personalkosten</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{eur(summary.totalEmployeeCosts)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {employeeBalances.length} Mitarbeiter
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Ausgaben nach Kategorie</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart data={expensesByCategory} color="bg-blue-500" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              <Wallet className="inline h-4 w-4 mr-1.5 -mt-0.5" />
              Personalkosten pro Mitarbeiter
            </CardTitle>
          </CardHeader>
          <CardContent>
            {employeeBalances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Daten</p>
            ) : (
              <div className="space-y-2">
                {employeeBalances
                  .sort((a, b) => b.total - a.total)
                  .map((e) => {
                    const max = Math.max(...employeeBalances.map((x) => x.total), 1);
                    return (
                      <div key={e.name} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-foreground truncate max-w-[60%]">{e.name}</span>
                          <span className="font-medium tabular-nums">{eur(e.total)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-violet-500 transition-all duration-500"
                            style={{ width: `${(e.total / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Detaillierte Einnahmen, Ausgaben und Personalkosten sind in der jeweiligen Deal-Ansicht einsehbar.
      </p>
    </div>
  );
}
