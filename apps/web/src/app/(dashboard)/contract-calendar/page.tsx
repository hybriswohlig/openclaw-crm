"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Copy, Link2, Loader2, RefreshCw } from "lucide-react";
import { agendaVisibleDays, berlinTodayKey, berlinWallDate } from "@/services/calendar/dates";
import { cn } from "@/lib/utils";

interface CalendarEvent {
  id: string;
  dealId: string;
  kind: "move" | "appointment";
  title: string;
  appointmentLabel: string | null;
  date: string;
  endDate: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  fromShort: string | null;
  toShort: string | null;
  stageId: string | null;
  stageTitle: string | null;
  companyId: string | null;
  companyName: string | null;
  companyColor: string;
  estimated: boolean;
  href: string;
}

interface CalendarCompany {
  id: string;
  name: string;
  color: string;
}

interface CalendarStage {
  id: string;
  title: string;
  color: string;
  sortOrder: number;
  excludedByDefault: boolean;
}

interface Subscription {
  path: string | null;
  createdAt: string | null;
}

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeek(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const weekday = date.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diff);
  return date;
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;
  const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
  for (let i = startOffset - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month, -i), isCurrentMonth: false });
  }
  for (let i = 1; i <= lastDay.getDate(); i++) {
    days.push({ date: new Date(year, month, i), isCurrentMonth: true });
  }
  while (days.length % 7 !== 0) {
    const next = new Date(year, month + 1, days.length - lastDay.getDate() - startOffset + 1);
    days.push({ date: next, isCurrentMonth: false });
  }
  return days;
}

function covers(event: CalendarEvent, key: string): boolean {
  return event.date <= key && event.endDate >= key;
}

function timeLabel(event: CalendarEvent): string {
  if (event.allDay) return "Ganztägig";
  if (event.startTime && event.endTime) return `${event.startTime}–${event.endTime}`;
  if (event.startTime) return event.startTime;
  return "Ganztägig";
}

