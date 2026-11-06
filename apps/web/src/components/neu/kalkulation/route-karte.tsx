"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { apiAufruf } from "@/components/neu/akte/api";
import { ROUTE_HINWEISE, type RoutenStatus } from "@/lib/route-hinweise";

/** Eine Teilstrecke aus `GET …/[v]/route-karte` (Task 6, Bericht D). */
export interface Teilstrecke {
  von: string;
  nach: string;
  km: number;
  minuten: number;
  polyline: string;
  haupt: boolean;
}

export interface RouteDaten {
  status: RoutenStatus;
  teilstrecken: Teilstrecke[];
  googleLink: string | null;
  stationen: number;
  gesamtKm: number | null;
  gesamtMinuten: number | null;
}

const KM = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const STUNDEN = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** „9 km · 16 min“ */
export function streckeText(km: number, minuten: number): string {
  return `${KM.format(km)} km · ${Math.round(minuten)} min`;
}

/** „48 km · 1,2 h“, unter einer Stunde „12 km · 40 min“. */
export function gesamtText(km: number, minuten: number): string {
  const zeit = minuten < 60 ? `${Math.round(minuten)} min` : `${STUNDEN.format(minuten / 60)} h`;
  return `${KM.format(km)} km · ${zeit}`;
}

const RouteKarteBild = dynamic(() => import("./route-karte-bild"), {
  ssr: false,
  loading: () => <span className="lg-skeleton" style={{ position: "absolute", inset: 0, borderRadius: 12 }} />,
});

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; daten: RouteDaten };

/**
 * Route der Version (Spec 3.6): Karte 230 px, Teilstrecken „9 km · 16 min
 * Station → Beladen“, darunter „Vorausgewählte Route · günstigste von N
 * Stationen · 48 km · 1,2 h · in Google Maps öffnen“. Je Status ein Hinweis
 * aus `ROUTE_HINWEISE` (Review Focus 1: ungenaue Adresse ohne Abruf).
 * `vorschau` ersetzt den Abruf (Fixture, Tests).
 */
export function RouteKarte({ dealId, versionNr, vorschau }: { dealId: string; versionNr: number; vorschau?: RouteDaten }) {
  const [zustand, setZustand] = useState<Zustand>(() => (vorschau ? { art: "fertig", daten: vorschau } : { art: "laden" }));

  useEffect(() => {
    if (vorschau) return;
    let aktiv = true;
    setZustand({ art: "laden" });
    void apiAufruf<RouteDaten>(`/api/v1/deals/${encodeURIComponent(dealId)}/calculation/versions/${versionNr}/route-karte`).then((r) => {
      if (!aktiv) return;
      setZustand(r.ok ? { art: "fertig", daten: r.data } : { art: "fehler", meldung: r.message });
    });
    return () => {
      aktiv = false;
    };
  }, [dealId, versionNr, vorschau]);

  if (zustand.art === "laden") {
    return (
      <div className="kalk-route" aria-busy="true" aria-label="Route wird geladen">
        <div className="kalk-karte">
          <span className="lg-skeleton" style={{ position: "absolute", inset: 0 }} />
        </div>
      </div>
    );
  }

  if (zustand.art === "fehler") {
    return (
      <div className="kalk-route">
        <div className="kalk-karte">
          <p className="kalk-karte-leer">Route konnte nicht geladen werden. {zustand.meldung}</p>
        </div>
      </div>
    );
  }

  const { daten } = zustand;
  const hinweis = ROUTE_HINWEISE[daten.status] ?? "Route konnte nicht geladen werden.";
  const zeigen = daten.status === "ok" && daten.teilstrecken.length > 0;
  const gesamt = daten.gesamtKm !== null && daten.gesamtMinuten !== null ? gesamtText(daten.gesamtKm, daten.gesamtMinuten) : null;

  return (
    <div className="kalk-route" aria-label="Route">
      <div className="kalk-karte">
        {zeigen ? <RouteKarteBild teilstrecken={daten.teilstrecken} /> : <p className="kalk-karte-leer">{hinweis}</p>}
      </div>
      {zeigen ? (
        <ul className="kalk-teilstrecken">
          {daten.teilstrecken.map((t, i) => (
            <li key={`${t.von}-${t.nach}-${i}`}>
              <b>{streckeText(t.km, t.minuten)}</b>
              {t.von} → {t.nach}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="kalk-route-fuss">
        <span className="kalk-marke" data-ton="blau">
          Google
        </span>
        {zeigen ? (
          <span>
            Vorausgewählte Route
            {daten.stationen > 1 ? ` · günstigste von ${daten.stationen} Stationen` : ""}
            {gesamt ? ` · ${gesamt}` : ""}
          </span>
        ) : (
          <span>{hinweis}</span>
        )}
        {daten.googleLink ? (
          <>
            <span aria-hidden="true">·</span>
            <a href={daten.googleLink} target="_blank" rel="noreferrer">
              in Google Maps öffnen
            </a>
          </>
        ) : null}
      </p>
    </div>
  );
}
