"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sectionLabel } from "@/lib/section-labels";

// Mirror of LeadWebHistory in services/website-analytics.ts
interface TimelineItem {
  at: string;
  event: string;
  label: string;
  detail: string | null;
  sessionId: string | null;
}
interface Candidate {
  sessionId: string;
  distinctId: string;
  site: string;
  channel: string;
  clickedAt: string;
  minutesBeforeContact: number;
  quelle: string;
  geraet: string;
  ref: string | null;
}
interface Match {
  by: "anfrage_nr" | "bestaetigt";
  sessionId: string;
  distinctId: string;
  firstSeen: string | null;
  visits: number;
  erstquelle: string | null;
  quelle: string | null;
  geraet: string | null;
  stadt: string | null;
  contactAt: string | null;
  minutesOnSite: number | null;
  recordingUrl: string;
  timeline: TimelineItem[];
  gesehen: { abschnitt: string; mal: number }[];
  paket: string | null;
  empfehlung: string | null;
  gespraech: { beobachtung: string; frage: string };
}
interface Heat {
  quelle: string;
  leads: number;
  gewonnen: number;
  entschieden: number;
  umsatz: number;
}
interface LeadWebHistory {
  configured: boolean;
  sites: string[] | null;
  anchorAt: string | null;
  anchorSource: string | null;
  ref: string | null;
  match: Match | null;
  candidates: Candidate[];
  heat: Heat | null;
}

const SOURCE_LABEL: Record<string, string> = {
  google_organisch: "Google (Suche)",
  google_maps: "Google Maps",
  google_unternehmensprofil: "Google-Unternehmensprofil",
  google_ads: "Google Ads",
  direkt: "Direkt / unbekannt",
  facebook_instagram: "Facebook / Instagram",
  ki_assistent: "KI-Assistent",
  kleinanzeigen: "Kleinanzeigen",
  verweis: "Andere Website",
};

const ANCHOR_LABEL: Record<string, string> = {
  whatsapp: "erste WhatsApp-Nachricht",
  email: "erste E-Mail",
  sms: "erste SMS",
  nachricht: "erste Nachricht",
  lead_angelegt: "Lead angelegt",
  manuell: "von Hand gesetzt",
};

const SITE_LABEL: Record<string, string> = {
  kottke: "kottke-umzuege.de",
  ruempeltuerken: "ruempeltuerken.de",
  ceylan: "ceylan-umzuege.de",
};

