"use client";
/**
 * Lagekarte, Panel-Tab „Verlauf“: lädt die Lifecycle-Meilensteine eines Leads
 * (GET /api/v1/deals/{id}/lifecycle) beim ersten Öffnen und zeigt sie als
 * vertikale Zeitleiste mit Haken und Datum. Nur lesend.
 */
import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { de } from "date-fns/locale";
import { Check, RefreshCw } from "lucide-react";

interface Meilenstein {
  key: string;
  label: string;
  /** ISO-Zeitstempel oder YYYY-MM-DD, null wenn nicht erreicht. */
  at: string | null;
  done: boolean;
}

interface Lifecycle {
  milestones: Meilenstein[];
  current: string | null;
}

type Zustand =
  | { status: "laedt" }
  | { status: "fehler"; meldung: string }
  | { status: "ok"; daten: Lifecycle };

const KNOPF =
  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--lk-panel-rand)] bg-[var(--lk-panel)] px-3 text-[13px] font-medium text-[var(--lk-text)] transition-colors hover:bg-[var(--lk-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--lk-akzent)] max-lg:min-h-11";

function datumText(at: string): string {
  const d = parseISO(at);
  if (Number.isNaN(d.getTime())) return "";
  return at.length === 10
    ? format(d, "d. MMM yyyy", { locale: de })
    : format(d, "d. MMM yyyy, HH:mm", { locale: de });
}

export default function Verlauf({ leadId }: { leadId: string }) {
  const [zustand, setZustand] = useState<Zustand>({ status: "laedt" });
  const [versuch, setVersuch] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setZustand({ status: "laedt" });
    (async () => {
      try {
        const res = await fetch(`/api/v1/deals/${encodeURIComponent(leadId)}/lifecycle`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          setZustand({ status: "fehler", meldung: `Verlauf konnte nicht geladen werden (${res.status})` });
          return;
        }
        const body = (await res.json()) as { data?: Lifecycle };
        if (!body.data || !Array.isArray(body.data.milestones)) {
          setZustand({ status: "fehler", meldung: "Verlauf ist leer" });
          return;
        }
        setZustand({ status: "ok", daten: body.data });
      } catch {
        if (ac.signal.aborted) return;
        setZustand({ status: "fehler", meldung: "Verlauf konnte nicht geladen werden" });
      }
    })();
    return () => ac.abort();
  }, [leadId, versuch]);

  if (zustand.status === "laedt") {
    return (
      <div className="space-y-4 px-4 py-4" aria-busy="true" aria-label="Verlauf wird geladen">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-5 w-5 shrink-0 animate-pulse rounded-full bg-[var(--lk-aktiv)]" />
            <div className="h-3 flex-1 animate-pulse rounded bg-[var(--lk-aktiv)]" style={{ maxWidth: `${55 + (i % 3) * 12}%` }} />
          </div>
        ))}
      </div>
    );
  }

  if (zustand.status === "fehler") {
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-4">
        <p className="text-[13px] text-[var(--lk-warn)]">{zustand.meldung}</p>
        <button type="button" className={KNOPF} onClick={() => setVersuch((v) => v + 1)}>
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Erneut versuchen
        </button>
      </div>
    );
  }

  const { milestones, current } = zustand.daten;
  if (milestones.length === 0) {
    return <p className="px-4 py-4 text-[13px] text-[var(--lk-text-schwach)]">Noch kein Verlauf zu diesem Lead.</p>;
  }

  return (
    <ol className="relative px-4 py-4" aria-label="Meilensteine">
      {milestones.map((m, i) => {
        const istAktuell = m.key === current;
        const letzter = i === milestones.length - 1;
        return (
          <li key={m.key} className="relative flex gap-3 pb-5 last:pb-0">
            {!letzter && (
              <span
                aria-hidden="true"
                className="absolute left-[9px] top-5 bottom-0 w-px"
                style={{ background: m.done ? "var(--lk-ok)" : "var(--lk-panel-rand)" }}
              />
            )}
            <span
              aria-hidden="true"
              className="relative z-[1] flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2"
              style={
                m.done
                  ? { background: "var(--lk-ok)", borderColor: "var(--lk-ok)", color: "#fff" }
                  : istAktuell
                    ? { background: "var(--lk-panel)", borderColor: "var(--lk-akzent)" }
                    : { background: "var(--lk-panel)", borderColor: "var(--lk-panel-rand)" }
              }
            >
              {m.done ? (
                <Check className="h-3 w-3" strokeWidth={3} />
              ) : istAktuell ? (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--lk-akzent)" }} />
              ) : null}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className="text-[13.5px] font-medium"
                  style={{ color: m.done || istAktuell ? "var(--lk-text)" : "var(--lk-text-schwach)" }}
                >
                  {m.label}
                  {m.done && <span className="sr-only"> (erledigt)</span>}
                </span>
                {m.at && (
                  <span className="k-mono shrink-0 text-[11px] tabular-nums text-[var(--lk-text-schwach)]">
                    {datumText(m.at)}
                  </span>
                )}
              </div>
              {istAktuell && !m.done && (
                <span className="k-label mt-0.5 inline-block" style={{ color: "var(--lk-akzent)" }}>
                  Als Nächstes
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
