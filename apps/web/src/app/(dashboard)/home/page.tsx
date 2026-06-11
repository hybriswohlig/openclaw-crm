"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "@/lib/auth-client";
import { EmployeeAvatar } from "@/components/employees/employee-avatar";
import {
  ArrowRight,
  CalendarClock,
  Hourglass,
  Inbox as InboxIcon,
  MapPin,
  MessageCircle,
  Phone,
  Plus,
  TrendingUp,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────

interface OpsDeal {
  dealId: string;
  dealNumber: string | null;
  name: string;
  stage: { title: string; color: string } | null;
  moveDate: string | null;
  moveFromAddress: string | null;
  moveToAddress: string | null;
  auftragId: string | null;
  transporter: { id: string; title: string; color: string } | null;
  workerCount: number | null;
  timeStart: string | null;
  timeEnd: string | null;
  customerPhone: string | null;
  conversationId: string | null;
  assignedEmployees: Array<{
    assignmentId: string;
    employeeId: string;
    name: string;
    role: string;
    photoBase64: string | null;
  }>;
}

interface FinancialOverview {
  totals?: {
    income?: string | number;
    expenses?: string | number;
    employeeCosts?: string | number;
    profit?: string | number;
  };
  series?: number[];
}

interface ActivityEvent {
  id: string;
  eventType: string;
  recordId: string | null;
  objectSlug: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function greetingFor(hour: number): string {
  if (hour < 5) return "Gute Nacht";
  if (hour < 11) return "Moin";
  if (hour < 14) return "Hallo";
  if (hour < 18) return "Hey";
  return "Guten Abend";
}

function firstName(full?: string | null): string {
  if (!full) return "Team";
  return full.trim().split(/\s+/)[0] ?? "Team";
}

function formatDayLabelDE(iso: string): { weekday: string; day: string } {
  const d = new Date(iso + "T00:00:00");
  const weekday = d.toLocaleDateString("de-DE", { weekday: "short" });
  const day = String(d.getDate());
  return { weekday, day };
}

function formatFullDE(d: Date): string {
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTimeDE(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 86400000);
}

function formatRelativeMoveDate(iso: string | null): string {
  if (!iso) return "kein Datum";
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const target = new Date(iso + "T00:00:00");
  const diff = daysBetween(start, target);
  if (diff === 0) return "heute";
  if (diff === 1) return "morgen";
  if (diff < 0) return `vor ${Math.abs(diff)} Tagen`;
  if (diff < 7) return `in ${diff} Tagen`;
  return target.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function currentMonthParam(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtEUR(value: number): string {
  return value.toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function parseTimeToMinutes(t: string | null): number | null {
  if (!t) return null;
  const [hh, mm] = t.split(":").map(Number);
  if (Number.isNaN(hh)) return null;
  return hh * 60 + (mm || 0);
}

function computeProgress(deal: {
  moveDate: string | null;
  timeStart: string | null;
  timeEnd: string | null;
}): number {
  // Outside the move date → 0
  const today = todayISO();
  if (deal.moveDate !== today) return 0;
  const start = parseTimeToMinutes(deal.timeStart);
  const end = parseTimeToMinutes(deal.timeEnd);
  if (start == null || end == null || end <= start) return 0.5;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin <= start) return 0;
  if (nowMin >= end) return 1;
  return (nowMin - start) / (end - start);
}

// ─── Page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { data: session } = useSession();

  const [deals, setDeals] = useState<OpsDeal[]>([]);
  const [financial, setFinancial] = useState<FinancialOverview | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [opsRes, finRes] = await Promise.all([
        fetch("/api/v1/operations"),
        fetch(
          `/api/v1/financial/overview?month=${currentMonthParam()}&series=6`
        ),
      ]);
      if (opsRes.ok) {
        const json = await opsRes.json();
        setDeals((json.data?.deals ?? []) as OpsDeal[]);
      }
      if (finRes.ok) {
        const json = await finRes.json();
        setFinancial(json.data ?? null);
      }
      // Recent activity — best effort; the home page still works without it.
      try {
        const actRes = await fetch("/api/v1/activity?limit=6");
        if (actRes.ok) {
          const json = await actRes.json();
          setActivity(json.data ?? []);
        }
      } catch {
        /* noop */
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const today = todayISO();

  const focusJob = useMemo<OpsDeal | null>(() => {
    // Prefer today's first scheduled lead; fall back to the next upcoming.
    const todayLeads = deals.filter((d) => d.moveDate === today);
    if (todayLeads.length > 0) {
      return [...todayLeads].sort((a, b) =>
        (a.timeStart ?? "99").localeCompare(b.timeStart ?? "99")
      )[0];
    }
    const upcoming = deals.filter((d) => d.moveDate && d.moveDate >= today);
    if (upcoming.length === 0) return null;
    return [...upcoming].sort((a, b) =>
      (a.moveDate ?? "").localeCompare(b.moveDate ?? "")
    )[0];
  }, [deals, today]);

  const upcomingList = useMemo(() => {
    return deals
      .filter((d) => d.moveDate && d.moveDate >= today)
      .sort((a, b) => (a.moveDate ?? "").localeCompare(b.moveDate ?? ""))
      .slice(0, 5);
  }, [deals, today]);

  const activeCount = deals.length;
  const todayCount = deals.filter((d) => d.moveDate === today).length;

  // Revenue numbers (current month).
  const income = Number(financial?.totals?.income ?? 0);

  const user = session?.user;

  return (
    <div className="k-paper-noise min-h-full">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-8 sm:py-8">
        {/* ── Greeting row ────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {now && (
              <div
                className="k-label mb-1.5"
                style={{ fontSize: 11, color: "var(--ink-muted)" }}
              >
                {formatFullDE(now)}
              </div>
            )}
            <h1
              className="k-display"
              style={{
                margin: 0,
                fontSize: "clamp(30px, 5vw, 40px)",
                lineHeight: 1.05,
                fontVariationSettings: '"opsz" 96, "SOFT" 100',
              }}
            >
              {now ? greetingFor(now.getHours()) : "Moin"}{" "}
              <em
                style={{
                  fontStyle: "italic",
                  color: "var(--kottke-accent)",
                }}
              >
                {firstName(user?.name)}
              </em>
              .
            </h1>
            <p
              className="mt-2 text-[14px]"
              style={{ color: "var(--ink-soft)" }}
            >
              {activeCount} aktive Aufträge · {todayCount} heute
              {todayCount > 0 ? " — bereit loszulegen." : "."}
            </p>
          </div>

          <div className="flex gap-2">
            <Link href="/objects/deals">
              <button className="k-btn">
                <Plus className="h-[15px] w-[15px]" />
                Neuer Lead
              </button>
            </Link>
            <Link href="/inbox">
              <button className="k-btn primary">
                <InboxIcon className="h-[15px] w-[15px]" />
                Inbox
              </button>
            </Link>
          </div>
        </div>

        {/* ── Heute wichtig ───────────────────────────────────────── */}
        <HeuteWichtig />

        {/* ── Focus-Job card ──────────────────────────────────────── */}
        {focusJob && <FocusJobCard deal={focusJob} today={today} />}

        {/* ── Two-column grid: today list + right column ────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.15fr_.85fr] lg:gap-5">
          <UpcomingList deals={upcomingList} loading={loading} />
          <div className="flex flex-col gap-5">
            <RevenueCard income={income} series={financial?.series ?? []} />
            <ActivityCard events={activity} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Heute wichtig ───────────────────────────────────────────────────────

function HeuteWichtig() {
  const [unanswered, setUnanswered] = useState<number | null>(null);
  const [dueToday, setDueToday] = useState<number | null>(null);
  const [stale, setStale] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadUnanswered = async () => {
      const res = await fetch("/api/v1/inbox/conversations");
      if (!res.ok) return null;
      const json = await res.json();
      const rows = (json.data ?? []) as Array<{ aiNeedsReply?: boolean }>;
      return rows.filter((r) => r.aiNeedsReply === true).length;
    };

    const loadDueTasks = async () => {
      const res = await fetch("/api/v1/tasks?limit=200");
      if (!res.ok) return null;
      const json = await res.json();
      const tasks = (json.data?.tasks ?? []) as Array<{
        deadline: string | null;
        isCompleted: boolean;
      }>;
      const endOfToday = new Date();
      endOfToday.setHours(23, 59, 59, 999);
      // Heute fällig inkl. überfällig: deadline bis Tagesende (lokal).
      return tasks.filter(
        (t) => !t.isCompleted && t.deadline && new Date(t.deadline) <= endOfToday
      ).length;
    };

    const loadStale = async () => {
      const res = await fetch("/api/v1/statistics/pipeline");
      if (!res.ok) return null;
      const json = await res.json();
      const staleDeals = (json.data?.staleDeals ?? null) as unknown[] | null;
      return staleDeals ? staleDeals.length : null;
    };

    Promise.allSettled([loadUnanswered(), loadDueTasks(), loadStale()]).then(
      ([a, b, c]) => {
        if (cancelled) return;
        if (a.status === "fulfilled") setUnanswered(a.value);
        if (b.status === "fulfilled") setDueToday(b.value);
        if (c.status === "fulfilled") setStale(c.value);
        setLoaded(true);
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing while loading; section disappears entirely when no fetch succeeded.
  if (!loaded) return null;
  if (unanswered === null && dueToday === null && stale === null) return null;

  return (
    <div>
      <div
        className="k-label mb-2"
        style={{ fontSize: 11, color: "var(--ink-muted)" }}
      >
        Heute wichtig
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {unanswered !== null && (
          <WichtigTile
            href="/inbox"
            icon={<MessageCircle className="h-[15px] w-[15px]" />}
            count={unanswered}
            label="Unbeantwortet"
            sub="Konversationen"
          />
        )}
        {dueToday !== null && (
          <WichtigTile
            href="/tasks"
            icon={<CalendarClock className="h-[15px] w-[15px]" />}
            count={dueToday}
            label="Heute fällig"
            sub="Aufgaben"
          />
        )}
        {stale !== null && (
          <WichtigTile
            href="/statistics"
            icon={<Hourglass className="h-[15px] w-[15px]" />}
            count={stale}
            label="Liegen geblieben"
            sub="Leads"
          />
        )}
      </div>
    </div>
  );
}

function WichtigTile({
  href,
  icon,
  count,
  label,
  sub,
}: {
  href: string;
  icon: React.ReactNode;
  count: number;
  label: string;
  sub: string;
}) {
  const active = count > 0;
  return (
    <Link href={href} className="k-card flex items-center gap-3 p-4">
      <span
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{
          background: active
            ? "color-mix(in oklch, var(--kottke-accent) 12%, transparent)"
            : "var(--paper)",
          color: active ? "var(--kottke-accent)" : "var(--ink-muted)",
        }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div
          className="k-display"
          style={{
            fontSize: 22,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            color: active ? "var(--ink)" : "var(--ink-muted)",
          }}
        >
          {count}
        </div>
        <div className="k-label" style={{ fontSize: 10, color: "var(--ink-muted)" }}>
          {label} · {sub}
        </div>
      </div>
      <ArrowRight
        className="ml-auto h-[15px] w-[15px] shrink-0"
        style={{ color: "var(--ink-muted)" }}
      />
    </Link>
  );
}

// ─── Focus Job ───────────────────────────────────────────────────────────

function FocusJobCard({ deal, today }: { deal: OpsDeal; today: string }) {
  const isToday = deal.moveDate === today;

  return (
    <div
      className="k-card relative overflow-hidden p-5 sm:p-6"
      style={{
        background:
          "linear-gradient(180deg, #fff, color-mix(in srgb, var(--accent-soft) 30%, #fff))",
        border:
          "1px solid color-mix(in oklch, var(--kottke-accent) 22%, transparent)",
      }}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          top: -30,
          right: -30,
          width: 180,
          height: 180,
          borderRadius: "50%",
          background: "color-mix(in oklch, var(--kottke-accent) 10%, transparent)",
          filter: "blur(30px)",
        }}
      />

      <div className="relative mb-3 flex items-center justify-between">
        <div
          className="flex items-center gap-2"
          style={{
            fontFamily: "var(--f-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--kottke-accent)",
            fontWeight: 500,
          }}
        >
          {isToday ? (
            <>
              <span
                className="k-pulse inline-block h-[7px] w-[7px] rounded-full"
                style={{ background: "var(--kottke-accent)" }}
              />
              Heute · im Fokus
            </>
          ) : (
            <>Nächster Auftrag</>
          )}
        </div>
        {deal.dealNumber && (
          <span
            className="k-mono"
            style={{ fontSize: 11.5, color: "var(--ink-muted)" }}
          >
            {deal.dealNumber}
          </span>
        )}
      </div>

      <div className="relative grid gap-4 sm:gap-6 md:grid-cols-[1.3fr_1fr]">
        <div>
          <h2
            className="k-display"
            style={{
              margin: 0,
              fontSize: "clamp(22px, 3vw, 28px)",
              fontVariationSettings: '"opsz" 48, "SOFT" 80',
            }}
          >
            {deal.name}
          </h2>

          <div
            className="mt-2.5 flex flex-wrap items-center gap-2 text-sm"
            style={{ color: "var(--ink-soft)" }}
          >
            {deal.moveFromAddress && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin
                  className="h-[14px] w-[14px]"
                  style={{ color: "var(--kottke-accent)" }}
                />
                {deal.moveFromAddress}
              </span>
            )}
            {(deal.moveFromAddress || deal.moveToAddress) && (
              <ArrowRight
                className="h-[14px] w-[14px]"
                style={{ opacity: 0.5 }}
              />
            )}
            {deal.moveToAddress && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-[14px] w-[14px]" />
                {deal.moveToAddress}
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-5 text-[13px]">
            <FocusStat label="Datum" value={formatRelativeMoveDate(deal.moveDate)} />
            {deal.timeStart && (
              <FocusStat label="Start" value={`${formatTimeDE(deal.timeStart)} Uhr`} />
            )}
            {deal.transporter && (
              <FocusStat label="Transporter" value={deal.transporter.title} />
            )}
            {typeof deal.workerCount === "number" && (
              <FocusStat
                label="Crew"
                value={`${deal.assignedEmployees.length} / ${deal.workerCount}`}
                warn={deal.assignedEmployees.length < deal.workerCount}
              />
            )}
          </div>

          {deal.assignedEmployees.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {deal.assignedEmployees.map((e) => (
                <div
                  key={e.assignmentId}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--paper)] px-2 py-0.5 text-[12px]"
                  style={{ border: "1px solid var(--line)" }}
                >
                  <EmployeeAvatar
                    name={e.name}
                    photoBase64={e.photoBase64}
                    size="xs"
                  />
                  <span>{e.name}</span>
                </div>
              ))}
            </div>
          )}

          {isToday && (
            <div className="mt-4 flex items-center gap-2.5">
              <div
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: "rgba(34,29,22,.08)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(computeProgress(deal) * 100)}%`,
                    background: "var(--kottke-accent)",
                    borderRadius: 3,
                    transition: "width .3s",
                  }}
                />
              </div>
              <span
                className="k-mono"
                style={{ fontSize: 11.5, color: "var(--ink-soft)" }}
              >
                {Math.round(computeProgress(deal) * 100)}% · Einsatz
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5">
          <RouteMini
            from={deal.moveFromAddress}
            to={deal.moveToAddress}
            progress={computeProgress(deal)}
          />

          <div className="mt-auto flex gap-1.5">
            {deal.customerPhone && (
              <a href={`tel:${deal.customerPhone}`} className="flex-1">
                <button className="k-btn sm w-full">
                  <Phone className="h-[13px] w-[13px]" />
                  Kunde
                </button>
              </a>
            )}
            {deal.conversationId && (
              <Link href={`/inbox?conv=${deal.conversationId}`} className="flex-1">
                <button className="k-btn sm w-full">
                  <MessageCircle className="h-[13px] w-[13px]" />
                  Nachricht
                </button>
              </Link>
            )}
            <Link href={`/objects/deals/${deal.dealId}`} className="flex-1">
              <button
                className="k-btn sm accent w-full"
                style={{
                  background: "var(--kottke-accent)",
                  color: "var(--accent-ink)",
                  borderColor: "var(--kottke-accent)",
                }}
              >
                <ArrowRight className="h-[13px] w-[13px]" />
                Öffnen
              </button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function FocusStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <div className="k-label" style={{ fontSize: 10 }}>
        {label}
      </div>
      <div
        className="mt-0.5 font-medium"
        style={warn ? { color: "oklch(0.4 0.15 25)" } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function RouteMini({
  from,
  to,
  progress,
}: {
  from: string | null;
  to: string | null;
  progress: number;
}) {
  const dashLen = 250;
  return (
    <div
      style={{
        background: "var(--paper)",
        borderRadius: 12,
        padding: 14,
        border: "1px solid var(--line)",
        position: "relative",
        minHeight: 130,
      }}
    >
      <svg viewBox="0 0 240 100" width="100%" height="100" preserveAspectRatio="none">
        <defs>
          <pattern id="routegrid" width="12" height="12" patternUnits="userSpaceOnUse">
            <path d="M 12 0 L 0 0 0 12" fill="none" stroke="rgba(34,29,22,.06)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="240" height="100" fill="url(#routegrid)" />
        <path
          d="M 20 70 Q 80 20, 140 50 T 220 30"
          fill="none"
          stroke="rgba(34,29,22,.2)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        <path
          d="M 20 70 Q 80 20, 140 50 T 220 30"
          fill="none"
          stroke="var(--kottke-accent)"
          strokeWidth="2"
          strokeDasharray={dashLen}
          strokeDashoffset={dashLen - dashLen * progress}
        />
        <circle cx="20" cy="70" r="4" fill="var(--kottke-accent)" />
        <circle cx="220" cy="30" r="4" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
        <g transform={`translate(${20 + 200 * progress}, ${70 - 40 * progress})`}>
          <circle r="10" fill="#fff" stroke="var(--kottke-accent)" strokeWidth="1.5" />
          <g transform="translate(-6,-5) scale(.5)">
            <path
              d="M1 6h13v10H1z M14 9h5l3 4v3h-8"
              fill="none"
              stroke="var(--kottke-accent)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        </g>
      </svg>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: 11,
          color: "var(--ink-muted)",
          fontFamily: "var(--f-mono)",
          gap: 8,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {from ?? "—"}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {to ?? "—"}
        </span>
      </div>
    </div>
  );
}

// ─── Upcoming list ───────────────────────────────────────────────────────

function UpcomingList({
  deals,
  loading,
}: {
  deals: OpsDeal[];
  loading: boolean;
}) {
  return (
    <div className="k-card p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between">
        <h3
          className="k-display m-0"
          style={{ fontSize: 18, fontWeight: 500 }}
        >
          Heute & kommende Tage
        </h3>
        <Link
          href="/operations"
          className="text-xs"
          style={{ color: "var(--kottke-accent)" }}
        >
          Alle →
        </Link>
      </div>

      {loading && deals.length === 0 ? (
        <div
          className="py-6 text-center text-sm"
          style={{ color: "var(--ink-muted)" }}
        >
          Lade…
        </div>
      ) : deals.length === 0 ? (
        <div
          className="py-6 text-center text-sm"
          style={{ color: "var(--ink-muted)" }}
        >
          Keine geplanten Aufträge.
        </div>
      ) : (
        <div className="flex flex-col">
          {deals.map((d, i) => (
            <Link
              key={d.dealId}
              href={`/objects/deals/${d.dealId}`}
              className="flex items-center gap-3 py-3"
              style={{ borderTop: i === 0 ? 0 : "1px dashed var(--line)" }}
            >
              <div className="w-12 shrink-0 text-center">
                {d.moveDate ? (
                  <>
                    <div
                      className="k-mono"
                      style={{
                        fontSize: 10,
                        color: "var(--ink-muted)",
                        letterSpacing: "0.05em",
                      }}
                    >
                      {formatDayLabelDE(d.moveDate).weekday}
                    </div>
                    <div
                      className="k-display"
                      style={{ fontSize: 18, lineHeight: 1, marginTop: 2 }}
                    >
                      {formatDayLabelDE(d.moveDate).day}
                    </div>
                  </>
                ) : (
                  <div
                    className="k-mono"
                    style={{ fontSize: 10, color: "var(--ink-muted)" }}
                  >
                    —
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{d.name}</span>
                  {d.stage && (
                    <span
                      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: d.stage.color + "33",
                        color: d.stage.color,
                      }}
                    >
                      {d.stage.title}
                    </span>
                  )}
                </div>
                {(d.moveFromAddress || d.moveToAddress) && (
                  <div
                    className="mt-0.5 flex items-center gap-1.5 truncate text-xs"
                    style={{ color: "var(--ink-muted)" }}
                  >
                    <MapPin className="h-[11px] w-[11px]" />
                    {d.moveFromAddress ?? "—"}
                    <ArrowRight
                      className="h-[10px] w-[10px]"
                      style={{ opacity: 0.4 }}
                    />
                    {d.moveToAddress ?? "—"}
                  </div>
                )}
              </div>
              {d.assignedEmployees.length > 0 && (
                <div className="hidden items-center sm:inline-flex">
                  {d.assignedEmployees.slice(0, 3).map((e, idx) => (
                    <div
                      key={e.assignmentId}
                      style={{ marginLeft: idx === 0 ? 0 : -6 }}
                    >
                      <EmployeeAvatar
                        name={e.name}
                        photoBase64={e.photoBase64}
                        size="xs"
                      />
                    </div>
                  ))}
                </div>
              )}
              <ArrowRight
                className="h-[15px] w-[15px] shrink-0"
                style={{ color: "var(--ink-muted)" }}
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Revenue card ────────────────────────────────────────────────────────

function RevenueCard({ income, series }: { income: number; series: number[] }) {
  const now = new Date();
  const monthName = now.toLocaleDateString("de-DE", { month: "long" });
  const prev = series.length >= 2 ? series[series.length - 2] : 0;
  const pct = prev > 0 ? Math.round(((income - prev) / prev) * 100) : null;

  return (
    <div className="k-card p-5 sm:p-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="k-display m-0" style={{ fontSize: 18, fontWeight: 500 }}>
          Umsatz {monthName}
        </h3>
        <div className="flex items-center gap-2">
          {pct !== null && (
            <span className={pct >= 0 ? "k-chip ok" : "k-chip danger"}>
              <TrendingUp
                className="h-[11px] w-[11px]"
                style={{
                  transform: pct >= 0 ? undefined : "scaleY(-1)",
                }}
              />
              {pct >= 0 ? "+" : ""}
              {pct}%
            </span>
          )}
          <Link
            href="/financial"
            className="text-xs"
            style={{ color: "var(--kottke-accent)" }}
          >
            Details →
          </Link>
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <div
          className="k-display"
          style={{ fontSize: 32, letterSpacing: "-0.03em" }}
        >
          {income > 0 ? fmtEUR(income) : "—"}
        </div>
      </div>

      <Sparkline series={series.length > 0 ? series : [income]} />

      <p className="mt-1 text-[12px]" style={{ color: "var(--ink-muted)" }}>
        Bezahlte Eingänge in diesem Monat · letzte {series.length || 1} Monate
      </p>
    </div>
  );
}

function Sparkline({ series }: { series: number[] }) {
  if (series.length === 0) return null;
  const max = Math.max(...series, 1);
  const min = Math.min(...series, 0);
  const range = max - min || 1;
  const pts = series
    .map((v, i) => {
      const x = (i / Math.max(series.length - 1, 1)) * 240;
      const y = 40 - ((v - min) / range) * 36;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 240 40"
      width="100%"
      height="46"
      style={{ marginTop: 6, marginBottom: 6, display: "block" }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="var(--kottke-accent)"
            stopOpacity=".25"
          />
          <stop
            offset="100%"
            stopColor="var(--kottke-accent)"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <polyline
        points={pts}
        fill="none"
        stroke="var(--kottke-accent)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <polygon points={`0,40 ${pts} 240,40`} fill="url(#spark)" />
    </svg>
  );
}

// ─── Activity card ───────────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  "message.received": "Neue Nachricht",
  "message.sent": "Nachricht gesendet",
  "deal.stage_changed": "Phase geändert",
  "call.received": "Anruf erhalten",
  "call.summary_attached": "Anruf-Zusammenfassung",
  "ai.insights_extracted": "KI-Analyse",
};

function ActivityCard({ events }: { events: ActivityEvent[] }) {
  return (
    <div className="k-card p-5 sm:p-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h3
          className="k-display m-0"
          style={{ fontSize: 18, fontWeight: 500 }}
        >
          Aktivität
        </h3>
        <Link
          href="/notifications"
          className="text-xs"
          style={{ color: "var(--kottke-accent)" }}
        >
          Mehr →
        </Link>
      </div>
      {events.length === 0 ? (
        <p
          className="py-4 text-center text-sm"
          style={{ color: "var(--ink-muted)" }}
        >
          Noch keine Aktivität.
        </p>
      ) : (
        <div>
          {events.slice(0, 5).map((e, i) => (
            <div
              key={e.id}
              className="flex items-start gap-2.5 py-2.5"
              style={{ borderTop: i === 0 ? 0 : "1px dashed var(--line)" }}
            >
              <span
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "var(--paper)", color: "var(--ink-soft)" }}
              >
                <MessageCircle className="h-[14px] w-[14px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-snug">
                  <b style={{ fontWeight: 500 }}>
                    {EVENT_LABEL[e.eventType] ?? e.eventType}
                  </b>
                </div>
                <div
                  className="k-mono mt-0.5 text-[11px]"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {new Date(e.createdAt).toLocaleString("de-DE", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
