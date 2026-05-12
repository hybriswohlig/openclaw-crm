"use client";

import { useEffect, useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
} from "recharts";

// ─── Types (mirror server) ───────────────────────────────────────────────────

interface OverviewStats {
  revenueYtd: number;
  revenueMtd: number;
  revenueMtdDeltaPct: number | null;
  newLeads30d: number;
  winRate90dPct: number | null;
  outstandingAmount: number;
  movesThisWeek: number;
  revenueSeries8w: number[];
  newLeadsSeries8w: number[];
}

interface PipelineStageBucket {
  stageId: string;
  title: string;
  color: string;
  sortOrder: number;
  count: number;
  totalValue: number;
}
interface StaleDeal {
  dealId: string;
  name: string;
  stageTitle: string | null;
  daysStale: number;
}
interface PipelineStats {
  stages: PipelineStageBucket[];
  staleDeals: StaleDeal[];
  avgTimeToCloseDays: number | null;
  avgQuoteValueOpen: number | null;
  avgQuoteValueWon: number | null;
}

interface OperationsStats {
  movesCompletedByMonth: { month: string; count: number }[];
  upcomingMoves: { date: string; count: number }[];
  transporterMix: { title: string; color: string; count: number }[];
  workerCountAvg: number | null;
  workerCountMin: number | null;
  workerCountMax: number | null;
  utilizationByWeek: { weekStart: string; count: number }[];
}

interface TeamStats {
  tasksByWeek: { weekStart: string; completed: number; overdue: number }[];
  dealsByOwner: { ownerId: string; count: number }[];
  newLeadsByOwner30d: { ownerId: string; count: number }[];
}

interface CompanyComparisonRow {
  companyId: string;
  companyName: string;
  revenue: number;
  expenses: number;
  employeeCosts: number;
  margin: number;
  marginPct: number | null;
  dealsWon: number;
  dealsLost: number;
  winRatePct: number | null;
  avgDealValue: number | null;
}

type Period = "30d" | "90d" | "365d" | "ytd";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EUR = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("de-DE");

function fmtEUR(n: number | null | undefined) {
  if (n == null) return "–";
  return EUR.format(n);
}
function fmtNum(n: number | null | undefined) {
  if (n == null) return "–";
  return NUM.format(n);
}
function fmtPct(n: number | null | undefined) {
  if (n == null) return "–";
  return `${n} %`;
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data ?? null) as T;
  } catch {
    return null;
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function StatisticsPage() {
  const [tab, setTab] = useState("overview");

  return (
    <div
      className="flex h-full flex-col"
      style={{ padding: "24px 28px", gap: 20 }}
    >
      <header className="flex items-baseline justify-between">
        <h1
          className="k-display"
          style={{ fontSize: 28, letterSpacing: "-0.02em", fontWeight: 500 }}
        >
          Statistiken
        </h1>
        <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
          KPIs &amp; Trends · live aus deinem Workspace
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="revenue">Umsatz</TabsTrigger>
          <TabsTrigger value="operations">Aufträge</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="compare">Vergleich</TabsTrigger>
        </TabsList>

        <div className="mt-4 flex-1 overflow-auto">
          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="pipeline">
            <PipelineTab />
          </TabsContent>
          <TabsContent value="revenue">
            <RevenueTab />
          </TabsContent>
          <TabsContent value="operations">
            <OperationsTab />
          </TabsContent>
          <TabsContent value="team">
            <TeamTab />
          </TabsContent>
          <TabsContent value="compare">
            <CompareTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

// ─── KPI Card primitive ──────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  delta,
  sparkline,
}: {
  label: string;
  value: string;
  delta?: string | null;
  sparkline?: number[];
}) {
  const deltaPositive = delta?.startsWith("+");
  const deltaNegative = delta?.startsWith("−") || delta?.startsWith("-");
  return (
    <div
      className="rounded-xl"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--line)",
        padding: "14px 16px",
        minHeight: 96,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        className="text-[11.5px]"
        style={{
          color: "var(--ink-muted)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <div
          className="k-display"
          style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em" }}
        >
          {value}
        </div>
        {delta != null && (
          <div
            className="text-[12px]"
            style={{
              color: deltaPositive
                ? "#15803d"
                : deltaNegative
                ? "#ef4444"
                : "var(--ink-muted)",
              fontWeight: 500,
            }}
          >
            {delta}
          </div>
        )}
      </div>
      {sparkline && sparkline.length > 1 && <Sparkline points={sparkline} />}
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const w = 100;
  const h = 22;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ marginTop: 4 }}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--kottke-accent)"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Tab: Overview ───────────────────────────────────────────────────────────

function OverviewTab() {
  const [data, setData] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJSON<OverviewStats>("/api/v1/statistics/overview").then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  if (loading) return <Skeleton label="Lade KPIs…" />;
  if (!data) return <ErrorMsg />;

  const delta =
    data.revenueMtdDeltaPct == null
      ? null
      : `${data.revenueMtdDeltaPct >= 0 ? "+" : "−"}${Math.abs(
          data.revenueMtdDeltaPct
        )} %`;

  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
    >
      <KpiCard
        label="Umsatz YTD"
        value={fmtEUR(data.revenueYtd)}
        sparkline={data.revenueSeries8w}
      />
      <KpiCard
        label="Umsatz MTD"
        value={fmtEUR(data.revenueMtd)}
        delta={delta}
      />
      <KpiCard
        label="Neue Leads (30T)"
        value={fmtNum(data.newLeads30d)}
        sparkline={data.newLeadsSeries8w}
      />
      <KpiCard label="Win-Rate (90T)" value={fmtPct(data.winRate90dPct)} />
      <KpiCard
        label="Offene Forderungen"
        value={fmtEUR(data.outstandingAmount)}
      />
      <KpiCard label="Aufträge diese Woche" value={fmtNum(data.movesThisWeek)} />
    </div>
  );
}

