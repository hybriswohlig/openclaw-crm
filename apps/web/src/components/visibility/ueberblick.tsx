"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Muted, SOURCE_LABEL, fmt } from "./alle-zahlen";

// Mirror of services/website-insights.ts
type StageClass = "gewonnen" | "verloren" | "wartet" | "offen";
interface LedgerLead {
  id: string;
  name: string;
  value: number;
  stage: StageClass;
  createdAt: string;
}
interface LedgerRow {
  quelle: string;
  besuche: number;
  kontakte: number;
  leads: LedgerLead[];
  gewonnen: number;
  verloren: number;
  umsatz: number;
}
interface Finding {
  id: string;
  tone: "gut" | "achtung" | "info";
  lead: string;
  rest?: string;
  beleg: string;
  dots?: { filled: number; total: number };
  action?: { label: string; href: string };
}
interface Insights {
  configured: boolean;
  ledger?: {
    rows: LedgerRow[];
    unbekannt: { leads: LedgerLead[]; kontakteOhneLead: number };
    totals: { umsatz: number; gewonnen: number; leadsMitHerkunft: number; leadsGesamt: number };
  };
  findings?: Finding[];
  zuWenig?: string[];
}

const eur = (n: number) => `${fmt(Math.round(n))} €`;
const TONE: Record<Finding["tone"], string> = { gut: "#15803d", achtung: "#b45309", info: "var(--ink-muted)" };

