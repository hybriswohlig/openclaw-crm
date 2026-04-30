"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Users,
  Wallet,
  ArrowRightLeft,
  Building2,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

// ─── Types (mirror server CompanyDetails) ────────────────────────────────────

interface CompanyDetails {
  companyId: string | null;
  companyName: string;
  totals: {
    income: number;
    deductibleExpenses: number;
    nonDeductibleExpenses: number;
    employeeCosts: number;
    crossSubsidyIn: number;
    crossSubsidyOut: number;
    privateEinlagen: number;
    privateEntnahmen: number;
    netResult: number;
  };
  incomeByDeal: Array<{
    dealRecordId: string;
    dealNumber: string;
    dealName: string;
    total: number;
    payments: Array<{
      id: string;
      date: string;
      amount: number;
      payer: string | null;
      paymentMethod: string | null;
      reference: string | null;
      notes: string | null;
    }>;
  }>;
  expensesByCategory: Array<{
    category: string;
    total: number;
    deductibleTotal: number;
    nonDeductibleTotal: number;
    count: number;
  }>;
  expenseEntries: Array<{
    id: string;
    date: string;
    amount: number;
    category: string;
    description: string | null;
    recipient: string | null;
    paymentMethod: string | null;
    isTaxDeductible: boolean;
    isCrossSubsidy: boolean;
    dealRecordId: string;
    dealNumber: string;
    dealName: string;
  }>;
  employeeCostsByPerson: Array<{
    employeeName: string;
    total: number;
    deductibleTotal: number;
    nonDeductibleTotal: number;
    count: number;
  }>;
  employeeEntries: Array<{
    id: string;
    date: string;
    amount: number;
    type: "salary" | "advance" | "reimbursement";
    employeeName: string;
    description: string | null;
    paymentMethod: string | null;
    status: "open" | "paid";
    isTaxDeductible: boolean;
    isCrossSubsidy: boolean;
    dealRecordId: string;
    dealNumber: string;
    dealName: string;
  }>;
  privateEntries: Array<{
    id: string;
    date: string;
    amount: number;
    method: "cash" | "bank_transfer" | "other";
    fromPartner: string;
    toPartner: string | null;
    direction: "einlage" | "entnahme";
    notes: string | null;
  }>;
  crossSubsidyInEntries: Array<{
    id: string;
    kind: "expense" | "employee";
    date: string;
    amount: number;
    label: string;
    paidByCompanyId: string;
    paidByCompanyName: string;
    dealRecordId: string;
    dealNumber: string;
    dealName: string;
  }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eur(n: number) {
  return Number(n).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Kraftstoff",
  truck_rental: "LKW-Miete",
  equipment: "Ausstattung",
  subcontractor: "Subunternehmer",
  toll: "Maut",
  other: "Sonstiges",
};

const TYPE_LABELS: Record<string, string> = {
  salary: "Lohn",
  advance: "Vorschuss",
  reimbursement: "Erstattung",
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Bar",
  bank_transfer: "Überweisung",
  other: "Sonstiges",
};

// Stable, color-blind friendly palette. Reused across pies + legend.
const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#84cc16", // lime
  "#ec4899", // pink
  "#64748b", // slate
];

// ─── SVG Pie Chart ───────────────────────────────────────────────────────────

interface Slice {
  key: string;
  label: string;
  value: number;
  /** Optional sub-info shown in the legend (e.g. "8x · 80% absetzbar"). */
  hint?: string;
}

