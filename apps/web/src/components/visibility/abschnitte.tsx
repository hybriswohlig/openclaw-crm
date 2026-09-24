"use client";

import { useEffect, useState } from "react";
import { Muted, fmt, pct } from "./alle-zahlen";
import { sectionLabel } from "@/lib/section-labels";

// Mirror of SectionBand in services/website-insights.ts
interface SectionStat {
  abschnitt: string;
  position: number | null;
  erreicht: number;
  gehen: number;
  kontakte: number;
  medianSekunden: number | null;
  kontaktquoteGesehen: number | null;
}
interface SectionBand {
  configured: boolean;
  page: string;
  pages: { page: string; besuche: number }[];
  besuche: number;
  kontaktBesuche: number;
  sections: SectionStat[];
}

const MIN_FOR_PATTERN = 8;

/**
 * Die Seite als senkrechter Streifen ihrer Abschnitte: Breite = wie viele dort
 * ankommen, Tönung = Verweildauer, rote Marke = hier gehen Leute ohne Kontakt,
 * grüne Punkte = Kontakt-Klicks aus diesem Abschnitt.
 */
export function Abschnitte({ days, site }: { days: number; site: string }) {
  const [page, setPage] = useState("/");
  const [data, setData] = useState<SectionBand | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    const params = new URLSearchParams({ days: String(days), page });
    if (site) params.set("site", site);
    fetch(`/api/v1/visibility/sections?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        if (!cancelled) {
          setData(json.data as SectionBand);
          setState("ok");
        }
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
    };
  }, [days, site, page]);

  if (state === "error") return <Muted color="#ef4444">Daten konnten nicht geladen werden.</Muted>;
  if (!data) return <Muted>Lade Abschnitte …</Muted>;
  if (!data.configured) return <Muted>PostHog ist noch nicht verbunden.</Muted>;

  const maxReach = Math.max(1, data.besuche, ...data.sections.map((s) => s.erreicht));
  const maxDwell = Math.max(1, ...data.sections.map((s) => s.medianSekunden ?? 0));
  const maxExit = Math.max(1, ...data.sections.map((s) => s.gehen));
  const worst = [...data.sections].filter((s) => s.erreicht >= MIN_FOR_PATTERN).sort((a, b) => b.gehen - a.gehen)[0];
  const best = [...data.sections]
    .filter((s) => s.erreicht >= MIN_FOR_PATTERN)
    .sort((a, b) => (b.kontaktquoteGesehen ?? 0) - (a.kontaktquoteGesehen ?? 0))[0];

  return (
    <div className="flex flex-col" style={{ gap: 14, opacity: state === "loading" ? 0.6 : 1 }}>
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <span style={{ color: "var(--ink-muted)" }}>Seite</span>
        {(data.pages.length ? data.pages : [{ page: "/", besuche: 0 }]).map((p) => (
          <button
            key={p.page}
            type="button"
            onClick={() => setPage(p.page)}
            className="rounded-md"
            style={{
              padding: "4px 10px",
              border: "1px solid var(--line)",
              background: p.page === page ? "var(--ink)" : "var(--paper)",
              color: p.page === page ? "var(--paper)" : "var(--ink)",
            }}
          >
            {p.page === "/" ? "Startseite" : p.page}
          </button>
        ))}
      </div>

      <p className="text-[12.5px]" style={{ color: "var(--ink-muted)" }}>
        Breite: wie viele den Abschnitt erreichen. Dunkler: längere Zeit dort. Rote Marke: hier gehen Besucher ohne Kontakt. Grüne Punkte: Kontakt-Klicks aus dem Abschnitt.
        {" "}
        {fmt(data.besuche)} Besuche auf dieser Seite, {fmt(data.kontaktBesuche)} mit Kontakt.
      </p>

      {data.sections.length === 0 ? (
        <Muted>Für diese Seite gibt es im Zeitraum noch keine Abschnittsdaten.</Muted>
      ) : (
        <div className="grid gap-6" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 300px)" }}>
          <div className="rounded-xl" style={{ background: "var(--paper)", border: "1px solid var(--line)", padding: "16px 18px" }}>
            {data.sections.map((s) => {
              const width = Math.max(8, Math.round((s.erreicht / maxReach) * 100));
              const tone = s.medianSekunden == null ? 0.25 : 0.2 + 0.6 * (s.medianSekunden / maxDwell);
              const thin = s.erreicht < MIN_FOR_PATTERN;
              return (
                <div key={s.abschnitt} className="grid items-center" style={{ gridTemplateColumns: "44px minmax(0, 1fr) minmax(170px, 38%)", gap: 10, minHeight: 40 }}>
                  <div className="flex flex-wrap justify-end" style={{ gap: 2 }} title={`${s.kontakte} Kontakt-Klicks`}>
                    {Array.from({ length: Math.min(s.kontakte, 12) }).map((_, i) => (
                      <span key={i} style={{ width: 6, height: 6, borderRadius: 99, background: "#15803d" }} />
                    ))}
                  </div>
                  <div className="relative flex justify-center" style={{ height: 34 }}>
                    <div
                      className="flex items-center justify-center text-[12.5px]"
                      style={{
                        width: `${width}%`,
                        background: thin
                          ? "repeating-linear-gradient(90deg, rgba(34,29,22,.18) 0 4px, transparent 4px 7px)"
                          : `rgba(34,29,22,${tone.toFixed(2)})`,
                        color: tone > 0.55 && !thin ? "var(--paper)" : "var(--ink)",
                        fontWeight: 600,
                        borderRadius: 4,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                      }}
                    >
                      {sectionLabel(s.abschnitt)}
                    </div>
                    {s.gehen > 0 && (
                      <span
                        title={`${s.gehen} gehen hier ohne Kontakt`}
                        style={{
                          position: "absolute",
                          right: `calc(${(100 - width) / 2}% - 7px)`,
                          top: "50%",
                          transform: "translateY(-50%)",
                          width: 6 + Math.round((s.gehen / maxExit) * 10),
                          height: 6 + Math.round((s.gehen / maxExit) * 10),
                          borderRadius: 99,
                          background: "var(--paper)",
                          border: "2px solid #dc2626",
                        }}
                      />
                    )}
                  </div>
                  <div className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                    {fmt(s.erreicht)} erreichen · {fmt(s.gehen)} gehen · {s.kontakte} {s.kontakte === 1 ? "Kontakt" : "Kontakte"}
                    {s.medianSekunden != null ? ` · ${Math.round(s.medianSekunden)} s` : ""}
                    {thin ? " · zu wenig für ein Muster" : ""}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="flex flex-col text-[13px]" style={{ gap: 14 }}>
            {worst && worst.gehen > 0 && (
              <Note title={`${fmt(worst.gehen)} gehen ohne Kontakt bei „${sectionLabel(worst.abschnitt)}“`}>
                Mehr als bei jedem anderen Abschnitt dieser Seite. {worst.medianSekunden != null ? `Im Mittel ${Math.round(worst.medianSekunden)} s dort. ` : ""}
                Den Grund zeigen die Zahlen nicht, die Aufnahmen in PostHog schon.
              </Note>
            )}
            {best && (best.kontaktquoteGesehen ?? 0) > 0 && (
              <Note title={`Wer „${sectionLabel(best.abschnitt)}“ sieht, meldet sich am häufigsten`}>
                {pct(best.kontaktquoteGesehen)} der Besuche mit diesem Abschnitt hatten einen Kontakt-Klick. {fmt(best.erreicht)} von {fmt(data.besuche)} Besuchen kommen bis dorthin.
              </Note>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: "2px solid #b45309", paddingTop: 10 }}>
      <div className="k-display" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.25, marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ color: "var(--ink-muted)" }}>{children}</div>
    </div>
  );
}
