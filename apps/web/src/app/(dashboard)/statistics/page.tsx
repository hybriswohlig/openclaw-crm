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

type LeadChannelType = "email" | "whatsapp" | "sms";
type LeadSource =
  | "kleinanzeigen"
  | "whatsapp"
  | "sms"
  | "email_direct"
  | "immobilienscout"
  | "other";

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
  movesCompleted: number;
  revenuePerMove: number | null;
  costPerMove: number | null;
  laborRatioPct: number | null;
  expenseRatioPct: number | null;
  crossSubsidyIn: number;
  crossSubsidyOut: number;
  newLeads: number;
  filteredOutLeads: number;
  leadsByChannel: { channelType: LeadChannelType; count: number }[];
  leadsBySource: { source: LeadSource; count: number }[];
  leadToWinRatePct: number | null;
  monthlySeries: {
    month: string;
    revenue: number;
    profit: number;
    moves: number;
    leads: number;
  }[];
  score: number;
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

type TrendMetric = "revenue" | "profit" | "moves" | "leads";

const TREND_LABELS: Record<TrendMetric, string> = {
  revenue: "Umsatz",
  profit: "Profit",
  moves: "Umzüge",
  leads: "Leads",
};

const CHANNEL_LABELS: Record<LeadChannelType, string> = {
  email: "E-Mail",
  whatsapp: "WhatsApp",
  sms: "SMS",
};

const CHANNEL_COLORS: Record<LeadChannelType, string> = {
  email: "#6366f1",
  whatsapp: "#22c55e",
  sms: "#f97316",
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  kleinanzeigen: "Kleinanzeigen",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email_direct: "E-Mail (direkt)",
  immobilienscout: "Immobilienscout",
  other: "Sonstige",
};

const SOURCE_COLORS: Record<LeadSource, string> = {
  kleinanzeigen: "#96c11f",
  whatsapp: "#22c55e",
  sms: "#f97316",
  email_direct: "#6366f1",
  immobilienscout: "#ec4899",
  other: "#94a3b8",
};