function PieChart({
  slices,
  size = 200,
  emptyLabel = "Keine Daten",
}: {
  slices: Slice[];
  size?: number;
  emptyLabel?: string;
}) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = size / 2;
  const cx = r;
  const cy = r;

  if (total <= 0) {
    return (
      <div
        className="flex items-center justify-center rounded-full border border-dashed border-border text-xs text-muted-foreground"
        style={{ width: size, height: size }}
      >
        {emptyLabel}
      </div>
    );
  }

  // If only one slice, fill the entire circle (path with two arcs == doesn't
  // render well for a full 360°, so just draw a circle).
  if (slices.length === 1 || slices.filter((s) => s.value > 0).length === 1) {
    const firstNonZero = slices.find((s) => s.value > 0)!;
    const idx = slices.indexOf(firstNonZero);
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r - 1} fill={PALETTE[idx % PALETTE.length]} />
      </svg>
    );
  }

  let cumulative = 0;
  const paths = slices.map((slice, i) => {
    const value = Math.max(0, slice.value);
    if (value === 0) return null;
    const startAngle = (cumulative / total) * Math.PI * 2;
    cumulative += value;
    const endAngle = (cumulative / total) * Math.PI * 2;

    const x1 = cx + r * Math.sin(startAngle);
    const y1 = cy - r * Math.cos(startAngle);
    const x2 = cx + r * Math.sin(endAngle);
    const y2 = cy - r * Math.cos(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

    const d = [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`,
      "Z",
    ].join(" ");

    return (
      <path
        key={slice.key}
        d={d}
        fill={PALETTE[i % PALETTE.length]}
        stroke="white"
        strokeWidth={1}
      >
        <title>
          {slice.label}: {eur(value)} ({Math.round((value / total) * 100)}%)
        </title>
      </path>
    );
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {paths}
    </svg>
  );
}

function PieLegend({ slices }: { slices: Slice[] }) {
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;
  return (
    <ul className="space-y-1.5 text-sm">
      {slices.map((s, i) => {
        const pct = Math.round((s.value / total) * 100);
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-sm shrink-0"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
            />
            <span className="flex-1 truncate" title={s.label}>
              {s.label}
            </span>
            <span className="tabular-nums text-muted-foreground text-xs">
              {pct}%
            </span>
            <span className="tabular-nums font-medium w-24 text-right">
              {eur(s.value)}
            </span>
            {s.hint && (
              <span className="text-[11px] text-muted-foreground w-32 text-right truncate">
                {s.hint}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Pie + Legend pair ───────────────────────────────────────────────────────

function PieBlock({
  title,
  total,
  slices,
  emptyLabel,
}: {
  title: string;
  total: number;
  slices: Slice[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-sm tabular-nums font-medium">{eur(total)}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-center">
        <div className="flex justify-center">
          <PieChart slices={slices} size={180} emptyLabel={emptyLabel} />
        </div>
        <PieLegend slices={slices} />
      </div>
    </div>
  );
}

// ─── Sections ────────────────────────────────────────────────────────────────

function Summary({
  totals,
}: {
  totals: CompanyDetails["totals"];
}) {
  const positive = totals.netResult > 0;
  const neutral = totals.netResult === 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Einnahmen</span>
          <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
        </div>
        <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
          {eur(totals.income)}
        </p>
      </div>
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Ausgaben</span>
          <TrendingDown className="h-3.5 w-3.5 text-red-500" />
        </div>
        <p className="text-lg font-semibold text-red-600 dark:text-red-400 mt-1">
          {eur(totals.deductibleExpenses + totals.nonDeductibleExpenses)}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          davon nicht abz.: {eur(totals.nonDeductibleExpenses)}
        </p>
      </div>
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Personal</span>
          <Users className="h-3.5 w-3.5 text-orange-500" />
        </div>
        <p className="text-lg font-semibold text-orange-600 dark:text-orange-400 mt-1">
          {eur(totals.employeeCosts)}
        </p>
      </div>
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Netto-Ergebnis</span>
          <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <p
          className={`text-lg font-semibold mt-1 ${
            positive
              ? "text-emerald-600 dark:text-emerald-400"
              : neutral
                ? "text-muted-foreground"
                : "text-red-600 dark:text-red-400"
          }`}
        >
          {eur(totals.netResult)}
        </p>
      </div>
    </div>
  );
}

function TaxDeductibleSplit({
  deductible,
  nonDeductible,
}: {
  deductible: number;
  nonDeductible: number;
}) {
  const total = deductible + nonDeductible;
  if (total <= 0) return null;
  const pctDeductible = Math.round((deductible / total) * 100);

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4 text-emerald-500" />
        Steuerlich absetzbar
        <span className="ml-auto text-xs font-normal text-muted-foreground">
          {pctDeductible}% absetzbar
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${pctDeductible}%` }}
          title={`Absetzbar: ${eur(deductible)}`}
        />
        <div
          className="h-full bg-rose-400"
          style={{ width: `${100 - pctDeductible}%` }}
          title={`Nicht absetzbar: ${eur(nonDeductible)}`}
        />
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500" />
          <span className="text-muted-foreground">Absetzbar</span>
          <span className="ml-auto font-medium tabular-nums">
            {eur(deductible)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-sm bg-rose-400" />
          <span className="text-muted-foreground">Nicht absetzbar</span>
          <span className="ml-auto font-medium tabular-nums">
            {eur(nonDeductible)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Drill-down list (collapsible) ──────────────────────────────────────────

function DrillDownSection({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold hover:bg-muted/40 transition-colors text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span>{title}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {count} {count === 1 ? "Eintrag" : "Einträge"}
        </span>
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </div>
  );
}

function DealBadge({ number }: { number: string }) {
  return (
    <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded shrink-0">
      {number}
    </span>
  );
}

function DeductibleIcon({ deductible }: { deductible: boolean }) {
  const label = deductible ? "Steuerlich absetzbar" : "Nicht absetzbar";
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center"
    >
      {deductible ? (
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <ShieldOff className="h-3.5 w-3.5 text-rose-400" />
      )}
    </span>
  );
}

// ─── Main Dialog ─────────────────────────────────────────────────────────────

export function CompanyDetailDialog({
  companyId,
  companyName,
  monthLabel,
  monthQuery, // "YYYY-MM" or null for all-time
  open,
  onClose,
}: {
  /** null = "Nicht zugewiesen" */
  companyId: string | null;
  companyName: string;
  monthLabel: string;
  monthQuery: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<CompanyDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    const idSegment = companyId === null ? "unassigned" : companyId;
    const url =
      monthQuery === null
        ? `/api/v1/financial/companies/${idSegment}/details`
        : `/api/v1/financial/companies/${idSegment}/details?month=${monthQuery}`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        setData(json.data);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Unbekannter Fehler");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, companyId, monthQuery]);

  // Pie slices for income (one slice per deal).
  const incomeSlices = useMemo<Slice[]>(() => {
    if (!data) return [];
    return data.incomeByDeal.map((d) => ({
      key: d.dealRecordId,
      label: `${d.dealNumber} · ${d.dealName}`,
      value: d.total,
      hint: `${d.payments.length}× Zahlung`,
    }));
  }, [data]);

  // Pie slices for spending (categories + Personal + Privatentnahmen rolled up).
  const spendingSlices = useMemo<Slice[]>(() => {
    if (!data) return [];
    const out: Slice[] = data.expensesByCategory.map((c) => {
      const pctDeductible =
        c.total > 0 ? Math.round((c.deductibleTotal / c.total) * 100) : 0;
      return {
        key: `cat:${c.category}`,
        label: CATEGORY_LABELS[c.category] ?? c.category,
        value: c.total,
        hint: `${c.count}× · ${pctDeductible}% absetzbar`,
      };
    });
    if (data.totals.employeeCosts > 0) {
      out.push({
        key: "employees",
        label: "Personal",
        value: data.totals.employeeCosts,
        hint: `${data.employeeEntries.length}×`,
      });
    }
    if (data.totals.privateEntnahmen > 0) {
      out.push({
        key: "privatentnahmen",
        label: "Privatentnahmen",
        value: data.totals.privateEntnahmen,
        hint: `${data.privateEntries.filter((e) => e.direction === "entnahme").length}×`,
      });
    }
    return out.sort((a, b) => b.value - a.value);
  }, [data]);

  const totalSpending =
    (data?.totals.deductibleExpenses ?? 0) +
    (data?.totals.nonDeductibleExpenses ?? 0) +
    (data?.totals.employeeCosts ?? 0) +
    (data?.totals.privateEntnahmen ?? 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            {companyName}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {monthLabel}
            </span>
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !loading && (
          <div className="py-12 text-center">
            <p className="text-destructive font-medium">Fehler beim Laden</p>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {data && !loading && !error && (
          <div className="space-y-6">
            <Summary totals={data.totals} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PieBlock
                title="Einnahmen — pro Auftrag"
                total={data.totals.income}
                slices={incomeSlices}
                emptyLabel="Keine Einnahmen"
              />
              <PieBlock
                title="Ausgaben — wofür?"
                total={totalSpending}
                slices={spendingSlices}
                emptyLabel="Keine Ausgaben"
              />
            </div>

            <TaxDeductibleSplit
              deductible={data.totals.deductibleExpenses}
              nonDeductible={data.totals.nonDeductibleExpenses}
            />

            {/* ── Drill-down lists ─────────────────────────────────────── */}

            <div className="space-y-3">
              <DrillDownSection
                title="Einnahmen-Details"
                count={data.incomeByDeal.length}
              >
                <div className="divide-y divide-border">
                  {data.incomeByDeal.map((deal) => (
                    <div key={deal.dealRecordId} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <DealBadge number={deal.dealNumber} />
                        <span className="font-medium text-sm truncate">
                          {deal.dealName}
                        </span>
                        <span className="ml-auto font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {eur(deal.total)}
                        </span>
                      </div>
                      <ul className="space-y-1 pl-2 border-l-2 border-border">
                        {deal.payments.map((p) => (
                          <li
                            key={p.id}
                            className="flex items-center gap-2 text-xs text-muted-foreground pl-3"
                          >
                            <span className="tabular-nums whitespace-nowrap">
                              {fmtDate(p.date)}
                            </span>
                            <span className="truncate flex-1">
                              {p.payer ?? "—"}
                              {p.reference ? ` · ${p.reference}` : ""}
                              {p.paymentMethod ? ` · ${p.paymentMethod}` : ""}
                            </span>
                            <span className="font-medium tabular-nums text-foreground">
                              {eur(p.amount)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </DrillDownSection>

              <DrillDownSection
                title="Ausgaben"
                count={data.expenseEntries.length}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs">
                      <th className="text-left px-4 py-2 font-medium">Datum</th>
                      <th className="text-left px-4 py-2 font-medium">
                        Kategorie
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        Beschreibung
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        Auftrag
                      </th>
                      <th className="text-center px-2 py-2 font-medium" title="Steuerlich absetzbar">
                        Steuer
                      </th>
                      <th className="text-right px-4 py-2 font-medium">
                        Betrag
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expenseEntries.map((e) => (
                      <tr
                        key={e.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2 tabular-nums whitespace-nowrap text-xs">
                          {fmtDate(e.date)}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {CATEGORY_LABELS[e.category] ?? e.category}
                        </td>
                        <td className="px-4 py-2 text-xs max-w-[220px] truncate">
                          {e.description ?? e.recipient ?? "—"}
                          {e.isCrossSubsidy && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-500">
                              <ArrowRightLeft className="h-2.5 w-2.5" />
                              Quersub.
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          <DealBadge number={e.dealNumber} />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <DeductibleIcon deductible={e.isTaxDeductible} />
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium text-red-600 dark:text-red-400">
                          {eur(e.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DrillDownSection>

              <DrillDownSection
                title="Personalkosten"
                count={data.employeeEntries.length}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs">
                      <th className="text-left px-4 py-2 font-medium">Datum</th>
                      <th className="text-left px-4 py-2 font-medium">
                        Mitarbeiter
                      </th>
                      <th className="text-left px-4 py-2 font-medium">Typ</th>
                      <th className="text-left px-4 py-2 font-medium">
                        Beschreibung
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        Auftrag
                      </th>
                      <th className="text-center px-2 py-2 font-medium">
                        Steuer
                      </th>
                      <th className="text-right px-4 py-2 font-medium">
                        Betrag
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.employeeEntries.map((t) => (
                      <tr
                        key={t.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2 tabular-nums whitespace-nowrap text-xs">
                          {fmtDate(t.date)}
                        </td>
                        <td className="px-4 py-2 text-xs font-medium">
                          {t.employeeName}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {TYPE_LABELS[t.type] ?? t.type}
                        </td>
                        <td className="px-4 py-2 text-xs max-w-[200px] truncate">
                          {t.description ?? "—"}
                          {t.isCrossSubsidy && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-500">
                              <ArrowRightLeft className="h-2.5 w-2.5" />
                              Quersub.
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          <DealBadge number={t.dealNumber} />
                        </td>
                        <td className="px-2 py-2 text-center">
                          <DeductibleIcon deductible={t.isTaxDeductible} />
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium text-orange-600 dark:text-orange-400">
                          {eur(t.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DrillDownSection>

              <DrillDownSection
                title="Privatbewegungen"
                count={data.privateEntries.length}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs">
                      <th className="text-left px-4 py-2 font-medium">Datum</th>
                      <th className="text-left px-4 py-2 font-medium">
                        Richtung
                      </th>
                      <th className="text-left px-4 py-2 font-medium">Von</th>
                      <th className="text-left px-4 py-2 font-medium">An</th>
                      <th className="text-left px-4 py-2 font-medium">
                        Methode
                      </th>
                      <th className="text-left px-4 py-2 font-medium">Notiz</th>
                      <th className="text-right px-4 py-2 font-medium">
                        Betrag
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.privateEntries.map((p) => (
                      <tr
                        key={p.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2 tabular-nums whitespace-nowrap text-xs">
                          {fmtDate(p.date)}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              p.direction === "einlage"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                                : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"
                            }`}
                          >
                            {p.direction === "einlage" ? "Einlage" : "Entnahme"}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs">{p.fromPartner}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {p.toPartner ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {METHOD_LABELS[p.method] ?? p.method}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground max-w-[180px] truncate">
                          {p.notes ?? "—"}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums font-medium ${
                            p.direction === "einlage"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-orange-600 dark:text-orange-400"
                          }`}
                        >
                          {p.direction === "einlage" ? "+" : "−"}
                          {eur(p.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DrillDownSection>

              <DrillDownSection
                title="Quersubventionen — von anderen Firmen bezahlt"
                count={data.crossSubsidyInEntries.length}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30 text-xs">
                      <th className="text-left px-4 py-2 font-medium">Datum</th>
                      <th className="text-left px-4 py-2 font-medium">
                        Bezahlt von
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        Beschreibung
                      </th>
                      <th className="text-left px-4 py-2 font-medium">
                        Auftrag
                      </th>
                      <th className="text-right px-4 py-2 font-medium">
                        Betrag
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.crossSubsidyInEntries.map((c) => (
                      <tr
                        key={`${c.kind}-${c.id}`}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-2 tabular-nums whitespace-nowrap text-xs">
                          {fmtDate(c.date)}
                        </td>
                        <td className="px-4 py-2 text-xs font-medium">
                          {c.paidByCompanyName}
                        </td>
                        <td className="px-4 py-2 text-xs text-muted-foreground max-w-[220px] truncate">
                          {c.label}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          <DealBadge number={c.dealNumber} />
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium text-amber-600 dark:text-amber-400">
                          {eur(c.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </DrillDownSection>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
