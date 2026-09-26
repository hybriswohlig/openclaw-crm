"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmt } from "./alle-zahlen";

// Mirror of services/search-insights.ts
interface SearchQuery {
  query: string;
  klicks: number;
  impressionen: number;
  ctr: number | null;
  position: number;
  veraenderung: number | null;
}
interface SearchOverview {
  configured: boolean;
  days: number;
  property: string;
  datenBis: string | null;
  totals: { klicks: number; impressionen: number; ctr: number | null; position: number | null };
  vorher: { klicks: number; impressionen: number; ctr: number | null; position: number | null };
  weeks: { woche: string; klicks: number; impressionen: number; position: number | null }[];
  queries: SearchQuery[];
  pages: { page: string; klicks: number; impressionen: number; position: number }[];
  history: { woche: string; plausible: number | null; posthog: number | null }[];
}

// Validierte Farben (dataviz-Validator, hell + dunkel): Blau = Google/PostHog, Bernstein = Plausible.
const BLUE = "#2563eb";
const AMBER = "#d97706";
const GOOD = "#15803d";
const BAD = "#b91c1c";
const MAX_POS = 40;

const de = (n: number, d = 1) => n.toLocaleString("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d });
const pctText = (x: number | null) => (x == null ? "·" : `${de(x * 100)} %`);
const shortWeek = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}.${m}.`;
};

export function GoogleSuche({ days }: { days: number }) {
  const [data, setData] = useState<SearchOverview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetch(`/api/v1/visibility/search?days=${days}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) {
          setData(json.data as SearchOverview);
          setState("ok");
        }
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [days]);

  const chance = useMemo(
    () =>
      (data?.queries ?? [])
        .filter((q) => q.position > 10 && q.position <= 20 && q.impressionen >= 15)
        .sort((a, b) => b.impressionen - a.impressionen)
        .slice(0, 6),
    [data]
  );
  // Auf Seite 1, oft gesehen, aber kaum geklickt: Titel/Beschreibung im Google-Ergebnis überzeugen nicht.
  const noClicks = useMemo(
    () =>
      (data?.queries ?? [])
        .filter((q) => q.position <= 10 && q.impressionen >= 25 && (q.ctr ?? 0) < 0.01)
        .sort((a, b) => b.impressionen - a.impressionen)
        .slice(0, 8),
    [data]
  );
  const ladder = useMemo(() => {
    const list = (data?.queries ?? []).filter((q) => q.query.toLowerCase().includes(filter.trim().toLowerCase()));
    return showAll || filter ? list : list.slice(0, 20);
  }, [data, filter, showAll]);

  if (state === "error") return <Hint tone="bad">Suchdaten konnten nicht geladen werden.</Hint>;
  if (!data) return <Hint>Lade Google-Daten …</Hint>;
  if (!data.configured) return <Hint>PostHog ist noch nicht verbunden.</Hint>;
  if (data.weeks.length === 0) return <Hint>Noch keine Search-Console-Daten synchronisiert.</Hint>;

  const t = data.totals;
  const v = data.vorher;
  const maxImpr = Math.max(1, ...ladder.map((q) => q.impressionen));
  const monthFactor = 30 / data.days;
  // Feste Achsenschritte für die Position: 1, 10, 20 … bis knapp über den schlechtesten Wochenwert.
  const posMax = Math.max(20, Math.ceil(Math.max(...data.weeks.map((w) => w.position ?? 0)) / 10) * 10);
  const posTicks = [1, ...Array.from({ length: posMax / 10 }, (_, i) => (i + 1) * 10)];

  return (
    <div className="flex flex-col" style={{ gap: 22, opacity: state === "loading" ? 0.6 : 1 }}>
      {/* ── Kopf: die vier Zahlen ─────────────────────────────── */}
      <section
        className="overflow-hidden rounded-2xl"
        style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #1e3a8a 140%)", color: "#f8fafc", padding: "22px 24px" }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[12px]" style={{ letterSpacing: "0.08em", textTransform: "uppercase", color: "#93c5fd" }}>
              Google-Suche · {data.property}
            </div>
            <div className="k-display" style={{ fontSize: 22, marginTop: 4 }}>
              So sichtbar ist die Website in Google
            </div>
          </div>
          <div className="text-[12px]" style={{ color: "#94a3b8" }}>
            Letzte {data.days} Tage, verglichen mit den {data.days} davor
            {data.datenBis ? ` · Daten bis ${shortWeek(data.datenBis)} (Google liefert 2 bis 3 Tage verzögert)` : ""}
          </div>
        </div>
        <div className="mt-5 grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          <HeroStat label="Mal in Google angezeigt" value={fmt(t.impressionen)} delta={delta(t.impressionen, v.impressionen)} good={t.impressionen >= v.impressionen} />
          <HeroStat label="Klicks auf die Website" value={fmt(t.klicks)} delta={delta(t.klicks, v.klicks)} good={t.klicks >= v.klicks} />
          <HeroStat label="Klickrate" value={pctText(t.ctr)} delta={t.ctr != null && v.ctr != null ? `${t.ctr >= v.ctr ? "+" : "−"}${de(Math.abs(t.ctr - v.ctr) * 100)} Pkt.` : null} good={t.ctr != null && v.ctr != null && t.ctr >= v.ctr} />
          <HeroStat
            label="Ø Position"
            value={t.position == null ? "·" : de(t.position)}
            delta={t.position != null && v.position != null ? `${t.position <= v.position ? "besser" : "schlechter"} um ${de(Math.abs(t.position - v.position))}` : null}
            good={t.position != null && v.position != null && t.position <= v.position}
            note="1 = ganz oben, ab 11 Seite 2"
          />
        </div>
      </section>

      {/* ── Verlauf: drei kleine Diagramme, jede Größe mit eigener Achse ── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <Card title="Anzeigen pro Woche" sub="Wie oft Kottke in den Suchergebnissen stand">
          <Chart>
            <AreaChart data={data.weeks} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="imprFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BLUE} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={BLUE} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="woche" tickFormatter={shortWeek} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis fontSize={11} width={40} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={(w) => `Woche ab ${shortWeek(String(w))}`} formatter={(x) => [fmt(Number(x)), "Anzeigen"]} />
              <Area type="monotone" dataKey="impressionen" stroke={BLUE} strokeWidth={2} fill="url(#imprFill)" />
            </AreaChart>
          </Chart>
        </Card>
        <Card title="Klicks pro Woche" sub="Wie oft jemand aus Google auf die Seite kam">
          <Chart>
            <BarChart data={data.weeks} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="woche" tickFormatter={shortWeek} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis fontSize={11} width={28} allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={(w) => `Woche ab ${shortWeek(String(w))}`} formatter={(x) => [fmt(Number(x)), "Klicks"]} cursor={{ fill: "rgba(37,99,235,.08)" }} />
              <Bar dataKey="klicks" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={18} />
            </BarChart>
          </Chart>
        </Card>
        <Card title="Ø Position pro Woche" sub="Nach oben ist besser">
          <Chart>
            <LineChart data={data.weeks} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="woche" tickFormatter={shortWeek} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis reversed domain={[1, posMax]} ticks={posTicks} fontSize={11} width={28} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={(w) => `Woche ab ${shortWeek(String(w))}`} formatter={(x) => [de(Number(x)), "Ø Position"]} />
              <Line type="monotone" dataKey="position" stroke={BLUE} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </Chart>
        </Card>
      </div>

      {/* ── Kurz vor Seite 1 ─────────────────────────────────── */}
      {chance.length > 0 && (
        <section>
          <SectionHead
            title="Kurz vor Seite 1"
            sub="Diese Suchbegriffe werden oft angezeigt, stehen aber auf Seite 2. Auf Seite 1 klicken deutlich mehr Leute."
          />
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))" }}>
            {chance.map((q) => (
              <div
                key={q.query}
                className="rounded-xl"
                style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: "14px 16px", borderTop: `3px solid ${AMBER}` }}
              >
                <div style={{ fontWeight: 600, fontSize: 15 }}>{q.query}</div>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="k-display" style={{ fontSize: 26 }}>
                    {de(q.position)}
                  </span>
                  <span className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                    Position · {10 - Math.floor(q.position) < 0 ? `${Math.ceil(q.position - 10)} Plätze bis Seite 1` : "knapp"}
                  </span>
                </div>
                <div className="mt-2 text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
                  {fmt(q.impressionen)}× angezeigt · {fmt(q.klicks)} {q.klicks === 1 ? "Klick" : "Klicks"}
                </div>
                <div className="mt-1 text-[12px]" style={{ color: "var(--ink-muted)" }}>
                  {(() => {
                    const est = Math.max(1, Math.round(q.impressionen * monthFactor * 0.05));
                    return `Auf Seite 1 grob geschätzt ~${fmt(est)} ${est === 1 ? "Klick" : "Klicks"} im Monat`;
                  })()}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Seite 1, aber keine Klicks ──────────────────────────── */}
      {noClicks.length > 0 && (
        <section>
          <SectionHead
            title="Gesehen, aber nicht geklickt"
            sub="Diese Suchbegriffe stehen schon auf Seite 1, trotzdem klickt kaum jemand. Meist überzeugen Titel und Beschreibung im Google-Ergebnis nicht, oder die Seite passt nicht zur Suche."
          />
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            {noClicks.map((q) => (
              <div
                key={q.query}
                className="rounded-full text-[12.5px]"
                style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: "6px 12px" }}
                title={`${fmt(q.impressionen)}× angezeigt, ${fmt(q.klicks)} Klicks, Position ${de(q.position)}`}
              >
                <span style={{ fontWeight: 600 }}>{q.query}</span>
                <span style={{ color: "var(--ink-muted)" }}>
                  {" "}
                  · Pos. {de(q.position)} · {fmt(q.impressionen)}× · {fmt(q.klicks)} Klicks
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Rangleiter aller Suchbegriffe ──────────────────────── */}
      <section>
        <SectionHead
          title="Suchbegriffe auf der Rangleiter"
          sub="Jede Zeile ein Suchbegriff. Der Punkt zeigt die Position, der helle Punkt die Position im Zeitraum davor. Grün hinterlegt ist Seite 1."
          right={
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Suchbegriff filtern …"
              className="rounded-lg text-[13px]"
              style={{ border: "1px solid var(--line)", padding: "6px 10px", background: "var(--paper)", minWidth: 200 }}
            />
          }
        />
        <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--line)", background: "var(--paper)" }}>
          <div style={{ minWidth: 720 }}>
            <div
              className="grid items-end text-[11.5px]"
              style={{ gridTemplateColumns: "minmax(170px, 1.1fr) 2fr 150px", gap: 14, padding: "10px 16px 6px", color: "var(--ink-muted)" }}
            >
              <span>Suchbegriff</span>
              <PositionScale />
              <span style={{ textAlign: "right" }}>Anzeigen · Klicks</span>
            </div>
            {ladder.map((q) => (
              <LadderRow key={q.query} q={q} maxImpr={maxImpr} />
            ))}
            {ladder.length === 0 && <Hint>Kein Suchbegriff passt zum Filter.</Hint>}
          </div>
        </div>
        {!filter && data.queries.length > 20 && (
          <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-2 text-[12.5px] underline" style={{ color: "var(--ink-muted)" }}>
            {showAll ? "Nur die 20 häufigsten zeigen" : `Alle ${data.queries.length} Suchbegriffe zeigen`}
          </button>
        )}
      </section>

      {/* ── Seiten + Historie ─────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Card title="Welche Seiten Google zeigt" sub={`Letzte ${data.days} Tage`}>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {data.pages.slice(0, 10).map((p) => {
              const max = Math.max(1, ...data.pages.map((x) => x.impressionen));
              return (
                <div key={p.page} className="text-[12.5px]">
                  <div className="flex justify-between gap-2">
                    <span className="truncate" title={p.page} style={{ fontWeight: 500 }}>
                      {p.page}
                    </span>
                    <span style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}>
                      {fmt(p.impressionen)} · {fmt(p.klicks)} Kl. · <PosChip pos={p.position} />
                    </span>
                  </div>
                  <div className="mt-1 rounded-full" style={{ height: 5, background: "var(--line)" }}>
                    <div className="rounded-full" style={{ height: 5, width: `${(p.impressionen / max) * 100}%`, background: BLUE }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title="Besuche pro Woche, auch vor PostHog" sub="Plausible bis heute, PostHog seit dem 24.09. Beide zählen etwas unterschiedlich.">
          <Chart height={230}>
            <LineChart data={data.history} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="woche" tickFormatter={shortWeek} fontSize={11} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis fontSize={11} width={28} allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={(w) => `Woche ab ${shortWeek(String(w))}`} formatter={(x, n) => [x == null ? "·" : fmt(Number(x)), n]} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line name="Plausible" type="monotone" dataKey="plausible" stroke={AMBER} strokeWidth={2} dot={false} connectNulls />
              <Line name="PostHog" type="monotone" dataKey="posthog" stroke={BLUE} strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </Chart>
        </Card>
      </div>
    </div>
  );
}

// ─── Bausteine ─────────────────────────────────────────────────────────────

function delta(now: number, before: number): string | null {
  if (before <= 0) return null;
  const p = Math.round(((now - before) / before) * 100);
  return `${p >= 0 ? "+" : "−"}${Math.abs(p)} %`;
}

function HeroStat({ label, value, delta: d, good, note }: { label: string; value: string; delta: string | null; good: boolean; note?: string }) {
  return (
    <div>
      <div className="text-[12px]" style={{ color: "#94a3b8" }}>
        {label}
      </div>
      <div className="k-display" style={{ fontSize: 34, lineHeight: 1.1, marginTop: 2 }}>
        {value}
      </div>
      {d && (
        <div className="mt-1 text-[12px]" style={{ color: good ? "#86efac" : "#fca5a5" }}>
          {good ? "▲" : "▼"} {d}
        </div>
      )}
      {note && (
        <div className="text-[11px]" style={{ color: "#64748b", marginTop: 2 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl" style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: "14px 16px" }}>
      <div style={{ marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>{title}</h3>
        {sub && (
          <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
            {sub}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Chart({ children, height = 170 }: { children: React.ReactElement; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function SectionHead({ title, sub, right }: { title: string; sub: string; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="k-display" style={{ fontSize: 20, fontWeight: 500 }}>
          {title}
        </h2>
        <p className="text-[12.5px]" style={{ color: "var(--ink-muted)", maxWidth: 680 }}>
          {sub}
        </p>
      </div>
      {right}
    </div>
  );
}

const xPos = (p: number) => `${((Math.min(Math.max(p, 1), MAX_POS) - 1) / (MAX_POS - 1)) * 100}%`;

function PositionScale() {
  return (
    <div className="relative" style={{ height: 16 }}>
      {[1, 10, 20, 30, 40].map((p) => (
        <span key={p} className="absolute" style={{ left: xPos(p), transform: "translateX(-50%)" }}>
          {p === 40 ? "40+" : p}
        </span>
      ))}
    </div>
  );
}

function LadderRow({ q, maxImpr }: { q: SearchQuery; maxImpr: number }) {
  const before = q.veraenderung == null ? null : q.position - q.veraenderung;
  const better = q.veraenderung != null && q.veraenderung < -0.5;
  const worse = q.veraenderung != null && q.veraenderung > 0.5;
  const page1 = q.position <= 10;
  return (
    <div
      className="grid items-center"
      style={{ gridTemplateColumns: "minmax(170px, 1.1fr) 2fr 150px", gap: 14, padding: "7px 16px", borderTop: "1px solid var(--line)" }}
    >
      <span className="truncate text-[13px]" title={q.query} style={{ fontWeight: 500 }}>
        {q.query}
      </span>
      <div
        className="relative"
        style={{ height: 22 }}
        title={`Position ${de(q.position)}${before != null ? `, davor ${de(before)}` : ", neu im Zeitraum"}`}
      >
        {/* Zonen: Seite 1 grün, Seite 2 hell */}
        <div className="absolute inset-y-0 rounded-l" style={{ left: 0, width: xPos(10.5), background: "rgba(21,128,61,.10)" }} />
        <div className="absolute inset-y-0" style={{ left: xPos(10.5), width: `calc(${xPos(20.5)} - ${xPos(10.5)})`, background: "rgba(217,119,6,.07)" }} />
        <div className="absolute" style={{ left: 0, right: 0, top: "50%", borderTop: "1px dashed var(--line)" }} />
        {before != null && Math.abs(before - q.position) >= 0.5 && (
          <>
            <div
              className="absolute"
              style={{
                top: "50%",
                left: xPos(Math.min(before, q.position)),
                width: `calc(${xPos(Math.max(before, q.position))} - ${xPos(Math.min(before, q.position))})`,
                borderTop: `2px solid ${better ? GOOD : worse ? BAD : "var(--ink-muted)"}`,
                opacity: 0.6,
              }}
            />
            <span
              className="absolute rounded-full"
              style={{ left: xPos(before), top: "50%", width: 8, height: 8, transform: "translate(-50%, -50%)", background: "var(--paper)", border: "1.5px solid var(--ink-muted)" }}
            />
          </>
        )}
        <span
          className="absolute rounded-full"
          style={{
            left: xPos(q.position),
            top: "50%",
            width: 12,
            height: 12,
            transform: "translate(-50%, -50%)",
            background: page1 ? GOOD : BLUE,
            boxShadow: "0 0 0 2px var(--paper)",
          }}
        />
      </div>
      <div className="flex items-center justify-end gap-2 text-[12px]">
        <div className="rounded-full" style={{ width: 54, height: 5, background: "var(--line)" }}>
          <div className="rounded-full" style={{ height: 5, width: `${(q.impressionen / maxImpr) * 100}%`, background: BLUE }} />
        </div>
        <span style={{ minWidth: 34, textAlign: "right" }}>{fmt(q.impressionen)}</span>
        <span style={{ minWidth: 28, textAlign: "right", color: q.klicks ? "var(--ink)" : "var(--ink-muted)", fontWeight: q.klicks ? 600 : 400 }}>
          {fmt(q.klicks)}
        </span>
      </div>
    </div>
  );
}

function PosChip({ pos }: { pos: number }) {
  const page1 = pos <= 10;
  return (
    <span
      className="rounded"
      style={{ padding: "0 5px", background: page1 ? "rgba(21,128,61,.12)" : "rgba(37,99,235,.10)", color: page1 ? GOOD : BLUE, fontWeight: 600 }}
    >
      Pos. {de(pos)}
    </span>
  );
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: "bad" }) {
  return (
    <div className="text-[13px]" style={{ color: tone === "bad" ? BAD : "var(--ink-muted)", padding: "12px 4px" }}>
      {children}
    </div>
  );
}
