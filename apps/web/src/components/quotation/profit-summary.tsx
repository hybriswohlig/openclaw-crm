"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface EmployeeExpense {
  name: string;
  hourlyRate: number;
  estimatedHours: number;
  cost: number;
}

interface ProfitData {
  revenue: number;
  expenses: {
    employees: EmployeeExpense[];
    total: number;
  };
  profit: number;
}

function fmt(n: number) {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

export function ProfitSummary({ profit }: { profit: ProfitData }) {
  const isPositive = profit.profit > 0;
  const isNeutral = profit.profit === 0;

  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Profit Overview</h3>

      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Revenue */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Revenue</p>
          <p className="text-xl font-semibold text-green-600 dark:text-green-400">
            {fmt(profit.revenue)}
          </p>
        </div>

        {/* Expenses */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Total Expenses</p>
          <p className="text-xl font-semibold text-red-600 dark:text-red-400">
            {fmt(profit.expenses.total)}
          </p>
        </div>

        {/* Profit */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs text-muted-foreground mb-1">Net Profit</p>
          <div className="flex items-center gap-2">
            <p
              className={`text-xl font-semibold ${
                isPositive
                  ? "text-green-600 dark:text-green-400"
                  : isNeutral
                    ? "text-muted-foreground"
                    : "text-red-600 dark:text-red-400"
              }`}
            >
              {fmt(profit.profit)}
            </p>
            {isPositive ? (
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
            ) : isNeutral ? (
              <Minus className="h-4 w-4 text-muted-foreground" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
            )}
          </div>
          {profit.revenue > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {((profit.profit / profit.revenue) * 100).toFixed(1)}% margin
            </p>
          )}
        </div>
      </div>

      {/* Expense breakdown */}
      {profit.expenses.employees.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2">Expense Breakdown</h4>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Employee</th>
                  <th className="text-right px-3 py-2 font-medium">Rate</th>
                  <th className="text-right px-3 py-2 font-medium">Est. Hours</th>
                  <th className="text-right px-3 py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {profit.expenses.employees.map((e, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-3 py-2">{e.name}</td>
                    <td className="px-3 py-2 text-right">{fmt(e.hourlyRate)}/h</td>
                    <td className="px-3 py-2 text-right">{e.estimatedHours.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right font-medium">{fmt(e.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Estimated hours are derived from helper line items. Future updates will allow adding rental costs, fuel, and other expenses.
          </p>
        </div>
      )}
    </div>
  );
}