function routeLabel(event: CalendarEvent): string {
  const from = event.fromShort ?? "ohne Abholung";
  const to = event.toShort ?? "ohne Ziel";
  return `${from} → ${to}`;
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

export default function ContractCalendarPage() {
  const [cursor, setCursor] = useState(() => berlinWallDate());
  const [view, setView] = useState<"month" | "week">("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [companies, setCompanies] = useState<CalendarCompany[]>([]);
  const [stages, setStages] = useState<CalendarStage[]>([]);
  const [companyIds, setCompanyIds] = useState<string[] | null>(null);
  const [stageIds, setStageIds] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const agendaTodayRef = useRef<HTMLElement | null>(null);
  const scrolledAgendaFor = useRef<string | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthDays = useMemo(() => getMonthDays(year, month), [year, month]);
  const weekStart = useMemo(() => startOfWeek(cursor), [cursor]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const range = useMemo(() => {
    if (view === "week") {
      return { from: dateKey(weekDays[0]), to: dateKey(weekDays[6]) };
    }
    return { from: dateKey(monthDays[0].date), to: dateKey(monthDays[monthDays.length - 1].date) };
  }, [view, weekDays, monthDays]);

  const load = useCallback(async () => {
    if ((companyIds && companyIds.length === 0) || (stageIds && stageIds.length === 0)) {
      setEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (companyIds && companyIds.length > 0) params.set("company", companyIds.join(","));
      if (stageIds) params.set("stage", stageIds.join(","));
      const res = await fetch(`/api/v1/calendar/events?${params.toString()}`);
      if (!res.ok) {
        setError(res.status === 401 ? "Bitte neu anmelden." : "Kalender konnte nicht geladen werden.");
        return;
      }
      const json = await res.json();
      setEvents(Array.isArray(json.data?.events) ? json.data.events : []);
      setCompanies(Array.isArray(json.data?.companies) ? json.data.companies : []);
      setStages(Array.isArray(json.data?.stages) ? json.data.stages : []);
    } catch {
      setError("Kalender konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, companyIds, stageIds]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/v1/calendar/subscription")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.data) setSubscription(json.data);
      })
      .catch(() => {});
  }, []);

  const openStageIds = useMemo(
    () => stages.filter((stage) => !stage.excludedByDefault).map((stage) => stage.id),
    [stages]
  );
  const activeStageIds = stageIds ?? openStageIds;
  const activeCompanyIds = companyIds ?? companies.map((company) => company.id);

  function toggleCompany(id: string) {
    setCompanyIds((prev) => {
      const all = companies.map((company) => company.id);
      const current = prev ?? all;
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return sameIds(next, all) ? null : next;
    });
  }

  function toggleStage(id: string) {
    setStageIds((prev) => {
      const current = prev ?? openStageIds;
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      return sameIds(next, openStageIds) ? null : next;
    });
  }

  function shift(direction: -1 | 1) {
    if (view === "week") setCursor(addDays(cursor, direction * 7));
    else setCursor(new Date(year, month + direction, 1));
  }

  const periodLabel =
    view === "week"
      ? `${weekDays[0].toLocaleDateString("de-DE", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })}`
      : new Date(year, month, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });

  const today = berlinTodayKey();
  const agendaDays = (view === "week" ? weekDays : monthDays.filter((day) => day.isCurrentMonth).map((day) => day.date))
    .map((date) => dateKey(date))
    .filter((key, index, all) => all.indexOf(key) === index);
  const visibleAgendaDays = useMemo(
    () => agendaVisibleDays(agendaDays, today, focusDate, (day) => events.some((event) => covers(event, day))),
    [agendaDays, today, focusDate, events],
  );

  useLayoutEffect(() => {
    if (loading) return;
    if (today < range.from || today > range.to) return;
    const key = `${view}:${range.from}:${range.to}`;
    if (scrolledAgendaFor.current === key) return;
    const align = () => {
      const el = agendaTodayRef.current;
      // Desktop draws the month/week grid; the agenda is display:none and must not steal the scroll.
      if (!el || el.getClientRects().length === 0) return;
      el.scrollIntoView({ block: "start" });
    };
    align();
    scrolledAgendaFor.current = key;
    let alive = true;
    const realign = () => {
      if (alive) align();
    };
    const frame = requestAnimationFrame(realign);
    const fonts = document.fonts?.ready.then(realign);
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      void fonts;
    };
  }, [loading, range.from, range.to, today, view]);

  const subscriptionUrl = useMemo(() => {
    if (!subscription?.path || typeof window === "undefined") return null;
    return new URL(subscription.path, window.location.origin).toString();
  }, [subscription?.path]);

  const filteredSubscriptionUrl = useMemo(() => {
    if (!subscriptionUrl || !companyIds || companyIds.length !== 1) return null;
    const url = new URL(subscriptionUrl);
    url.searchParams.set("company", companyIds[0]);
    return url.toString();
  }, [subscriptionUrl, companyIds]);

  async function mutateSubscription(action: "create" | "regenerate" | "revoke") {
    if (action === "regenerate") {
      const ok = window.confirm(
        "Der bisherige Abo-Link funktioniert danach nicht mehr. Neuen Link erzeugen?"
      );
      if (!ok) return;
    }
    if (action === "revoke") {
      const ok = window.confirm("Abo-Link widerrufen? Eingetragene Kalender aktualisieren sich nicht mehr.");
      if (!ok) return;
    }
    setSubBusy(true);
    try {
      const res = await fetch(
        action === "regenerate"
          ? "/api/v1/calendar/subscription/regenerate"
          : "/api/v1/calendar/subscription",
        { method: action === "revoke" ? "DELETE" : "POST" }
      );
      if (res.ok) {
        const json = await res.json();
        setSubscription(json.data);
        setCopied(false);
      }
    } finally {
      setSubBusy(false);
    }
  }

  async function copyLink(value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(true);
  }

  return (
    <div className="flex h-full flex-col p-4 md:p-6">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-3 bg-background px-4 py-2 md:-mx-6 md:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Kalender</h1>
          <p className="text-sm text-muted-foreground">Einsätze von Kottke-Umzüge und Ceylan Operations</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            <ViewButton active={view === "month"} onClick={() => setView("month")}>
              Monat
            </ViewButton>
            <ViewButton active={view === "week"} onClick={() => setView("week")}>
              Woche
            </ViewButton>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCursor(berlinWallDate())}>
            Heute
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(-1)} aria-label="Zurück">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-44 text-center text-sm font-medium capitalize">{periodLabel}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shift(1)} aria-label="Weiter">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Firma:</span>
        <FilterChip active={companyIds === null} onClick={() => setCompanyIds(null)}>
          Beide
        </FilterChip>
        {companies.map((company) => (
          <FilterChip
            key={company.id}
            active={activeCompanyIds.includes(company.id)}
            onClick={() => toggleCompany(company.id)}
            color={company.color}
          >
            {company.name}
          </FilterChip>
        ))}
      </div>

      {stages.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Status:</span>
          <FilterChip active={stageIds === null} onClick={() => setStageIds(null)}>
            Alle offenen
          </FilterChip>
          {stages.map((stage) => (
            <FilterChip
              key={stage.id}
              active={activeStageIds.includes(stage.id)}
              onClick={() => toggleStage(stage.id)}
              color={stage.color}
            >
              {stage.title}
            </FilterChip>
          ))}
        </div>
      )}

      <SubscriptionPanel
        url={subscriptionUrl}
        filteredUrl={filteredSubscriptionUrl}
        createdAt={subscription?.createdAt ?? null}
        busy={subBusy}
        copied={copied}
        hasLink={Boolean(subscription?.path)}
        onCreate={() => void mutateSubscription("create")}
        onCopy={(value) => void copyLink(value)}
        onRegenerate={() => void mutateSubscription("regenerate")}
        onRevoke={() => void mutateSubscription("revoke")}
      />

      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

      <div className="relative min-h-0 flex-1">
        {loading && (
          <div className="absolute right-2 top-2 z-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
        <div className="md:hidden">
          <Agenda
            days={visibleAgendaDays}
            events={events}
            today={today}
            onFocus={setFocusDate}
            todayRef={agendaTodayRef}
          />
        </div>
        <div className="hidden md:block">
          {view === "month" ? (
            <MonthGrid
              days={monthDays}
              events={events}
              today={today}
              focusDate={focusDate}
              onFocus={setFocusDate}
            />
          ) : (
            <WeekGrid days={weekDays} events={events} today={today} />
          )}
        </div>
        {!loading && events.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">Keine Einsätze in diesem Zeitraum.</p>
        )}
      </div>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-xs",
        active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-foreground/20 bg-background text-foreground shadow-sm"
          : "border-border bg-background text-muted-foreground opacity-70 hover:bg-muted"
      )}
    >
      {color && (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      )}
      {children}
    </button>
  );
}

