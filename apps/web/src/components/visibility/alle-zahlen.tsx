"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { useCachedJson } from "@/lib/use-cached-json";

// ─── Types (mirror services/website-analytics.ts, visitor-sessions.ts) ──────

type ZielKey = "whatsapp" | "anruf" | "mail" | "formular" | "paketfinder" | "paket";
interface Filters {
  ziel?: ZielKey;
  quelle?: string;
  geraet?: string;
  seite?: string;
}
interface PlausibleHistory {
  bis: string;
  daily: { tag: string; besuche: number }[];
  totals: { besuche: number; besucher: number; seitenaufrufe: number };
  sources: { quelle: string; besuche: number }[];
  entryPages: { seite: string; besuche: number }[];
  devices: { geraet: string; besuche: number }[];
  goals: { ziel: string; anzahl: number; besucher: number }[];
}
interface VisibilityOverview {
  configured: boolean;
  days: number;
  site: string | null;
  dashboardUrl: string;
  totals: { besuche: number; besucher: number; mitKontakt: number; kontaktquote: number | null };
  perSite: { site: string; besuche: number; mitKontakt: number; kontaktquote: number | null }[];
  daily: { tag: string; besuche: number; mitKontakt: number }[];
  sources: { quelle: string; besuche: number; mitKontakt: number; kontaktquote: number | null }[];
  contactWays: { weg: string; klicks: number }[];
  devices: { geraet: string; besuche: number; mitKontakt: number }[];
  hours: { stunde: number; besuche: number; mitKontakt: number }[];
  exits: { seite: string; abschnitt: string; besuche: number; medianSekunden: number }[];
  pages: { seite: string; besuche: number }[];
  goals: { ziel: ZielKey; label: string; besuche: number }[];
  plausible: PlausibleHistory | null;
}
interface VisitorSession {
  sessionId: string;
  start: string;
  minuten: number;
  site: string | null;
  quelle: string;
  einstieg: string;
  seiten: number;
  geraet: string | null;
  stadt: string | null;
  ref: string | null;
  ziele: ZielKey[];
  lead: { id: string; name: string; stage: string } | null;
  recordingUrl: string;
}

export const SITE_LABEL: Record<string, string> = {
  kottke: "kottke-umzuege.de",
  ruempeltuerken: "ruempeltuerken.de",
  ceylan: "ceylan-umzuege.de",
};

export const SOURCE_LABEL: Record<string, string> = {
  google_organisch: "Google (Suche)",
  google_maps: "Google Maps",
  google_unternehmensprofil: "Google-Unternehmensprofil",
  google_ads: "Google Ads",
  direkt: "Direkt / unbekannt",
  intern: "Intern",
  facebook_instagram: "Facebook / Instagram",
  ki_assistent: "KI-Assistent (ChatGPT & Co.)",
  "chatgpt.com": "KI-Assistent (ChatGPT & Co.)",
  andere_suche: "Andere Suchmaschine",
  bing: "Bing",
  whatsapp: "WhatsApp",
  kleinanzeigen: "Kleinanzeigen",
  verweis: "Andere Website",
  unbekannt: "Unbekannt",
};

const ZIEL_LABEL: Record<ZielKey, string> = {
  whatsapp: "WhatsApp",
  anruf: "Anruf",
  mail: "E-Mail",
  formular: "Formular",
  paketfinder: "Paket-Finder",
  paket: "Paket",
};

const FILTER_LABEL: Record<keyof Filters, string> = { ziel: "Ziel", quelle: "Quelle", geraet: "Gerät", seite: "Seite" };

export const NUM = new Intl.NumberFormat("de-DE");
export const fmt = (n: number) => NUM.format(n);
export const pct = (n: number | null) => (n == null ? "·" : `${String(n).replace(".", ",")} %`);
const BLUE = "#2563eb";
const AMBER = "#d97706";
const GREEN = "#16a34a";

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function filterValueLabel(key: keyof Filters, value: string) {
  if (key === "ziel") return ZIEL_LABEL[value as ZielKey] ?? value;
  if (key === "quelle") return SOURCE_LABEL[value] ?? value;
  if (key === "geraet") return cap(value);
  return value;
}