function CompareTab() {
  const [period, setPeriod] = useState<Period>("90d");
  const [data, setData] = useState<CompanyComparisonRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("revenue");

  useEffect(() => {
    setLoading(true);
    fetchJSON<{ rows: CompanyComparisonRow[] }>(
      `/api/v1/statistics/company-comparison?period=${period}`
    ).then((d) => {
      setData(d?.rows ?? []);
      setLoading(false);
    });
  }, [period]);

  // Per-metric rank (1 = best). Higher is better for all of these.
  const ranks = useMemo(() => {
    if (!data || data.length === 0) return new Map<string, Record<string, number>>();
    const metrics: { key: string; get: (r: CompanyComparisonRow) => number }[] = [
      { key: "revenue", get: (r) => r.revenue },
      { key: "marginPct", get: (r) => r.marginPct ?? -Infinity },
      { key: "winRatePct", get: (r) => r.winRatePct ?? -Infinity },
      { key: "movesCompleted", get: (r) => r.movesCompleted },
      { key: "leadToWinRatePct", get: (r) => r.leadToWinRatePct ?? -Infinity },
      { key: "revenuePerMove", get: (r) => r.revenuePerMove ?? -Infinity },
    ];
    const out = new Map<string, Record<string, number>>();
    for (const m of metrics) {
      const sorted = [...data].sort((a, b) => m.get(b) - m.get(a));
      sorted.forEach((row, idx) => {
        const r = out.get(row.companyId) ?? {};
        r[m.key] = idx + 1;
        out.set(row.companyId, r);
      });
    }
    return out;
  }, [data]);

  // Workspace medians for efficiency color coding
  const medians = useMemo(() => {
    if (!data || data.length === 0) return null;
    const median = (vals: number[]) => {
      const v = vals.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
      if (v.length === 0) return 0;
      const mid = Math.floor(v.length / 2);
      return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    };
    return {
      revenuePerMove: median(data.map((r) => r.revenuePerMove ?? 0)),
      laborRatio: median(data.map((r) => r.laborRatioPct ?? 0)),
      expenseRatio: median(data.map((r) => r.expenseRatioPct ?? 0)),
    };
  }, [data]);

  const trendChartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const months = data[0].monthlySeries.map((m) => m.month);
    return months.map((mk, idx) => {
      const row: Record<string, number | string> = { month: monthShort(mk) };
      for (const c of data) {
        row[c.companyName] = c.monthlySeries[idx]?.[trendMetric] ?? 0;
      }
      return row;
    });
  }, [data, trendMetric]);

  const radarData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const maxRevenue = Math.max(...data.map((r) => r.revenue), 1);
    const maxAvg = Math.max(...data.map((r) => r.avgDealValue ?? 0), 1);
    const maxMoves = Math.max(...data.map((r) => r.movesCompleted), 1);
    const axes: { label: string; getNorm: (r: CompanyComparisonRow) => number; getAbs: (r: CompanyComparisonRow) => string }[] = [
      {
        label: "Umsatz",
        getNorm: (r) => Math.round((r.revenue / maxRevenue) * 100),
        getAbs: (r) => fmtEUR(r.revenue),
      },
      {
        label: "Marge %",
        getNorm: (r) => Math.max(0, Math.min(100, r.marginPct ?? 0)),
        getAbs: (r) => fmtPct(r.marginPct),
      },
      {
        label: "Win-Rate",
        getNorm: (r) => r.winRatePct ?? 0,
        getAbs: (r) => fmtPct(r.winRatePct),
      },
      {
        label: "Volumen",
        getNorm: (r) => Math.round((r.movesCompleted / maxMoves) * 100),
        getAbs: (r) => `${r.movesCompleted} Umzüge`,
      },
      {
        label: "Ø Wert",
        getNorm: (r) => Math.round(((r.avgDealValue ?? 0) / maxAvg) * 100),
        getAbs: (r) => fmtEUR(r.avgDealValue),
      },
    ];
    return axes.map((axis) => {
      const row: Record<string, number | string> = { axis: axis.label };
      for (const c of data) {
        row[c.companyName] = axis.getNorm(c);
        row[`${c.companyName}__abs`] = axis.getAbs(c);
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
          <LeaderScorecard data={data} ranks={ranks} />

          <Panel
            title="Trend (letzte 6 Monate)"
            right={
              <div className="flex gap-1">
                {(Object.keys(TREND_LABELS) as TrendMetric[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setTrendMetric(m)}
                    className="rounded-md px-2 py-1 text-[11.5px]"
                    style={{
                      border: "1px solid var(--line)",
                      background:
                        trendMetric === m ? "var(--kottke-accent)" : "var(--paper)",
                      color:
                        trendMetric === m ? "var(--paper)" : "var(--ink-soft)",
                      fontWeight: trendMetric === m ? 500 : 400,
                    }}
                  >
                    {TREND_LABELS[m]}
                  </button>
                ))}
              </div>
            }
          >
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    trendMetric === "revenue" || trendMetric === "profit"
                      ? `${(v / 1000).toFixed(0)}k`
                      : String(v)
                  }
                />
                <Tooltip
                  formatter={(v: unknown, name: unknown) => [
                    trendMetric === "revenue" || trendMetric === "profit"
                      ? fmtEUR(Number(v))
                      : fmtNum(Number(v)),
                    String(name ?? ""),
                  ]}
                  contentStyle={tooltipStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {data.map((c, i) => (
                  <Line
                    key={c.companyId}
                    type="monotone"
                    dataKey={c.companyName}
                    stroke={RADAR_COLORS[i % RADAR_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Panel>

          <LeadIntakePanel data={data} />

          <LeadSourceBreakdown data={data} />

          {medians && <EfficiencyGrid data={data} medians={medians} />}

          <CrossSubsidyPanel data={data} />

          {data.length >= 2 && (
            <Panel title="Radar-Vergleich (normalisiert, 0 bis 100)">
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
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(_v: unknown, name: unknown, item: unknown) => {
                      const nm = String(name ?? "");
                      const payload = (item as { payload?: Record<string, unknown> } | undefined)?.payload;
                      const abs = payload?.[`${nm}__abs`];
                      return [typeof abs === "string" ? abs : String(_v), nm];
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </Panel>
          )}

          <RankingTable data={data} ranks={ranks} />
        </>
      )}
    </div>
  );
}

// ─── Sub-components for the compare tab ──────────────────────────────────────

function LeaderScorecard({
  data,
  ranks,
}: {
  data: CompanyComparisonRow[];
  ranks: Map<string, Record<string, number>>;
}) {
  const rankIcon = (n: number) => (n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : `#${n}`);

  return (
    <Panel title="Leader-Scorecard">
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
      >
        {data.map((c, i) => {
          const r = ranks.get(c.companyId) ?? {};
          const accent = RADAR_COLORS[i % RADAR_COLORS.length];
          return (
            <div
              key={c.companyId}
              className="rounded-xl"
              style={{
                border: "1px solid var(--line)",
                background: "var(--paper)",
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: accent,
                    }}
                  />
                  <span style={{ fontWeight: 500 }}>{c.companyName}</span>
                </div>
                <div
                  className="text-[11px]"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 6,
                    padding: "2px 6px",
                    color: "var(--ink-soft)",
                  }}
                >
                  Score {c.score}
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <div
                  className="k-display"
                  style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em" }}
                >
                  {fmtEUR(c.revenue)}
                </div>
                <div className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                  Umsatz
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <RankChip label="Umsatz" rank={r.revenue} icon={rankIcon(r.revenue)} />
                <RankChip label="Marge" rank={r.marginPct} icon={rankIcon(r.marginPct)} />
                <RankChip label="Win" rank={r.winRatePct} icon={rankIcon(r.winRatePct)} />
                <RankChip label="Volumen" rank={r.movesCompleted} icon={rankIcon(r.movesCompleted)} />
                <RankChip label="Conv." rank={r.leadToWinRatePct} icon={rankIcon(r.leadToWinRatePct)} />
              </div>
              <div
                className="text-[12px] grid grid-cols-3 gap-2"
                style={{ color: "var(--ink-muted)", marginTop: 2 }}
              >
                <div>
                  <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>
                    {fmtPct(c.marginPct)}
                  </div>
                  <div>Marge</div>
                </div>
                <div>
                  <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>
                    {c.movesCompleted}
                  </div>
                  <div>Umzüge</div>
                </div>
                <div>
                  <div style={{ color: "var(--ink-soft)", fontWeight: 500 }}>
                    {c.newLeads}
                  </div>
                  <div>Leads</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function RankChip({
  label,
  rank,
  icon,
}: {
  label: string;
  rank: number | undefined;
  icon: string;
}) {
  if (!rank) return null;
  const accent = rank === 1 ? "#15803d" : rank === 2 ? "#0ea5e9" : rank === 3 ? "#a855f7" : "var(--ink-muted)";
  return (
    <span
      className="text-[11px]"
      style={{
        border: "1px solid var(--line)",
        borderRadius: 999,
        padding: "1px 8px",
        display: "inline-flex",
        gap: 4,
        alignItems: "center",
        color: accent,
      }}
    >
      <span>{icon}</span>
      <span style={{ color: "var(--ink-soft)" }}>{label}</span>
    </span>
  );
}

function LeadIntakePanel({ data }: { data: CompanyComparisonRow[] }) {
  const stackedData = data.map((c) => {
    const row: Record<string, string | number> = { companyName: c.companyName };
    for (const ch of c.leadsByChannel) row[CHANNEL_LABELS[ch.channelType]] = ch.count;
    return row;
  });
  const channels: LeadChannelType[] = ["email", "whatsapp", "sms"];
  const totalFiltered = data.reduce((s, c) => s + c.filteredOutLeads, 0);

  return (
    <Panel
      title="Lead-Aufkommen je Operating Company"
      right={
        totalFiltered > 0 ? (
          <span
            className="text-[11.5px]"
            style={{
              color: "var(--ink-muted)",
              border: "1px solid var(--line)",
              background: "var(--surface)",
              borderRadius: 6,
              padding: "2px 8px",
            }}
            title="Noreply, Newsletter, System-Benachrichtigungen und ähnliche automatisierte E-Mails wurden ausgeschlossen"
          >
            {totalFiltered} gefiltert
          </span>
        ) : null
      }
    >
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)" }}>
        <div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={stackedData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="companyName" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {channels.map((ch) => (
                <Bar
                  key={ch}
                  dataKey={CHANNEL_LABELS[ch]}
                  stackId="leads"
                  fill={CHANNEL_COLORS[ch]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div>
          <div
            className="text-[11.5px] mb-2"
            style={{ color: "var(--ink-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}
          >
            Conversion (Leads zu gewonnen)
          </div>
          <div className="space-y-2">
            {data.map((c, i) => {
              const conv = c.leadToWinRatePct ?? 0;
              const accent = RADAR_COLORS[i % RADAR_COLORS.length];
              return (
                <div key={c.companyId}>
                  <div className="flex justify-between text-[12px]">
                    <span style={{ color: "var(--ink-soft)" }}>
                      {c.companyName}
                      {c.filteredOutLeads > 0 && (
                        <span
                          className="ml-1.5 text-[10.5px]"
                          style={{ color: "var(--ink-muted)" }}
                          title="Automatisierte E-Mails ausgeschlossen"
                        >
                          ({c.filteredOutLeads} gefiltert)
                        </span>
                      )}
                    </span>
                    <span className="font-mono" style={{ color: "var(--ink-soft)" }}>
                      {c.dealsWon} / {c.newLeads} · {fmtPct(c.leadToWinRatePct)}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      background: "var(--surface)",
                      borderRadius: 999,
                      overflow: "hidden",
                      marginTop: 2,
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(100, conv)}%`,
                        background: accent,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function LeadSourceBreakdown({ data }: { data: CompanyComparisonRow[] }) {
  // Aggregate workspace-wide totals for the comparison bar at the bottom.
  const totals = new Map<LeadSource, number>();
  for (const c of data) {
    for (const s of c.leadsBySource) {
      totals.set(s.source, (totals.get(s.source) ?? 0) + s.count);
    }
  }
  const totalLeads = [...totals.values()].reduce((s, v) => s + v, 0);

  return (
    <Panel title="Lead-Quellen je Operating Company">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
      >
        {data.map((c) => {
          const slices = c.leadsBySource;
          const total = slices.reduce((s, x) => s + x.count, 0);
          return (
            <div
              key={c.companyId}
              className="rounded-xl"
              style={{
                border: "1px solid var(--line)",
                background: "var(--paper)",
                padding: "12px 14px",
              }}
            >
              <div className="flex items-baseline justify-between mb-2">
                <span style={{ fontWeight: 500 }}>{c.companyName}</span>
                <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                  {total} Leads
                </span>
              </div>
              {total === 0 ? (
                <div
                  className="text-[12px]"
                  style={{ color: "var(--ink-muted)", padding: "24px 0", textAlign: "center" }}
                >
                  Keine Leads im Zeitraum.
                </div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={slices}
                        dataKey="count"
                        nameKey="source"
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={70}
                        paddingAngle={2}
                      >
                        {slices.map((s) => (
                          <Cell key={s.source} fill={SOURCE_COLORS[s.source]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v: unknown, name: unknown) => {
                          const key = String(name ?? "") as LeadSource;
                          const label = SOURCE_LABELS[key] ?? String(name ?? "");
                          const count = Number(v);
                          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                          return [`${count} (${pct} %)`, label];
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                    {slices.map((s) => {
                      const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
                      return (
                        <div
                          key={s.source}
                          className="flex items-center gap-1.5 text-[11.5px]"
                          style={{ color: "var(--ink-soft)" }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: SOURCE_COLORS[s.source],
                            }}
                          />
                          <span>{SOURCE_LABELS[s.source]}</span>
                          <span className="font-mono" style={{ color: "var(--ink-muted)" }}>
                            {s.count} · {pct} %
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {totalLeads > 0 && (
        <div className="mt-4">
          <div
            className="text-[11.5px] mb-2"
            style={{ color: "var(--ink-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}
          >
            Quellenverteilung über alle Firmen
          </div>
          <div
            style={{
              display: "flex",
              height: 12,
              borderRadius: 999,
              overflow: "hidden",
              border: "1px solid var(--line)",
            }}
          >
            {[...totals.entries()].map(([source, count]) => {
              const w = (count / totalLeads) * 100;
              return (
                <div
                  key={source}
                  style={{
                    width: `${w}%`,
                    background: SOURCE_COLORS[source],
                  }}
                  title={`${SOURCE_LABELS[source]}: ${count} (${Math.round(w)} %)`}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {[...totals.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([source, count]) => (
                <div
                  key={source}
                  className="flex items-center gap-1.5 text-[11.5px]"
                  style={{ color: "var(--ink-soft)" }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: SOURCE_COLORS[source],
                    }}
                  />
                  <span>{SOURCE_LABELS[source]}</span>
                  <span className="font-mono" style={{ color: "var(--ink-muted)" }}>
                    {count}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

function EfficiencyGrid({
  data,
  medians,
}: {
  data: CompanyComparisonRow[];
  medians: { revenuePerMove: number; laborRatio: number; expenseRatio: number };
}) {
  // For revenuePerMove higher is better. For laborRatio / expenseRatio lower is better.
  const colorEUR = (v: number | null) => {
    if (v == null || medians.revenuePerMove === 0) return "var(--ink-soft)";
    if (v >= medians.revenuePerMove * 1.05) return "#15803d";
    if (v <= medians.revenuePerMove * 0.95) return "#ef4444";
    return "var(--ink-soft)";
  };
  const colorPctLowerBetter = (v: number | null, median: number) => {
    if (v == null || median === 0) return "var(--ink-soft)";
    if (v <= median * 0.95) return "#15803d";
    if (v >= median * 1.05) return "#ef4444";
    return "var(--ink-soft)";
  };

  return (
    <Panel title="Effizienz pro Umzug & Kostenstruktur">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ color: "var(--ink-muted)" }}>
              <th className="text-left font-medium py-1.5">Firma</th>
              <th className="text-right font-medium py-1.5">Umzüge</th>
              <th className="text-right font-medium py-1.5">Umsatz / Umzug</th>
              <th className="text-right font-medium py-1.5">Kosten / Umzug</th>
              <th className="text-right font-medium py-1.5">Lohn-Quote</th>
              <th className="text-right font-medium py-1.5">Kosten-Quote</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.companyId} style={{ borderTop: "1px solid var(--line)" }}>
                <td className="py-1.5">{r.companyName}</td>
                <td className="py-1.5 text-right font-mono">{r.movesCompleted}</td>
                <td
                  className="py-1.5 text-right font-mono"
                  style={{ color: colorEUR(r.revenuePerMove) }}
                >
                  {fmtEUR(r.revenuePerMove)}
                </td>
                <td className="py-1.5 text-right font-mono" style={{ color: "var(--ink-soft)" }}>
                  {fmtEUR(r.costPerMove)}
                </td>
                <td
                  className="py-1.5 text-right font-mono"
                  style={{ color: colorPctLowerBetter(r.laborRatioPct, medians.laborRatio) }}
                >
                  {fmtPct(r.laborRatioPct)}
                </td>
                <td
                  className="py-1.5 text-right font-mono"
                  style={{ color: colorPctLowerBetter(r.expenseRatioPct, medians.expenseRatio) }}
                >
                  {fmtPct(r.expenseRatioPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-[11px] mt-2" style={{ color: "var(--ink-muted)" }}>
          Farben relativ zum Workspace-Median: grün besser, rot schlechter (Marge 5 % Abweichung).
        </div>
      </div>
    </Panel>
  );
}

function CrossSubsidyPanel({ data }: { data: CompanyComparisonRow[] }) {
  const totalCross = data.reduce((s, r) => s + r.crossSubsidyOut, 0);
  if (totalCross === 0) return null;

  return (
    <Panel title="Quersubvention zwischen Firmen">
      <div className="space-y-2">
        {data
          .filter((r) => r.crossSubsidyIn > 0 || r.crossSubsidyOut > 0)
          .map((r) => (
            <div
              key={r.companyId}
              className="flex items-center justify-between text-[13px]"
              style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}
            >
              <span style={{ fontWeight: 500 }}>{r.companyName}</span>
              <div className="flex gap-4">
                <span style={{ color: r.crossSubsidyIn > 0 ? "#15803d" : "var(--ink-muted)" }}>
                  Erhalten <span className="font-mono">{fmtEUR(r.crossSubsidyIn)}</span>
                </span>
                <span style={{ color: r.crossSubsidyOut > 0 ? "#ef4444" : "var(--ink-muted)" }}>
                  Gezahlt <span className="font-mono">{fmtEUR(r.crossSubsidyOut)}</span>
                </span>
              </div>
            </div>
          ))}
        <div className="text-[11px] mt-2" style={{ color: "var(--ink-muted)" }}>
          Ausgaben oder Löhne, die eine Firma für einen Auftrag einer anderen Firma getragen hat.
        </div>
      </div>
    </Panel>
  );
}

function RankingTable({
  data,
  ranks,
}: {
  data: CompanyComparisonRow[];
  ranks: Map<string, Record<string, number>>;
}) {
  const rankBadge = (n: number | undefined) => {
    if (!n) return null;
    const color = n === 1 ? "#15803d" : n === 2 ? "#0ea5e9" : n === 3 ? "#a855f7" : "var(--ink-muted)";
    return (
      <span
        className="text-[10px]"
        style={{
          background: "var(--surface)",
          color,
          border: "1px solid var(--line)",
          borderRadius: 999,
          padding: "0px 5px",
          marginLeft: 4,
        }}
      >
        #{n}
      </span>
    );
  };

  return (
    <Panel title="Detaillierte Rangliste">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr style={{ color: "var(--ink-muted)" }}>
              <th className="text-left font-medium py-1.5">Firma</th>
              <th className="text-left font-medium py-1.5">6-Mo. Umsatz</th>
              <th className="text-right font-medium py-1.5">Umsatz</th>
              <th className="text-right font-medium py-1.5">Marge</th>
              <th className="text-right font-medium py-1.5">Marge %</th>
              <th className="text-right font-medium py-1.5">Umzüge</th>
              <th className="text-right font-medium py-1.5">Gewonnen</th>
              <th className="text-right font-medium py-1.5">Verloren</th>
              <th className="text-right font-medium py-1.5">Win</th>
              <th className="text-right font-medium py-1.5">Leads</th>
              <th className="text-right font-medium py-1.5">Conv.</th>
              <th className="text-right font-medium py-1.5">Ø Wert</th>
              <th className="text-right font-medium py-1.5">Score</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => {
              const rr = ranks.get(r.companyId) ?? {};
              return (
                <tr key={r.companyId} style={{ borderTop: "1px solid var(--line)" }}>
                  <td className="py-1.5" style={{ fontWeight: 500 }}>
                    {r.companyName}
                  </td>
                  <td className="py-1.5" style={{ minWidth: 100 }}>
                    <Sparkline points={r.monthlySeries.map((m) => m.revenue)} />
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {fmtEUR(r.revenue)}
                    {rankBadge(rr.revenue)}
                  </td>
                  <td className="py-1.5 text-right font-mono">{fmtEUR(r.margin)}</td>
                  <td className="py-1.5 text-right font-mono">
                    {fmtPct(r.marginPct)}
                    {rankBadge(rr.marginPct)}
                  </td>
                  <td className="py-1.5 text-right font-mono">
                    {r.movesCompleted}
                    {rankBadge(rr.movesCompleted)}
                  </td>
                  <td className="py-1.5 text-right font-mono">{r.dealsWon}</td>
                  <td className="py-1.5 text-right font-mono">{r.dealsLost}</td>
                  <td className="py-1.5 text-right font-mono">
                    {fmtPct(r.winRatePct)}
                    {rankBadge(rr.winRatePct)}
                  </td>
                  <td className="py-1.5 text-right font-mono">{r.newLeads}</td>
                  <td className="py-1.5 text-right font-mono">
                    {fmtPct(r.leadToWinRatePct)}
                    {rankBadge(rr.leadToWinRatePct)}
                  </td>
                  <td className="py-1.5 text-right font-mono">{fmtEUR(r.avgDealValue)}</td>
                  <td className="py-1.5 text-right font-mono" style={{ fontWeight: 500 }}>
                    {r.score}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
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
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
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
      <div
        className="flex items-center justify-between"
        style={{ marginBottom: 12 }}
      >
        <h2
          className="k-display"
          style={{
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        {right}
      </div>
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

function monthShort(yyyymm: string): string {
  if (!yyyymm) return "";
  const [y, m] = yyyymm.split("-").map(Number);
  if (!y || !m) return yyyymm;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("de-DE", { month: "short" });
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