function EventBody({ event, compact }: { event: CalendarEvent; compact?: boolean }) {
  const title = (
    <>
      {event.estimated ? "ca. " : ""}
      {event.appointmentLabel ? `${event.appointmentLabel}: ` : ""}
      {event.title}
    </>
  );
  return (
    <Link
      href={event.href}
      title={`${event.title}${event.fromAddress ? `\nVon: ${event.fromAddress}` : ""}${event.toAddress ? `\nNach: ${event.toAddress}` : ""}`}
      className={cn(
        "block rounded px-1.5 py-1 leading-tight hover:opacity-80",
        event.estimated && "border border-dashed italic",
        compact ? "text-[11px]" : "text-xs"
      )}
      style={{
        backgroundColor: `${event.companyColor}22`,
        borderLeft: event.estimated ? undefined : `3px solid ${event.companyColor}`,
        borderColor: event.estimated ? event.companyColor : undefined,
      }}
    >
      <span className="block truncate font-medium">
        {timeLabel(event)} {title}
      </span>
      <span className="block truncate text-muted-foreground">
        {routeLabel(event)} · {event.stageTitle ?? "Ohne Status"}
        {event.estimated ? " · geschätzt" : ""}
      </span>
    </Link>
  );
}

function MonthGrid({
  days,
  events,
  today,
  focusDate,
  onFocus,
}: {
  days: Array<{ date: Date; isCurrentMonth: boolean }>;
  events: CalendarEvent[];
  today: string;
  focusDate: string | null;
  onFocus: (date: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/50">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map(({ date, isCurrentMonth }, index) => {
          const key = dateKey(date);
          const dayEvents = events.filter((event) => covers(event, key));
          return (
            <div
              key={index}
              className={cn(
                "min-h-[108px] border-b border-r border-border p-1",
                !isCurrentMonth && "bg-muted/30",
                focusDate === key && "bg-muted/40"
              )}
            >
              <button
                type="button"
                onClick={() => onFocus(key)}
                aria-current={key === today ? "date" : undefined}
                className={cn(
                  "mb-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  key === today && "bg-foreground text-background",
                  !isCurrentMonth && "text-muted-foreground"
                )}
              >
                {key === today && <span className="sr-only">Heute </span>}
                {date.getDate()}
              </button>
              <div className="space-y-0.5">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventBody key={event.id} event={event} compact />
                ))}
                {dayEvents.length > 3 && (
                  <button
                    type="button"
                    onClick={() => onFocus(key)}
                    className="pl-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    +{dayEvents.length - 3} weitere
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {focusDate && (
        <div className="border-t border-border p-3">
          <h2 className="mb-2 text-sm font-medium">
            {parseKey(focusDate).toLocaleDateString("de-DE", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </h2>
          <DayEvents date={focusDate} events={events} />
        </div>
      )}
    </div>
  );
}

function WeekGrid({ days, events, today }: { days: Date[]; events: CalendarEvent[]; today: string }) {
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border">
      {days.map((date) => {
        const key = dateKey(date);
        return (
          <div key={key} className="min-h-[420px] border-r border-border p-1 last:border-r-0">
            <div
              aria-current={key === today ? "date" : undefined}
              className={cn(
                "mb-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium",
                key === today && "bg-foreground text-background"
              )}
            >
              <span className="sr-only">{key === today ? "Heute, " : ""}{WEEKDAYS[(date.getDay() + 6) % 7]} </span>
              {date.getDate()}
            </div>
            <div className="mb-1 text-center text-[10px] text-muted-foreground">
              {WEEKDAYS[(date.getDay() + 6) % 7]}
            </div>
            <DayEvents date={key} events={events} empty="" />
          </div>
        );
      })}
    </div>
  );
}

function Agenda({
  days,
  events,
  today,
  onFocus,
  todayRef,
}: {
  days: string[];
  events: CalendarEvent[];
  today: string;
  onFocus: (date: string) => void;
  todayRef: RefObject<HTMLElement | null>;
}) {
  if (days.length === 0) return null;
  return (
    <div className="space-y-4">
      {days.map((day) => (
        <section
          key={day}
          id={day === today ? "calendar-today" : undefined}
          ref={day === today ? todayRef : undefined}
          className={day === today ? "scroll-mt-32" : undefined}
        >
          <button
            type="button"
            onClick={() => onFocus(day)}
            className={cn(
              "mb-1 flex items-center gap-2 text-sm font-medium",
              day === today && "text-foreground"
            )}
          >
            {day === today && (
              <span className="inline-flex items-center rounded-full bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
                Heute
              </span>
            )}
            {parseKey(day).toLocaleDateString("de-DE", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </button>
          <DayEvents date={day} events={events} empty={day === today ? "Keine Einsätze heute" : undefined} />
        </section>
      ))}
    </div>
  );
}

function DayEvents({
  date,
  events,
  empty = "Keine Einsätze",
}: {
  date: string;
  events: CalendarEvent[];
  empty?: string;
}) {
  const dayEvents = events.filter((event) => covers(event, date));
  if (dayEvents.length === 0) {
    return empty ? <p className="text-xs text-muted-foreground">{empty}</p> : null;
  }
  return (
    <div className="space-y-1">
      {dayEvents.map((event) => (
        <EventBody key={`${date}-${event.id}`} event={event} />
      ))}
    </div>
  );
}

function SubscriptionPanel({
  url,
  filteredUrl,
  createdAt,
  busy,
  copied,
  hasLink,
  onCreate,
  onCopy,
  onRegenerate,
  onRevoke,
}: {
  url: string | null;
  filteredUrl: string | null;
  createdAt: string | null;
  busy: boolean;
  copied: boolean;
  hasLink: boolean;
  onCreate: () => void;
  onCopy: (value: string) => void;
  onRegenerate: () => void;
  onRevoke: () => void;
}) {
  return (
    <details className="mb-4 rounded-lg border border-border px-3 py-2">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <Link2 className="h-4 w-4" />
        Kalender abonnieren
      </summary>
      <div className="mt-3 space-y-2 text-sm">
        <p className="text-muted-foreground">
          Der Link lässt sich in Google Kalender, Apple Kalender und auf dem Handy eintragen. Er
          enthält Kundenname, Uhrzeit, Adressen und den Auftragslink. Keine Preise, keine Notizen,
          keine Telefonnummern.
        </p>
        {!hasLink ? (
          <Button type="button" size="sm" onClick={onCreate} disabled={busy}>
            Abo-Link erstellen
          </Button>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={url ?? ""}
                className="min-w-[16rem] flex-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                aria-label="Abo-Link"
              />
              <Button type="button" size="sm" variant="outline" onClick={() => url && onCopy(url)}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                {copied ? "Kopiert" : "Kopieren"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onRegenerate} disabled={busy}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Neu erzeugen
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onRevoke} disabled={busy}>
                Widerrufen
              </Button>
            </div>
            {createdAt && (
              <p className="text-xs text-muted-foreground">
                Erstellt am {new Date(createdAt).toLocaleString("de-DE")} · beide Firmen
              </p>
            )}
            {filteredUrl && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  readOnly
                  value={filteredUrl}
                  className="min-w-[16rem] flex-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                  aria-label="Abo-Link nur für die gewählte Firma"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => onCopy(filteredUrl)}>
                  Nur diese Firma kopieren
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Ohne Parameter sind beide Firmen enthalten. Eine Firma filtert{" "}
              <code>?company=</code> plus die Datensatz-ID.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