/** Reiter "Analyse": alle Zahlen, per Klick filterbar wie in Plausible, bis zu den einzelnen Besuchen. */
export function AlleZahlen({ days, site }: { days: number; site: string }) {
  const [filters, setFilters] = useState<Filters>({});
  const qs = useMemo(() => {
    const p = new URLSearchParams({ days: String(days) });
    if (site) p.set("site", site);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [days, site, filters]);
  const { data, loading, error } = useCachedJson<VisibilityOverview>(`/api/v1/visibility/overview?${qs}`);
  const sessions = useCachedJson<{ configured: boolean; sessions: VisitorSession[] }>(`/api/v1/visibility/sessions?${qs}`);

  const toggle = (key: keyof Filters, value: string) =>
    setFilters((f) => (f[key] === value ? { ...f, [key]: undefined } : { ...f, [key]: value }));
  const active = (Object.entries(filters) as [keyof Filters, string | undefined][]).filter(([, v]) => v);

  // Besuche pro Tag: Plausible vor dem PostHog-Start, danach PostHog
  const daily = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, { tag: string; plausible?: number; besuche?: number; mitKontakt?: number }>();
    for (const d of data.plausible?.daily ?? []) map.set(d.tag, { tag: d.tag, plausible: d.besuche });
    for (const d of data.daily) map.set(d.tag, { ...(map.get(d.tag) ?? { tag: d.tag }), besuche: d.besuche, mitKontakt: d.mitKontakt });
    return [...map.values()].sort((a, b) => a.tag.localeCompare(b.tag)).map((d) => ({ ...d, label: d.tag.slice(5).split("-").reverse().join(".") }));
  }, [data]);

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span style={{ color: "var(--ink-muted)" }}>Filter:</span>
        {active.length === 0 ? (
          <span style={{ color: "var(--ink-muted)" }}>keiner. Auf ein Ziel, eine Quelle, ein Gerät oder eine Seite klicken, um zu filtern.</span>
        ) : (
          <>
            {active.map(([k, v]) => (
              <button
                key={k}
                type="button"
                onClick={() => toggle(k, v!)}
                className="rounded-full"
                style={{ background: "var(--ink)", color: "var(--paper)", padding: "3px 10px" }}
                title="Filter entfernen"
              >
                {FILTER_LABEL[k]}: {filterValueLabel(k, v!)} ✕
              </button>
            ))}
            <button type="button" onClick={() => setFilters({})} className="underline" style={{ color: "var(--ink-muted)" }}>
              alle entfernen
            </button>
          </>
        )}
      </div>

      {loading && !data && <Muted>Lade Website-Daten …</Muted>}
      {error && <Muted color="#ef4444">Daten konnten nicht geladen werden.</Muted>}
      {data && !data.configured && <Muted>PostHog ist noch nicht verbunden. Es fehlt die Umgebungsvariable POSTHOG_PERSONAL_API_KEY.</Muted>}

      {data && data.configured && (
        <div className="flex flex-col" style={{ gap: 16, opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <Kpi label="Besuche" value={fmt(data.totals.besuche)} />
            <Kpi label="Besucher" value={fmt(data.totals.besucher)} />
            <Kpi label="Besuche mit Kontakt" value={fmt(data.totals.mitKontakt)} />
            <Kpi label="Kontaktquote" value={pct(data.totals.kontaktquote)} />
          </div>

          <Panel title="Ziele">
            {data.goals.length === 0 ? (
              <Muted>Im Zeitraum wurde noch kein Ziel erreicht.</Muted>
            ) : (
              <div className="flex flex-wrap" style={{ gap: 8 }}>
                {data.goals.map((g) => {
                  const on = filters.ziel === g.ziel;
                  return (
                    <button
                      key={g.ziel}
                      type="button"
                      onClick={() => toggle("ziel", g.ziel)}
                      className="rounded-xl text-left"
                      style={{
                        border: `1px solid ${on ? "var(--ink)" : "var(--line)"}`,
                        background: on ? "var(--ink)" : "var(--paper)",
                        color: on ? "var(--paper)" : "var(--ink)",
                        padding: "8px 14px",
                        minWidth: 130,
                      }}
                    >
                      <div className="k-display" style={{ fontSize: 22 }}>
                        {fmt(g.besuche)}
                      </div>
                      <div className="text-[12px]" style={{ opacity: 0.75 }}>
                        {g.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[12px]" style={{ color: "var(--ink-muted)", marginTop: 8 }}>
              Zahl = Besuche, in denen das Ziel erreicht wurde. Klick filtert alles auf diese Besuche.
            </p>
          </Panel>

          {!site && data.perSite.length > 0 && (
            <Panel title="Websites im Vergleich">
              <Table
                head={["Website", "Besuche", "Mit Kontakt", "Quote"]}
                rows={data.perSite.map((r) => [SITE_LABEL[r.site] ?? r.site, fmt(r.besuche), fmt(r.mitKontakt), pct(r.kontaktquote)])}
              />
            </Panel>
          )}

          <Panel title={data.plausible ? "Besuche pro Tag, vor dem 24.09. aus Plausible" : "Besuche und Kontakte pro Tag"}>
            {daily.length === 0 ? (
              <Muted>Noch keine Besuche im Zeitraum.</Muted>
            ) : (
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={daily}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="label" fontSize={11} minTickGap={20} />
                    <YAxis allowDecimals={false} fontSize={11} width={32} />
                    <Tooltip />
                    <Legend />
                    {data.plausible && <Line type="monotone" dataKey="plausible" name="Besuche (Plausible)" stroke={AMBER} strokeWidth={2} dot={false} connectNulls={false} />}
                    <Line type="monotone" dataKey="besuche" name="Besuche" stroke={BLUE} strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="mitKontakt" name="Mit Kontakt" stroke={GREEN} strokeWidth={2} dot={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
            <Panel title="Woher die Besucher kommen">
              <Table
                head={["Quelle", "Besuche", "Mit Kontakt", "Quote"]}
                rows={data.sources.map((r) => [SOURCE_LABEL[r.quelle] ?? r.quelle, fmt(r.besuche), fmt(r.mitKontakt), pct(r.kontaktquote)])}
                onRowClick={(i) => toggle("quelle", data.sources[i].quelle)}
                activeRow={data.sources.findIndex((r) => r.quelle === filters.quelle)}
                empty="Noch keine Daten."
              />
            </Panel>
            <Panel title="Geräte und Kontaktwege">
              <Table
                head={["Gerät", "Besuche", "Mit Kontakt"]}
                rows={data.devices.map((r) => [cap(r.geraet), fmt(r.besuche), fmt(r.mitKontakt)])}
                onRowClick={(i) => toggle("geraet", data.devices[i].geraet)}
                activeRow={data.devices.findIndex((r) => r.geraet === filters.geraet)}
              />
              <div style={{ height: 12 }} />
              <Table head={["Kontaktweg", "Klicks"]} rows={data.contactWays.map((r) => [r.weg, fmt(r.klicks)])} empty="Noch keine Kontakt-Klicks." />
            </Panel>
          </div>

          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
            <Panel title="Meistbesuchte Seiten">
              <Table
                head={["Seite", "Besuche"]}
                rows={data.pages.map((r) => [r.seite, fmt(r.besuche)])}
                onRowClick={(i) => toggle("seite", data.pages[i].seite)}
                activeRow={data.pages.findIndex((r) => r.seite === filters.seite)}
                empty="Noch keine Daten."
              />
            </Panel>
            <Panel title="Wo Besucher ohne Kontakt abspringen">
              <Table
                head={["Seite", "Letzter Abschnitt", "Besuche", "aktiv (Median)"]}
                leftCols={2}
                rows={data.exits.map((r) => [r.seite, r.abschnitt, fmt(r.besuche), `${fmt(r.medianSekunden)} s`])}
                empty="Noch keine Absprünge erfasst."
              />
            </Panel>
          </div>

          <Panel title="Uhrzeit: wann Besucher kommen und sich melden">
            {data.hours.length === 0 ? (
              <Muted>Noch keine Daten.</Muted>
            ) : (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.hours.map((h) => ({ ...h, stunde: `${h.stunde} Uhr` }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="stunde" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} width={32} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="besuche" name="Besuche" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="mitKontakt" name="Mit Kontakt" fill={GREEN} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <Besuche data={sessions.data} loading={sessions.loading} error={sessions.error} />

          {data.plausible && <PlausibleBlock p={data.plausible} />}
        </div>
      )}
    </div>
  );
}

// ─── Einzelne Besuche ────────────────────────────────────────────────────────

function Besuche({ data, loading, error }: { data: { sessions: VisitorSession[] } | null; loading: boolean; error: boolean }) {
  const when = (iso: string) => new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  return (
    <Panel title="Einzelne Besuche">
      <p className="text-[12px]" style={{ color: "var(--ink-muted)", marginTop: -6, marginBottom: 10 }}>
        Die letzten 100 Besuche passend zu den Filtern. Mit Filter „Ziel: WhatsApp“ siehst du hier genau, woher jede WhatsApp-Anfrage kam.
      </p>
      {error && !data && <Muted color="#ef4444">Besuche konnten nicht geladen werden.</Muted>}
      {!data && !error && <Muted>Lade Besuche …</Muted>}
      {data && data.sessions.length === 0 && <Muted>Keine Besuche passend zu den Filtern.</Muted>}
      {data && data.sessions.length > 0 && (
        <div className="overflow-x-auto" style={{ opacity: loading ? 0.6 : 1 }}>
          <table className="w-full text-[12.5px]" style={{ minWidth: 820 }}>
            <thead>
              <tr style={{ color: "var(--ink-muted)", textAlign: "left" }}>
                {["Zeit", "Quelle", "Einstieg", "Seiten", "Gerät · Ort", "Ziele", "Lead", ""].map((h) => (
                  <th key={h} className="font-normal" style={{ padding: "4px 6px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.sessions.map((s) => (
                <tr key={s.sessionId} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={td}>
                    {when(s.start)}
                    <div style={{ color: "var(--ink-muted)" }}>
                      {s.minuten} Min.{s.site ? ` · ${SITE_LABEL[s.site] ?? s.site}` : ""}
                    </div>
                  </td>
                  <td style={td}>{SOURCE_LABEL[s.quelle] ?? s.quelle}</td>
                  <td style={{ ...td, maxWidth: 200, wordBreak: "break-word" }}>{s.einstieg}</td>
                  <td style={td}>{s.seiten}</td>
                  <td style={td}>
                    {s.geraet ? cap(s.geraet) : "·"}
                    <div style={{ color: "var(--ink-muted)" }}>{s.stadt ?? ""}</div>
                  </td>
                  <td style={td}>
                    <div className="flex flex-wrap" style={{ gap: 4 }}>
                      {s.ziele.map((z) => (
                        <span key={z} className="rounded-full" style={{ background: "rgba(22,163,74,.12)", color: GREEN, padding: "1px 8px", fontWeight: 600 }}>
                          {ZIEL_LABEL[z]}
                        </span>
                      ))}
                    </div>
                    {s.ref && s.ziele.includes("whatsapp") && <div style={{ color: "var(--ink-muted)" }}>Nr. {s.ref}</div>}
                  </td>
                  <td style={td}>
                    {s.lead ? (
                      <Link href={`/objects/deals/${s.lead.id}`} className="underline" style={{ fontWeight: 600 }}>
                        {s.lead.name}
                      </Link>
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>·</span>
                    )}
                  </td>
                  <td style={td}>
                    <a href={s.recordingUrl} target="_blank" rel="noopener noreferrer" className="underline" style={{ whiteSpace: "nowrap" }}>
                      ▶ Aufnahme
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

const td: React.CSSProperties = { padding: "7px 6px", verticalAlign: "top" };

// ─── Plausible-Historie ─────────────────────────────────────────────────────

function PlausibleBlock({ p }: { p: PlausibleHistory }) {
  const bis = p.bis.split("-").reverse().join(".");
  return (
    <section className="rounded-xl" style={{ border: `1px dashed ${AMBER}`, padding: "14px 16px", background: "var(--paper)" }}>
      <h2 className="k-display" style={{ fontSize: 16, fontWeight: 500 }}>
        Vor dem {bis}: Zahlen aus Plausible
      </h2>
      <p className="text-[12px]" style={{ color: "var(--ink-muted)", marginBottom: 12 }}>
        Plausible zählt etwas anders als PostHog und kennt keine einzelnen Besuche, deshalb hier getrennt und nicht filterbar. Ziele wie WhatsApp und Anruf hat Plausible nur bis Ende Mai sauber
        gezählt, danach nur als „Outbound Link“.
      </p>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 14 }}>
        <Kpi label="Besuche" value={fmt(p.totals.besuche)} />
        <Kpi label="Besucher" value={fmt(p.totals.besucher)} />
        <Kpi label="Seitenaufrufe" value={fmt(p.totals.seitenaufrufe)} />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))" }}>
        <Table head={["Quelle", "Besuche"]} rows={p.sources.map((r) => [SOURCE_LABEL[r.quelle] ?? r.quelle, fmt(r.besuche)])} />
        <Table head={["Einstiegsseite", "Besuche"]} rows={p.entryPages.map((r) => [r.seite, fmt(r.besuche)])} />
        <Table head={["Gerät", "Besuche"]} rows={p.devices.map((r) => [r.geraet, fmt(r.besuche)])} />
        <Table head={["Ziel", "Anzahl", "Besucher"]} rows={p.goals.map((r) => [r.ziel, fmt(r.anzahl), fmt(r.besucher)])} empty="Keine Ziele im Zeitraum." />
      </div>
    </section>
  );
}

// ─── Primitives ─────────────────────────────────────────────────────────────

export function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex rounded-lg" style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: 2 }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className="rounded-md text-[12.5px]"
          style={{
            padding: "4px 10px",
            background: o.value === value ? "var(--ink)" : "transparent",
            color: o.value === value ? "var(--paper)" : "var(--ink-muted)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl" style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "14px 16px", minHeight: 84 }}>
      <div className="text-[11.5px]" style={{ color: "var(--ink-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
        {label}
      </div>
      <div className="k-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 6 }}>
        {value}
      </div>
    </div>
  );
}

export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl" style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "14px 16px" }}>
      <h2 className="k-display" style={{ fontSize: 14, fontWeight: 500, letterSpacing: "-0.01em", marginBottom: 12 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({
  head,
  rows,
  empty,
  leftCols = 1,
  onRowClick,
  activeRow = -1,
}: {
  head: string[];
  rows: (string | number)[][];
  empty?: string;
  /** Anzahl Textspalten links, der Rest sind Zahlen (rechtsbündig). */
  leftCols?: number;
  /** Zeile anklickbar, z. B. als Filter */
  onRowClick?: (index: number) => void;
  activeRow?: number;
}) {
  if (rows.length === 0) return <Muted>{empty ?? "Keine Daten."}</Muted>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr style={{ color: "var(--ink-muted)" }}>
            {head.map((h, i) => (
              <th key={h} className="font-normal" style={{ textAlign: i < leftCols ? "left" : "right", padding: "4px 6px" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr
              key={ri}
              onClick={onRowClick ? () => onRowClick(ri) : undefined}
              className={onRowClick ? "cursor-pointer hover:bg-black/5" : undefined}
              title={onRowClick ? "Klicken zum Filtern" : undefined}
              style={{
                borderTop: "1px solid var(--line)",
                background: ri === activeRow ? "rgba(37,99,235,.10)" : undefined,
                fontWeight: ri === activeRow ? 600 : undefined,
              }}
            >
              {r.map((c, ci) => (
                <td key={ci} style={{ textAlign: ci < leftCols ? "left" : "right", padding: "6px", wordBreak: "break-word" }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Muted({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="text-[13px]" style={{ color: color ?? "var(--ink-muted)", padding: "12px 4px" }}>
      {children}
    </div>
  );
}