function when(iso: string | null): string {
  if (!iso) return "·";
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

/** 2798 → "1 Tag 22 Std." */
function duration(min: number | null): string {
  if (min == null) return "·";
  if (min < 60) return `${min} Min.`;
  const days = Math.floor(min / 1440);
  const hours = Math.round((min % 1440) / 60);
  if (days === 0) return `${hours} Std.`;
  return `${days} ${days === 1 ? "Tag" : "Tage"}${hours ? ` ${hours} Std.` : ""}`;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function LeadWebHistory({ recordId }: { recordId: string }) {
  const [data, setData] = useState<LeadWebHistory | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [at, setAt] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Nur die Antwort der letzten Anfrage übernehmen, ältere Suchen verwerfen.
  const requestId = useRef(0);

  const load = useCallback(
    async (atOverride?: string) => {
      const id = ++requestId.current;
      setState("loading");
      const params = atOverride ? `?at=${encodeURIComponent(new Date(atOverride).toISOString())}` : "";
      try {
        const res = await fetch(`/api/v1/visibility/lead/${recordId}${params}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (id !== requestId.current) return;
        const d = json.data as LeadWebHistory;
        setData(d);
        if (!atOverride) setAt(toLocalInput(d.anchorAt));
        setState("ok");
      } catch {
        if (id === requestId.current) setState("error");
      }
    },
    [recordId]
  );

  useEffect(() => {
    load();
  }, [load]);

  const mutate = async (init: RequestInit, fallback: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/v1/visibility/lead/${recordId}`, init);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setActionError(json?.error?.message ?? fallback);
        return;
      }
      load();
    } catch {
      setActionError(fallback);
    } finally {
      setBusy(false);
    }
  };

  const link = (c: Candidate) =>
    mutate(
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: c.sessionId, distinctId: c.distinctId }) },
      "Zuordnung konnte nicht gespeichert werden."
    );

  const unlink = () => mutate({ method: "DELETE" }, "Zuordnung konnte nicht gelöst werden.");

  if (state === "error") return <Note color="#ef4444">Website-Daten konnten nicht geladen werden.</Note>;
  if (!data) return <Note>Lade Website-Verlauf …</Note>;
  if (!data.configured) return <Note>PostHog ist im CRM noch nicht verbunden (POSTHOG_PERSONAL_API_KEY fehlt).</Note>;

  return (
    <div className="flex flex-col gap-4" style={{ opacity: state === "loading" ? 0.6 : 1 }}>
      <div className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
        {data.sites && data.sites.length > 1 ? "Websites" : "Website"}:{" "}
        <strong style={{ color: "var(--ink)" }}>
          {data.sites ? data.sites.map((s) => SITE_LABEL[s] ?? s).join(", ") : "alle (Betrieb unbekannt)"}
        </strong>
        {" · "}Kontaktzeitpunkt: {when(data.anchorAt)}
        {data.anchorSource ? ` (${ANCHOR_LABEL[data.anchorSource] ?? data.anchorSource})` : ""}
        {data.ref ? ` · Anfrage-Nr. ${data.ref}` : ""}
      </div>
      {actionError && <Note color="#ef4444">{actionError}</Note>}

      {data.match ? (
        <MatchView match={data.match} heat={data.heat} onUnlink={unlink} busy={busy} />
      ) : (
        <section className="rounded-xl" style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: "14px 16px" }}>
          <h3 className="k-display" style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>
            Mögliche Website-Besuche
          </h3>
          <p className="text-[12.5px]" style={{ color: "var(--ink-muted)", marginBottom: 10 }}>
            Kontakt-Klicks auf der Website von 60 Minuten vor bis 10 Minuten nach dem Kontaktzeitpunkt. War es ein Anruf zu einer
            anderen Uhrzeit, Zeitpunkt hier anpassen.
          </p>
          <div className="flex flex-wrap items-center gap-2" style={{ marginBottom: 12 }}>
            <input
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className="rounded-md text-[13px]"
              style={{ border: "1px solid var(--line)", padding: "4px 8px", background: "transparent" }}
            />
            <button
              type="button"
              onClick={() => at && load(at)}
              className="rounded-md text-[12.5px]"
              style={{ border: "1px solid var(--line)", padding: "4px 10px" }}
            >
              Suchen
            </button>
          </div>
          {data.candidates.length === 0 ? (
            <Note>Kein Kontakt-Klick in diesem Zeitfenster.</Note>
          ) : (
            <div className="flex flex-col gap-2">
              {data.candidates.map((c) => (
                <div
                  key={`${c.sessionId}-${c.channel}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg text-[13px]"
                  style={{ border: "1px solid var(--line)", padding: "8px 10px" }}
                >
                  <div>
                    <strong>{c.channel}</strong> geklickt um {when(c.clickedAt)}
                    <span style={{ color: "var(--ink-muted)" }}>
                      {" · "}
                      {c.minutesBeforeContact >= 0 ? `${c.minutesBeforeContact} Min. vorher` : `${-c.minutesBeforeContact} Min. danach`}
                      {" · "}
                      {SOURCE_LABEL[c.quelle] ?? (c.quelle || "Quelle unbekannt")} · {c.geraet || "Gerät unbekannt"}
                      {c.site && (!data.sites || data.sites.length > 1) ? ` · ${SITE_LABEL[c.site] ?? c.site}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => link(c)}
                    className="rounded-md text-[12.5px]"
                    style={{ background: "var(--ink)", color: "var(--paper)", padding: "4px 10px" }}
                  >
                    Zuordnen
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

const card: React.CSSProperties = { border: "1px solid var(--line)", background: "var(--paper)", padding: "14px 16px", borderRadius: 12 };

function MatchView({ match, heat, onUnlink, busy }: { match: Match; heat: Heat | null; onUnlink: () => void; busy: boolean }) {
  const quelle = match.erstquelle ?? match.quelle;
  const visits = groupVisits(match.timeline);
  const facts: [string, string][] = [
    ["Erster Besuch", when(match.firstSeen)],
    ["Über", quelle ? SOURCE_LABEL[quelle] ?? quelle : "·"],
    ["Gerät", match.geraet ? match.geraet.charAt(0).toUpperCase() + match.geraet.slice(1) : "·"],
    ["Ort (ungefähr)", match.stadt ?? "·"],
    ["Besuche", String(match.visits)],
    ["Kontakt-Klick", when(match.contactAt)],
    ["Erster Besuch bis Kontakt", duration(match.minutesOnSite)],
    ["Zugeordnet über", match.by === "anfrage_nr" ? "Anfrage-Nr." : "von Hand"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <section style={{ ...card, borderLeft: "3px solid #15803d" }}>
        <div className="text-[11.5px]" style={{ color: "var(--ink-muted)", letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: 6 }}>
          Vor dem Gespräch
        </div>
        <p className="k-display" style={{ fontSize: 18, lineHeight: 1.35, margin: 0 }}>
          {match.gespraech.beobachtung}
        </p>
        <p className="text-[13px]" style={{ color: "var(--ink-muted)", margin: "8px 0 0" }}>
          Vorschlag: {match.gespraech.frage}
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <section style={card} className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginBottom: 12 }}>
            <h3 className="k-display" style={{ fontSize: 15, fontWeight: 500 }}>
              Weg zur Anfrage
            </h3>
            <div className="flex items-center gap-3 text-[12.5px]">
              <a href={match.recordingUrl} target="_blank" rel="noopener noreferrer" className="underline">
                ▶ Aufnahme ansehen
              </a>
              {match.by === "bestaetigt" && (
                <button type="button" disabled={busy} onClick={onUnlink} className="underline" style={{ color: "var(--ink-muted)" }}>
                  Zuordnung lösen
                </button>
              )}
            </div>
          </div>
          {visits.length === 0 ? (
            <Note>Keine Seitenaufrufe gespeichert.</Note>
          ) : (
            <div className="flex flex-col gap-4">
              {visits.map((v, i) => (
                <div key={v.sessionId ?? i}>
                  <div className="text-[12px]" style={{ color: "var(--ink-muted)", marginBottom: 6 }}>
                    <span className="rounded" style={{ border: "1px solid var(--line)", padding: "1px 6px", marginRight: 6, color: "var(--ink)" }}>
                      Besuch {i + 1}
                    </span>
                    {when(v.start)} · {v.minutes} Min.{v.endsWithContact ? " · endet mit Kontakt" : ""}
                  </div>
                  <Stations stations={v.stations} />
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-4">
          {heat && heat.leads > 0 && (
            <section style={card}>
              <h3 className="k-display" style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>
                Wie gut läuft {SOURCE_LABEL[heat.quelle] ?? heat.quelle}?
              </h3>
              <div className="flex flex-wrap" style={{ gap: 4, marginBottom: 6 }}>
                {Array.from({ length: Math.min(heat.leads, 24) }).map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 99,
                      background: i < heat.gewonnen ? "#15803d" : "transparent",
                      border: `1.5px solid ${i < heat.gewonnen ? "#15803d" : "var(--ink-muted)"}`,
                    }}
                  />
                ))}
              </div>
              <p className="text-[13px]" style={{ margin: 0 }}>
                <strong>{heat.gewonnen}</strong> von {heat.leads} Leads über diesen Kanal wurden gewonnen (letzte 180 Tage)
                {heat.leads - heat.entschieden > 0 ? `, ${heat.leads - heat.entschieden} sind noch offen` : ""}.
              </p>
            </section>
          )}
          <section style={card}>
            <h3 className="k-display" style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>
              Besucher
            </h3>
            <dl className="grid gap-x-4 gap-y-1 text-[13px]" style={{ gridTemplateColumns: "max-content 1fr", margin: 0 }}>
              {facts.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt style={{ color: "var(--ink-muted)" }}>{k}</dt>
                  <dd style={{ margin: 0 }}>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}

interface Station {
  label: string;
  detail: string | null;
  kind: "page" | "section" | "choice" | "contact" | "exit";
}

/** Events pro Besuch zu Stationen verdichten (gleiche Abschnitte hintereinander zusammenfassen). */
function groupVisits(timeline: TimelineItem[]) {
  const bySession = new Map<string, TimelineItem[]>();
  for (const t of timeline) {
    const key = t.sessionId ?? "ohne";
    bySession.set(key, [...(bySession.get(key) ?? []), t]);
  }
  return [...bySession.entries()].map(([sessionId, items]) => {
    const stations: Station[] = [];
    for (const t of items) {
      let st: Station | null = null;
      if (t.event === "$pageview") st = { label: t.detail === "/" ? "Startseite" : t.detail ?? "Seite", detail: null, kind: "page" };
      else if (t.event === "abschnitt_gesehen") st = { label: sectionLabel(t.detail), detail: null, kind: "section" };
      else if (t.event === "package_click") st = { label: `Paket „${t.detail}“`, detail: null, kind: "choice" };
      else if (t.event === "paketfinder_submit") st = { label: "Paket-Finder", detail: t.detail ? `Empfehlung ${t.detail}` : null, kind: "choice" };
      else if (t.event === "formular_gestartet") st = { label: "Formular angefangen", detail: null, kind: "choice" };
      else if (t.event.startsWith("kontakt_") || t.event === "anfrage_gesendet")
        st = { label: t.label.replace(" geklickt", ""), detail: `${when(t.at).split(", ")[1] ?? ""}${t.detail ? ` · ${t.detail}` : ""}`, kind: "contact" };
      else if (t.event === "seite_verlassen") st = { label: "verlassen", detail: t.detail, kind: "exit" };
      if (!st) continue;
      const prev = stations[stations.length - 1];
      if (prev && prev.label === st.label && prev.kind === st.kind) continue;
      stations.push(st);
    }
    const start = items[0]?.at ?? null;
    const end = items[items.length - 1]?.at ?? null;
    const minutes = start && end ? Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 60000)) : 0;
    return { sessionId, start, minutes, stations, endsWithContact: stations.some((x) => x.kind === "contact") };
  });
}

function Stations({ stations }: { stations: Station[] }) {
  const color = (k: Station["kind"]) => (k === "contact" ? "#15803d" : k === "exit" ? "#b45309" : k === "choice" ? "#1d4ed8" : "var(--ink)");
  return (
    <ol className="flex flex-wrap items-start" style={{ listStyle: "none", margin: 0, padding: 0, rowGap: 10 }}>
      {stations.map((st, i) => (
        <li key={i} className="flex items-start">
          {i > 0 && (
            <span
              aria-hidden="true"
              style={{ width: 22, marginTop: 5, borderTop: `2px ${st.kind === "exit" ? "dashed" : "solid"} ${st.kind === "exit" ? "#b45309" : "var(--ink)"}` }}
            />
          )}
          <span className="flex flex-col items-center text-center" style={{ minWidth: 56, maxWidth: 110 }}>
            <span style={{ width: 12, height: 12, borderRadius: 99, background: st.kind === "section" || st.kind === "page" ? "var(--paper)" : color(st.kind), border: `2px solid ${color(st.kind)}` }} />
            <span className="text-[12px]" style={{ fontWeight: 600, color: color(st.kind), marginTop: 3, lineHeight: 1.2 }}>
              {st.label}
            </span>
            {st.detail && (
              <span className="text-[11px]" style={{ color: "var(--ink-muted)", lineHeight: 1.2 }}>
                {st.detail}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Note({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="text-[13px]" style={{ color: color ?? "var(--ink-muted)", padding: "8px 2px" }}>
      {children}
    </div>
  );
}