// ─── Tab: Pipeline ───────────────────────────────────────────────────────────

function PipelineTab() {
  const [data, setData] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJSON<PipelineStats>("/api/v1/statistics/pipeline").then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  if (loading) return <Skeleton label="Lade Pipeline…" />;
  if (!data) return <ErrorMsg />;

  return (
    <div className="space-y-5">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        <KpiCard
          label="Ø Time-to-Close"
          value={
            data.avgTimeToCloseDays != null
              ? `${data.avgTimeToCloseDays} Tage`
              : "–"
          }
        />
        <KpiCard
          label="Ø Quote (offen)"
          value={fmtEUR(data.avgQuoteValueOpen)}
        />
        <KpiCard
          label="Ø Quote (gewonnen)"
          value={fmtEUR(data.avgQuoteValueWon)}
        />
        <KpiCard
          label="Stale Deals (>14T)"
          value={fmtNum(data.staleDeals.length)}
        />
      </div>

      <Panel title="Anzahl Deals pro Stage">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.stages}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="title" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(v: unknown) => [String(v), "Deals"]}
              contentStyle={tooltipStyle}
            />
            <Bar dataKey="count">
              {data.stages.map((s) => (
                <Cell key={s.stageId} fill={s.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Pipeline-Wert pro Stage">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.stages}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="title" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(v: unknown) => [fmtEUR(Number(v)), "Wert"]}
              contentStyle={tooltipStyle}
            />
            <Bar dataKey="totalValue">
              {data.stages.map((s) => (
                <Cell key={s.stageId} fill={s.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Stale Deals (nicht aktualisiert in den letzten 14 Tagen)">
        {data.staleDeals.length === 0 ? (
          <EmptyMsg>Keine vergessenen Deals. ✓</EmptyMsg>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ color: "var(--ink-muted)" }}>
                  <th className="text-left font-medium py-1.5">Deal</th>
                  <th className="text-left font-medium py-1.5">Stage</th>
                  <th className="text-right font-medium py-1.5">Tage</th>
                </tr>
              </thead>
              <tbody>
                {data.staleDeals.map((d) => (
                  <tr key={d.dealId} style={{ borderTop: "1px solid var(--line)" }}>
                    <td className="py-1.5">
                      <a
                        href={`/records/${d.dealId}`}
                        className="hover:underline"
                      >
                        {d.name}
                      </a>
                    </td>
                    <td className="py-1.5" style={{ color: "var(--ink-soft)" }}>
                      {d.stageTitle ?? "—"}
                    </td>
                    <td className="py-1.5 text-right font-mono">{d.daysStale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Tab: Revenue ────────────────────────────────────────────────────────────

interface FinancialOverviewResp {
  summary?: {
    totalIncome?: number;
    totalExpenses?: number;
    totalEmployeeCosts?: number;
    netProfit?: number;
  };
  series?: number[];
  expensesByCategory?: Record<string, number>;
}

function RevenueTab() {
  const [data, setData] = useState<FinancialOverviewResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJSON<FinancialOverviewResp>(
      "/api/v1/financial/overview?series=12"
    ).then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  const series = data?.series ?? [];
  const seriesData = useMemo(
    () =>
      series.map((v, i) => ({
        month: monthLabel(series.length - 1 - i),
        revenue: v,
      })),
    [series]
  );

  if (loading) return <Skeleton label="Lade Umsatzdaten…" />;
  if (!data) return <ErrorMsg />;

  const categoryData = Object.entries(data.expensesByCategory ?? {}).map(
    ([key, v]) => ({ name: categoryLabel(key), value: v })
  );

  const totalIncome = Number(data.summary?.totalIncome ?? 0);
  const totalExpenses = Number(data.summary?.totalExpenses ?? 0);
  const totalEmpCosts = Number(data.summary?.totalEmployeeCosts ?? 0);
  const netProfit = Number(data.summary?.netProfit ?? 0);

  return (
    <div className="space-y-5">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        <KpiCard label="Einnahmen gesamt" value={fmtEUR(totalIncome)} />
        <KpiCard label="Ausgaben gesamt" value={fmtEUR(totalExpenses)} />
        <KpiCard label="Lohnkosten" value={fmtEUR(totalEmpCosts)} />
        <KpiCard label="Nettoergebnis" value={fmtEUR(netProfit)} />
      </div>

      <Panel title="Monatsumsatz (12 Monate)">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={seriesData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(v: unknown) => [fmtEUR(Number(v)), "Umsatz"]}
              contentStyle={tooltipStyle}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="var(--kottke-accent)"
              fill="var(--kottke-accent)"
              fillOpacity={0.18}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {categoryData.length > 0 && (
        <Panel title="Ausgaben nach Kategorie">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={categoryData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(e: { name?: string }) => e.name ?? ""}
              >
                {categoryData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: unknown) => [fmtEUR(Number(v)), "Ausgabe"]}
                contentStyle={tooltipStyle}
              />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  );
}

// ─── Tab: Operations ─────────────────────────────────────────────────────────

function OperationsTab() {
  const [data, setData] = useState<OperationsStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJSON<OperationsStats>("/api/v1/statistics/operations").then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  if (loading) return <Skeleton label="Lade Aufträge…" />;
  if (!data) return <ErrorMsg />;

  return (
    <div className="space-y-5">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        <KpiCard
          label="Ø Personalstärke"
          value={
            data.workerCountAvg != null ? data.workerCountAvg.toString() : "–"
          }
          delta={
            data.workerCountMin != null && data.workerCountMax != null
              ? `${data.workerCountMin}–${data.workerCountMax}`
              : null
          }
        />
        <KpiCard
          label="Geplant (14T)"
          value={fmtNum(
            data.upcomingMoves.reduce((s, r) => s + r.count, 0)
          )}
        />
        <KpiCard
          label="Erledigt (Monat)"
          value={fmtNum(
            data.movesCompletedByMonth[data.movesCompletedByMonth.length - 1]
              ?.count ?? 0
          )}
        />
      </div>

      <Panel title="Erledigte Umzüge (letzte 6 Monate)">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.movesCompletedByMonth}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(v: unknown) => [String(v), "Umzüge"]}
              contentStyle={tooltipStyle}
            />
            <Bar dataKey="count" fill="var(--kottke-accent)" />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Auslastung (nächste 8 Wochen)">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.utilizationByWeek}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis
              dataKey="weekStart"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => weekShort(v)}
            />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(v: unknown) => [String(v), "Aufträge"]}
              contentStyle={tooltipStyle}
            />
            <Bar dataKey="count" fill="#0ea5e9" />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      {data.transporterMix.length > 0 && (
        <Panel title="Transporter-Mix (letzte 90 Tage)">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={data.transporterMix}
                dataKey="count"
                nameKey="title"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(e: { name?: string }) => e.name ?? ""}
              >
                {data.transporterMix.map((t, i) => (
                  <Cell key={i} fill={t.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  );
}

// ─── Tab: Team ───────────────────────────────────────────────────────────────

function TeamTab() {
  const [data, setData] = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchJSON<TeamStats>("/api/v1/statistics/team").then((d) => {
      setData(d);
      setLoading(false);
    });
  }, []);

  if (loading) return <Skeleton label="Lade Team-Daten…" />;
  if (!data) return <ErrorMsg />;

  const totalCompleted = data.tasksByWeek.reduce((s, r) => s + r.completed, 0);
  const totalOverdue = data.tasksByWeek.reduce((s, r) => s + r.overdue, 0);

  return (
    <div className="space-y-5">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        <KpiCard label="Erledigte Aufgaben (8W)" value={fmtNum(totalCompleted)} />
        <KpiCard label="Überfällig (8W)" value={fmtNum(totalOverdue)} />
        <KpiCard label="Aktive Owner" value={fmtNum(data.dealsByOwner.length)} />
      </div>

      <Panel title="Aufgaben: erledigt vs. überfällig (8 Wochen)">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.tasksByWeek}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis
              dataKey="weekStart"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => weekShort(v)}
            />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="completed" name="Erledigt" fill="#22c55e" stackId="a" />
            <Bar dataKey="overdue" name="Überfällig" fill="#ef4444" stackId="a" />
          </BarChart>
        </ResponsiveContainer>
      </Panel>

      <Panel title="Deals pro Owner">
        {data.dealsByOwner.length === 0 ? (
          <EmptyMsg>Noch keine Owner zugewiesen.</EmptyMsg>
        ) : (
          <ResponsiveContainer
            width="100%"
            height={Math.max(160, data.dealsByOwner.length * 32)}
          >
            <BarChart data={data.dealsByOwner} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="ownerId"
                tick={{ fontSize: 11 }}
                width={140}
                tickFormatter={(v) => shortId(v)}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="var(--kottke-accent)" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {data.newLeadsByOwner30d.length > 0 && (
        <Panel title="Neue Leads pro Owner (30 Tage)">
          <ResponsiveContainer
            width="100%"
            height={Math.max(160, data.newLeadsByOwner30d.length * 32)}
          >
            <BarChart data={data.newLeadsByOwner30d} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="ownerId"
                tick={{ fontSize: 11 }}
                width={140}
                tickFormatter={(v) => shortId(v)}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="#a855f7" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      )}
    </div>
  );
}

// ─── Tab: Company comparison ─────────────────────────────────────────────────

function CompareTab() {
  const [period, setPeriod] = useState<Period>("90d");
  const [data, setData] = useState<CompanyComparisonRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchJSON<{ rows: CompanyComparisonRow[] }>(
      `/api/v1/statistics/company-comparison?period=${period}`
    ).then((d) => {
      setData(d?.rows ?? []);
      setLoading(false);
    });
  }, [period]);

  const radarData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const maxRevenue = Math.max(...data.map((r) => r.revenue), 1);
    const maxMargin = Math.max(...data.map((r) => Math.max(0, r.margin)), 1);
    const maxAvg = Math.max(...data.map((r) => r.avgDealValue ?? 0), 1);
    const maxDeals = Math.max(...data.map((r) => r.dealsWon), 1);
    const axes = ["Umsatz", "Marge", "Win-Rate", "Volumen", "Ø Wert"];
    return axes.map((axis) => {
      const row: Record<string, number | string> = { axis };
      for (const c of data) {
        let v = 0;
        if (axis === "Umsatz") v = Math.round((c.revenue / maxRevenue) * 100);
        else if (axis === "Marge")
          v = Math.round((Math.max(0, c.margin) / maxMargin) * 100);
        else if (axis === "Win-Rate") v = c.winRatePct ?? 0;
        else if (axis === "Volumen")
          v = Math.round((c.dealsWon / maxDeals) * 100);
        else if (axis === "Ø Wert")
          v = Math.round(((c.avgDealValue ?? 0) / maxAvg) * 100);
        row[c.companyName] = v;
      }
      return row;
    });
  }, [data]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
          Zeitraum:
        </span>
        {(["30d", "90d", "365d", "ytd"] as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className="rounded-md px-2.5 py-1 text-[12px]"
            style={{
              border: "1px solid var(--line)",
              background:
                period === p ? "var(--kottke-accent)" : "var(--paper)",
              color: period === p ? "var(--paper)" : "var(--ink-soft)",
              fontWeight: period === p ? 500 : 400,
            }}
          >
            {p === "ytd" ? "YTD" : p.replace("d", " Tage")}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton label="Lade Vergleich…" />
      ) : !data || data.length === 0 ? (
        <EmptyMsg>Keine Operating-Companies mit Daten im gewählten Zeitraum.</EmptyMsg>
      ) : (
        <>
          <Panel title="Umsatz nach Operating Company">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="companyName" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: unknown) => [fmtEUR(Number(v)), "Umsatz"]}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="revenue" fill="var(--kottke-accent)" />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Gewinnmarge (Umsatz − Ausgaben − Lohn)">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="companyName" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  formatter={(v: unknown) => [fmtEUR(Number(v)), "Marge"]}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="margin" fill="#15803d" />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="Win-Rate (%)">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="companyName" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                <Tooltip
                  formatter={(v: unknown) => [`${Number(v)} %`, "Win-Rate"]}
                  contentStyle={tooltipStyle}
                />
                <Bar dataKey="winRatePct" fill="#a855f7" />
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          {data.length >= 2 && (
            <Panel title="Radar-Vergleich (normalisiert, 0–100)">
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="var(--line)" />
                  <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11 }} />
                  <PolarRadiusAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  {data.map((c, i) => (
                    <Radar
                      key={c.companyId}
                      name={c.companyName}
                      dataKey={c.companyName}
                      stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                      fill={RADAR_COLORS[i % RADAR_COLORS.length]}
                      fillOpacity={0.15}
                    />
                  ))}
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} />
                </RadarChart>
              </ResponsiveContainer>
            </Panel>
          )}

          <Panel title="Übersicht">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ color: "var(--ink-muted)" }}>
                    <th className="text-left font-medium py-1.5">Firma</th>
                    <th className="text-right font-medium py-1.5">Umsatz</th>
                    <th className="text-right font-medium py-1.5">Ausgaben</th>
                    <th className="text-right font-medium py-1.5">Lohn</th>
                    <th className="text-right font-medium py-1.5">Marge</th>
                    <th className="text-right font-medium py-1.5">Marge&nbsp;%</th>
                    <th className="text-right font-medium py-1.5">Gewonnen</th>
                    <th className="text-right font-medium py-1.5">Verloren</th>
                    <th className="text-right font-medium py-1.5">Win-Rate</th>
                    <th className="text-right font-medium py-1.5">Ø Wert</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((r) => (
                    <tr
                      key={r.companyId}
                      style={{ borderTop: "1px solid var(--line)" }}
                    >
                      <td className="py-1.5">{r.companyName}</td>
                      <td className="py-1.5 text-right font-mono">{fmtEUR(r.revenue)}</td>
                      <td className="py-1.5 text-right font-mono">{fmtEUR(r.expenses)}</td>
                      <td className="py-1.5 text-right font-mono">{fmtEUR(r.employeeCosts)}</td>
                      <td className="py-1.5 text-right font-mono">{fmtEUR(r.margin)}</td>
                      <td className="py-1.5 text-right font-mono">{fmtPct(r.marginPct)}</td>
                      <td className="py-1.5 text-right font-mono">{r.dealsWon}</td>
                      <td className="py-1.5 text-right font-mono">{r.dealsLost}</td>
                      <td className="py-1.5 text-right font-mono">{fmtPct(r.winRatePct)}</td>
                      <td className="py-1.5 text-right font-mono">
                        {fmtEUR(r.avgDealValue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

const tooltipStyle = {
  background: "var(--paper)",
  border: "1px solid var(--line)",
  borderRadius: 8,
  fontSize: 12,
} as const;

const PIE_COLORS = [
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#f97316",
  "#22c55e",
  "#0ea5e9",
  "#eab308",
  "#14b8a6",
];

const RADAR_COLORS = [
  "#6366f1",
  "#22c55e",
  "#ef4444",
  "#0ea5e9",
  "#a855f7",
  "#f97316",
];

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl"
      style={{
        background: "var(--paper)",
        border: "1px solid var(--line)",
        padding: "14px 16px",
      }}
    >
      <h2
        className="k-display"
        style={{
          fontSize: 14,
          fontWeight: 500,
          marginBottom: 12,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div
      className="text-[13px]"
      style={{ color: "var(--ink-muted)", padding: 24 }}
    >
      {label}
    </div>
  );
}

function ErrorMsg() {
  return (
    <div
      className="text-[13px]"
      style={{ color: "#ef4444", padding: 24 }}
    >
      Daten konnten nicht geladen werden.
    </div>
  );
}

function EmptyMsg({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[13px]"
      style={{ color: "var(--ink-muted)", padding: "12px 4px" }}
    >
      {children}
    </div>
  );
}

function monthLabel(offset: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - offset);
  return d.toLocaleDateString("de-DE", { month: "short" });
}

function weekShort(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.`;
}

function shortId(id: string): string {
  if (!id) return "—";
  return id.length > 12 ? id.slice(0, 6) + "…" + id.slice(-3) : id;
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel: "Sprit",
  truck_rental: "LKW-Miete",
  equipment: "Werkzeug",
  subcontractor: "Subunternehmer",
  toll: "Maut",
  other: "Sonstiges",
};

function categoryLabel(key: string) {
  return CATEGORY_LABELS[key] ?? key;
}
