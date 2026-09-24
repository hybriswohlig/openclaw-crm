"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
}
interface LeadWebHistory {
  configured: boolean;
  site: string | null;
  anchorAt: string | null;
  anchorSource: string | null;
  ref: string | null;
  match: Match | null;
  candidates: Candidate[];
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

const SITE_LABEL: Record<string, string> = { kottke: "kottke-umzuege.de", ruempeltuerken: "ruempeltuerken.de" };

function when(iso: string | null): string {
  if (!iso) return "·";
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
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
        Website: <strong style={{ color: "var(--ink)" }}>{data.site ? SITE_LABEL[data.site] ?? data.site : "keinem Betrieb zugeordnet"}</strong>
        {" · "}Kontaktzeitpunkt: {when(data.anchorAt)}
        {data.anchorSource ? ` (${ANCHOR_LABEL[data.anchorSource] ?? data.anchorSource})` : ""}
        {data.ref ? ` · Anfrage-Nr. ${data.ref}` : ""}
      </div>
      {actionError && <Note color="#ef4444">{actionError}</Note>}

      {data.match ? (
        <MatchView match={data.match} onUnlink={unlink} busy={busy} />
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
                      {c.site && !data.site ? ` · ${SITE_LABEL[c.site] ?? c.site}` : ""}
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

function MatchView({ match, onUnlink, busy }: { match: Match; onUnlink: () => void; busy: boolean }) {
  const facts: [string, string][] = [
    ["Zugeordnet über", match.by === "anfrage_nr" ? "Anfrage-Nr. in der Nachricht" : "Von Hand bestätigt"],
    ["Erster Besuch", when(match.firstSeen)],
    ["Besuche insgesamt", String(match.visits)],
    ["Erste Quelle", match.erstquelle ? SOURCE_LABEL[match.erstquelle] ?? match.erstquelle : "·"],
    ["Letzte Quelle", match.quelle ? SOURCE_LABEL[match.quelle] ?? match.quelle : "·"],
    ["Gerät", match.geraet ?? "·"],
    ["Ort (ungefähr)", match.stadt ?? "·"],
    ["Kontakt-Klick", when(match.contactAt)],
    ["Vom ersten Besuch bis zum Kontakt", match.minutesOnSite == null ? "·" : `${match.minutesOnSite} Min.`],
  ];
  return (
    <section className="rounded-xl" style={{ border: "1px solid var(--line)", background: "var(--paper)", padding: "14px 16px" }}>
      <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginBottom: 12 }}>
        <h3 className="k-display" style={{ fontSize: 14, fontWeight: 500 }}>
          Website-Verlauf
        </h3>
        <div className="flex items-center gap-3 text-[12.5px]">
          <a href={match.recordingUrl} target="_blank" rel="noopener noreferrer" className="underline">
            Aufnahme ansehen
          </a>
          {match.by === "bestaetigt" && (
            <button type="button" disabled={busy} onClick={onUnlink} className="underline" style={{ color: "var(--ink-muted)" }}>
              Zuordnung lösen
            </button>
          )}
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-[13px]" style={{ gridTemplateColumns: "max-content 1fr", marginBottom: 14 }}>
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt style={{ color: "var(--ink-muted)" }}>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <ol className="flex flex-col text-[13px]" style={{ borderLeft: "2px solid var(--line)", paddingLeft: 12, gap: 6 }}>
        {match.timeline.map((t, i) => (
          <li key={i}>
            <span style={{ color: "var(--ink-muted)" }}>{when(t.at)}</span> · {t.label}
            {t.detail ? <span style={{ color: "var(--ink-muted)" }}> · {t.detail}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Note({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <div className="text-[13px]" style={{ color: color ?? "var(--ink-muted)", padding: "8px 2px" }}>
      {children}
    </div>
  );
}
