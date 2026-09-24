"use client";

import { useEffect, useState } from "react";
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

// ─── Types (mirror services/website-analytics.ts) ───────────────────────────

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
}

export const SITE_LABEL: Record<string, string> = {
  kottke: "kottke-umzuege.de",
  ruempeltuerken: "ruempeltuerken.de",
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
  andere_suche: "Andere Suchmaschine",
  bing: "Bing",
  whatsapp: "WhatsApp",
  kleinanzeigen: "Kleinanzeigen",
  verweis: "Andere Website",
};

export const NUM = new Intl.NumberFormat("de-DE");
export const fmt = (n: number) => NUM.format(n);
export const pct = (n: number | null) => (n == null ? "·" : `${String(n).replace(".", ",")} %`);

/** Reiter "Alle Zahlen": alle Kennzahlen als Tabellen und Diagramme. */
export function AlleZahlen({ days, site }: { days: number; site: string }) {
  const [data, setData] = useState<VisibilityOverview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    const params = new URLSearchParams({ days: String(days) });
    if (site) params.set("site", site);
    fetch(`/api/v1/visibility/overview?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) {
          setData(json.data as VisibilityOverview);
          setState("ok");
        }
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [days, site]);

  return (
    <div className="flex flex-col" style={{ gap: 16 }}>
      {state === "loading" && !data && <Muted>Lade Website-Daten …</Muted>}
      {state === "error" && <Muted color="#ef4444">Daten konnten nicht geladen werden.</Muted>}
      {data && !data.configured && (
        <Muted>PostHog ist noch nicht verbunden. Es fehlt die Umgebungsvariable POSTHOG_PERSONAL_API_KEY.</Muted>
      )}

      {data && data.configured && (
        <div className="flex flex-col" style={{ gap: 16, opacity: state === "loading" ? 0.6 : 1 }}>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <Kpi label="Besuche" value={fmt(data.totals.besuche)} />
            <Kpi label="Besucher" value={fmt(data.totals.besucher)} />
            <Kpi label="Besuche mit Kontakt" value={fmt(data.totals.mitKontakt)} />
            <Kpi label="Kontaktquote" value={pct(data.totals.kontaktquote)} />
          </div>

          {!site && data.perSite.length > 0 && (
            <Panel title="Websites im Vergleich">
              <Table
                head={["Website", "Besuche", "Mit Kontakt", "Quote"]}
                rows={data.perSite.map((r) => [SITE_LABEL[r.site] ?? r.site, fmt(r.besuche), fmt(r.mitKontakt), pct(r.kontaktquote)])}
              />
            </Panel>
          )}

          <Panel title="Besuche und Kontakte pro Tag">
            {data.daily.length === 0 ? (
              <Muted>Noch keine Besuche im Zeitraum.</Muted>
            ) : (
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.daily.map((d) => ({ ...d, tag: d.tag.slice(5).split("-").reverse().join(".") }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="tag" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} width={32} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="besuche" name="Besuche" stroke="#2563eb" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="mitKontakt" name="Mit Kontakt" stroke="#16a34a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            <Panel title="Woher die Besucher kommen">
              <Table
                head={["Quelle", "Besuche", "Mit Kontakt", "Quote"]}
                rows={data.sources.map((r) => [SOURCE_LABEL[r.quelle] ?? r.quelle, fmt(r.besuche), fmt(r.mitKontakt), pct(r.kontaktquote)])}
                empty="Noch keine Daten."
              />
            </Panel>
            <Panel title="Wie sie Kontakt aufnehmen">
              <Table
                head={["Weg", "Klicks"]}
                rows={data.contactWays.map((r) => [r.weg, fmt(r.klicks)])}
                empty="Noch keine Kontakt-Klicks."
              />
              <div style={{ height: 12 }} />
              <Table
                head={["Gerät", "Besuche", "Mit Kontakt"]}
                rows={data.devices.map((r) => [r.geraet, fmt(r.besuche), fmt(r.mitKontakt)])}
              />
            </Panel>
          </div>

          <Panel title="Uhrzeit: wann Besucher kommen und sich melden">
            {data.hours.length === 0 ? (
              <Muted>Noch keine Daten.</Muted>
            ) : (
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.hours.map((h) => ({ ...h, stunde: `${h.stunde} Uhr` }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                    <XAxis dataKey="stunde" fontSize={11} />
                    <YAxis allowDecimals={false} fontSize={11} width={32} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="besuche" name="Besuche" fill="#93c5fd" />
                    <Bar dataKey="mitKontakt" name="Mit Kontakt" fill="#16a34a" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
            <Panel title="Wo Besucher ohne Kontakt abspringen">
              <Table
                head={["Seite", "Letzter Abschnitt", "Besuche", "aktiv (Median)"]}
                leftCols={2}
                rows={data.exits.map((r) => [r.seite, r.abschnitt, fmt(r.besuche), `${fmt(r.medianSekunden)} s`])}
                empty="Noch keine Absprünge erfasst."
              />
            </Panel>
            <Panel title="Meistbesuchte Seiten">
              <Table head={["Seite", "Besuche"]} rows={data.pages.map((r) => [r.seite, fmt(r.besuche)])} empty="Noch keine Daten." />
            </Panel>
          </div>
        </div>
      )}
    </div>
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
    <div
      className="rounded-xl"
      style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "14px 16px", minHeight: 84 }}
    >
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
}: {
  head: string[];
  rows: (string | number)[][];
  empty?: string;
  /** Anzahl Textspalten links, der Rest sind Zahlen (rechtsbündig). */
  leftCols?: number;
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
            <tr key={ri} style={{ borderTop: "1px solid var(--line)" }}>
              {r.map((c, ci) => (
                <td
                  key={ci}
                  style={{ textAlign: ci < leftCols ? "left" : "right", padding: "6px", wordBreak: "break-word" }}
                >
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