export function Ueberblick({ days, site, onShowSections }: { days: number; site: string; onShowSections: () => void }) {
  const [data, setData] = useState<Insights | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    const params = new URLSearchParams({ days: String(days) });
    if (site) params.set("site", site);
    fetch(`/api/v1/visibility/insights?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) {
          setData(json.data as Insights);
          setState("ok");
        }
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [days, site]);

  if (state === "error") return <Muted color="#ef4444">Daten konnten nicht geladen werden.</Muted>;
  if (!data) return <Muted>Lade Auswertung …</Muted>;
  if (!data.configured) return <Muted>PostHog ist noch nicht verbunden (POSTHOG_PERSONAL_API_KEY fehlt).</Muted>;

  return (
    <div className="flex flex-col" style={{ gap: 28, opacity: state === "loading" ? 0.6 : 1 }}>
      <Befunde findings={data.findings ?? []} zuWenig={data.zuWenig ?? []} onShowSections={onShowSections} />
      {data.ledger && <KasseProKanal ledger={data.ledger} />}
    </div>
  );
}

// ─── Befunde (ganze Sätze mit Beleg) ────────────────────────────────────────

function Befunde({ findings, zuWenig, onShowSections }: { findings: Finding[]; zuWenig: string[]; onShowSections: () => void }) {
  if (findings.length === 0) {
    return <Muted>Noch zu wenig Daten für Aussagen. Die ersten Befunde erscheinen, sobald Besuche und Anfragen zusammenkommen.</Muted>;
  }
  return (
    <section className="rounded-xl" style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "8px 22px" }}>
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {findings.map((f, i) => (
          <li key={f.id} className="grid" style={{ gridTemplateColumns: "28px 1fr", gap: 8, padding: "18px 0", borderTop: i ? "1px solid var(--line)" : "none" }}>
            <span className="k-display" style={{ fontSize: 20, color: "var(--ink-muted)", lineHeight: 1.3 }}>
              {i + 1}
            </span>
            <div className="flex flex-col" style={{ gap: 8 }}>
              <p className="k-display" style={{ fontSize: 21, lineHeight: 1.3, letterSpacing: "-0.01em", margin: 0 }}>
                {f.dots && <Dots {...f.dots} color={TONE[f.tone]} />}
                <span style={{ fontWeight: 500 }}>{f.lead}</span>
                {f.rest && <span style={{ color: "var(--ink-muted)" }}> {f.rest}</span>}
              </p>
              <p className="text-[13px]" style={{ color: "var(--ink-muted)", margin: 0 }}>
                {f.beleg}
              </p>
              {f.action &&
                (f.action.href === "#abschnitte" ? (
                  <button type="button" onClick={onShowSections} className="self-start rounded-md text-[12.5px]" style={btnDark}>
                    {f.action.label}
                  </button>
                ) : (
                  <Link href={f.action.href} className="self-start rounded-md text-[12.5px]" style={btnDark}>
                    {f.action.label} →
                  </Link>
                ))}
            </div>
          </li>
        ))}
      </ol>
      {zuWenig.length > 0 && (
        <p className="text-[12.5px]" style={{ color: "var(--ink-muted)", borderTop: "1px solid var(--line)", padding: "12px 0" }}>
          Zu wenig Daten für eine Aussage: {zuWenig.join(", ")}.
        </p>
      )}
    </section>
  );
}

const btnDark: React.CSSProperties = { background: "var(--ink)", color: "var(--paper)", padding: "6px 12px", textDecoration: "none" };

function Dots({ filled, total, color }: { filled: number; total: number; color: string }) {
  const n = Math.min(total, 12);
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", gap: 3, marginRight: 8, verticalAlign: "middle" }}>
      {Array.from({ length: n }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 10,
            height: 10,
            borderRadius: 99,
            background: i < filled ? color : "transparent",
            border: `1.5px solid ${i < filled ? color : "var(--ink-muted)"}`,
          }}
        />
      ))}
    </span>
  );
}

// ─── Kasse pro Kanal ─────────────────────────────────────────────────────────

function KasseProKanal({ ledger }: { ledger: NonNullable<Insights["ledger"]> }) {
  const won = ledger.rows.flatMap((r) => r.leads.filter((l) => l.stage === "gewonnen").map((l) => ({ ...l, quelle: r.quelle })));
  const maxWon = Math.max(1, ...won.map((w) => w.value));
  return (
    <section className="flex flex-col" style={{ gap: 12 }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="k-display" style={{ fontSize: 20, fontWeight: 500, letterSpacing: "-0.01em" }}>
            Kasse pro Kanal
          </h2>
          <p className="text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
            Vom Besuch bis zum Auftrag, sortiert nach Umsatz. Jeder Punkt ist ein Mensch, Münzen sind gewonnene Aufträge.
          </p>
        </div>
        <div className="text-right">
          <div className="k-display" style={{ fontSize: 26, fontWeight: 500, color: "#15803d" }}>
            {eur(ledger.totals.umsatz)}
          </div>
          <div className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
            aus {ledger.totals.gewonnen} Aufträgen · {ledger.totals.leadsMitHerkunft} von {ledger.totals.leadsGesamt} Leads mit Website-Herkunft
          </div>
        </div>
      </div>

      <MobileLedger ledger={ledger} />
      <div className="hidden overflow-x-auto rounded-xl md:block" style={{ background: "var(--paper)", border: "1px solid var(--line)" }}>
        <table className="w-full text-[13px]" style={{ borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr style={{ color: "var(--ink-muted)", textAlign: "left" }}>
              {["Kanal", "Besuche", "Kontakt-Klick", "Lead im CRM", "Gewonnen", "Umsatz"].map((h, i) => (
                <th key={h} className="font-normal" style={{ padding: "10px 12px", textAlign: i === 5 ? "right" : "left", borderBottom: "1px solid var(--line)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((r) => (
              <tr key={r.quelle} style={{ borderBottom: "1px solid var(--line)" }}>
                <td style={cell}>
                  <div style={{ fontWeight: 600 }}>{SOURCE_LABEL[r.quelle] ?? r.quelle}</div>
                  <div className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                    {r.leads.length} {r.leads.length === 1 ? "Lead" : "Leads"}, {r.gewonnen} gewonnen
                  </div>
                </td>
                <td style={cell}>
                  <UnitDots n={r.besuche} color="#cfc6b8" size={6} />
                  <Sub>{fmt(r.besuche)}</Sub>
                </td>
                <td style={cell}>
                  <UnitDots n={r.kontakte} color="var(--ink)" size={8} />
                  <Sub>
                    {r.kontakte} von {fmt(r.besuche)}
                  </Sub>
                </td>
                <td style={cell}>
                  <div className="flex flex-wrap" style={{ gap: 3 }}>
                    {r.leads.map((l) => (
                      <Link key={l.id} href={`/objects/deals/${l.id}`} title={l.name} style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, background: l.stage === "verloren" ? "transparent" : "#b45309", border: "1.5px solid #b45309" }} />
                    ))}
                  </div>
                  <Sub>{r.leads.length ? `${r.leads.length} ${r.leads.length === 1 ? "Lead" : "Leads"}${r.verloren ? `, ${r.verloren} verloren` : ""}` : "keiner"}</Sub>
                </td>
                <td style={cell}>
                  <div className="flex flex-wrap items-center" style={{ gap: 4 }}>
                    {r.leads
                      .filter((l) => l.stage === "gewonnen")
                      .map((l) => {
                        const d = 12 + Math.round(Math.sqrt(l.value / maxWon) * 16);
                        return (
                          <Link key={l.id} href={`/objects/deals/${l.id}`} title={`${l.name} · ${eur(l.value)}`} style={{ display: "inline-block", width: d, height: d, borderRadius: 99, background: "#15803d", boxShadow: "inset 0 -2px 0 rgba(0,0,0,.18)" }} />
                        );
                      })}
                  </div>
                  <Sub>{r.leads.length ? `${r.gewonnen} von ${r.leads.length}` : "·"}</Sub>
                </td>
                <td style={{ ...cell, textAlign: "right" }}>
                  <div className="k-display" style={{ fontSize: 18, color: r.umsatz > 0 ? "#15803d" : "var(--ink-muted)" }}>
                    {eur(r.umsatz)}
                  </div>
                  {r.umsatz > 0 && r.besuche > 0 && <Sub>rund {eur(r.umsatz / r.besuche)} je Besuch</Sub>}
                </td>
              </tr>
            ))}
            <tr style={{ background: "repeating-linear-gradient(135deg, transparent 0 8px, rgba(0,0,0,.03) 8px 16px)" }}>
              <td style={cell}>
                <div style={{ fontWeight: 600 }}>Herkunft unbekannt</div>
                <div className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                  Leads ohne Website-Zuordnung
                </div>
              </td>
              <td style={cell}>
                <Sub>nicht zuzuordnen</Sub>
              </td>
              <td style={cell}>
                <UnitDots n={ledger.unbekannt.kontakteOhneLead} color="transparent" border="#b45309" size={8} />
                <Sub>{ledger.unbekannt.kontakteOhneLead} Klicks ohne Lead</Sub>
              </td>
              <td style={cell}>
                <div className="flex flex-wrap" style={{ gap: 3 }}>
                  {ledger.unbekannt.leads.map((l) => (
                    <Link key={l.id} href={`/objects/deals/${l.id}`} title={l.name} style={{ display: "inline-block", width: 10, height: 10, borderRadius: 99, border: "1.5px solid var(--ink-muted)" }} />
                  ))}
                </div>
                <Sub>{ledger.unbekannt.leads.length} Leads</Sub>
              </td>
              <td style={cell}>
                <Sub>nicht nach Herkunft auswertbar</Sub>
              </td>
              <td style={{ ...cell, textAlign: "right" }}>
                <Sub>kein Kanal belastet</Sub>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
        Herkunft = erste Quelle des Besuchers, über die Anfrage-Nr. in der WhatsApp oder eine Zuordnung von Hand im Lead. Leads zählen, wenn sie im Zeitraum angelegt wurden.
      </p>
    </section>
  );
}

/** Unter 768px: eine Karte pro Kanal statt der breiten Tabelle. */
function MobileLedger({ ledger }: { ledger: NonNullable<Insights["ledger"]> }) {
  return (
    <div className="flex flex-col gap-2 md:hidden">
      {ledger.rows.map((r) => (
        <div key={r.quelle} className="rounded-xl text-[13px]" style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "12px 14px" }}>
          <div className="flex items-baseline justify-between gap-2">
            <strong>{SOURCE_LABEL[r.quelle] ?? r.quelle}</strong>
            <span className="k-display" style={{ fontSize: 17, color: r.umsatz > 0 ? "#15803d" : "var(--ink-muted)" }}>
              {eur(r.umsatz)}
            </span>
          </div>
          <div style={{ color: "var(--ink-muted)", marginTop: 4 }}>
            {fmt(r.besuche)} Besuche · {r.kontakte} Kontakt-Klicks · {r.leads.length} {r.leads.length === 1 ? "Lead" : "Leads"} · {r.gewonnen} gewonnen
          </div>
        </div>
      ))}
      <div className="rounded-xl text-[13px]" style={{ border: "1px dashed var(--line)", padding: "12px 14px", color: "var(--ink-muted)" }}>
        <strong style={{ color: "var(--ink)" }}>Herkunft unbekannt:</strong> {ledger.unbekannt.leads.length} Leads, {ledger.unbekannt.kontakteOhneLead} Kontakt-Klicks ohne Lead
      </div>
    </div>
  );
}

const cell: React.CSSProperties = { padding: "12px", verticalAlign: "top" };

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px]" style={{ color: "var(--ink-muted)", marginTop: 4 }}>
      {children}
    </div>
  );
}

/** Ein Punkt je Mensch; ab 60 fasst ein Punkt 5 zusammen, damit die Zeile lesbar bleibt. */
function UnitDots({ n, color, size, border }: { n: number; color: string; size: number; border?: string }) {
  if (n <= 0) return null;
  const per = n > 60 ? 5 : 1;
  const count = Math.min(Math.ceil(n / per), 60);
  return (
    <div className="flex flex-wrap" style={{ gap: 3, maxWidth: 220 }} title={per > 1 ? "1 Punkt = 5" : undefined}>
      {Array.from({ length: count }).map((_, i) => (
        <span key={i} style={{ display: "inline-block", width: size, height: size, borderRadius: 99, background: color, border: border ? `1.5px solid ${border}` : "none" }} />
      ))}
    </div>
  );
}
