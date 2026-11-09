"use client";

import "@/styles/neu-uebersicht.css";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { apiAufruf } from "@/components/neu/akte/api";
import { seitentitel } from "@/components/neu/nav-config";
import type { UebersichtAntwort } from "@/lib/einstellungen-uebersicht";
import { AbschlussBlock } from "./abschluss-block";
import { AnfragenBlock } from "./anfragen-block";
import { Kacheln } from "./kacheln";
import { UmsatzBlock } from "./umsatz-block";
import { FIRMA_SPEICHER } from "./uebersicht-logik";

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; antwort: UebersichtAntwort };

function gemerkteFirma(): string {
  try {
    return window.localStorage.getItem(FIRMA_SPEICHER) || "alle";
  } catch {
    return "alle";
  }
}

function firmaMerken(v: string) {
  try {
    window.localStorage.setItem(FIRMA_SPEICHER, v);
  } catch {
    /* Komfort, darf fehlen */
  }
}

/**
 * /app/uebersicht (Plan 13, Entscheidung 13): Kacheln, Umsatz, Anfragen und
 * Abschlussquote je Monat. Jede Zahl aus genau einer Quelle der Antwort von
 * `GET /api/v1/uebersicht`.
 */
export function UebersichtSeite() {
  const [firma, setFirma] = useState<string | null>(null);
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const lauf = useRef(0);

  useEffect(() => setFirma(gemerkteFirma()), []);

  const laden = useCallback(async (f: string) => {
    const dieser = ++lauf.current;
    setZustand({ art: "laden" });
    const r = await apiAufruf<UebersichtAntwort>(`/api/v1/uebersicht${f !== "alle" ? `?firma=${encodeURIComponent(f)}` : ""}`);
    if (dieser !== lauf.current) return;
    if (r.ok) setZustand({ art: "fertig", antwort: r.data });
    else if (r.status === 404 && f !== "alle") {
      // Gemerkte Firma gibt es nicht mehr.
      firmaMerken("alle");
      setFirma("alle");
    } else setZustand({ art: "fehler", meldung: r.status === 403 ? "Die Übersicht sehen nur Admins." : r.message });
  }, []);

  useEffect(() => {
    if (firma !== null) void laden(firma);
  }, [firma, laden]);

  const a = zustand.art === "fertig" ? zustand.antwort : null;
  const stand = a ? new Date(a.stand).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="ueb">
      <header className="neu-kopf ueb-kopf">
        <div>
          <h1>{seitentitel("/app/uebersicht")}</h1>
          <p className="neu-kopf-zweite">{stand ? `Stand ${stand}` : "Zahlen der letzten zwölf Monate"}</p>
        </div>
        {a && a.firmen.length > 1 ? (
          <div className="ueb-firmen">
            <GlassSegmentedControl
              value={firma ?? "alle"}
              onValueChange={(v) => {
                firmaMerken(v);
                setFirma(v);
              }}
              aria-label="Firma"
            >
              <GlassSegmentedControlItem value="alle">Alle</GlassSegmentedControlItem>
              {a.firmen.map((f) => (
                <GlassSegmentedControlItem key={f.id} value={f.id}>
                  {f.name.trim().split(/\s+/)[0]}
                </GlassSegmentedControlItem>
              ))}
            </GlassSegmentedControl>
          </div>
        ) : null}
      </header>

      {zustand.art === "laden" ? (
        <div className="ueb-laden" aria-busy="true" aria-label="Übersicht wird geladen">
          <span className="lg-skeleton ueb-skelett-kacheln" />
          <span className="lg-skeleton ueb-skelett" />
        </div>
      ) : null}

      {zustand.art === "fehler" ? (
        <div className="ueb-hinweis" role="alert">
          <p>Übersicht konnte nicht geladen werden. {zustand.meldung}</p>
          <GlassButton size="sm" onClick={() => firma && void laden(firma)}>
            Erneut versuchen
          </GlassButton>
        </div>
      ) : null}

      {a ? (
        <>
          <Kacheln a={a} />
          <UmsatzBlock a={a} />
          <div className="ueb-zwei">
            <AnfragenBlock a={a} />
            <AbschlussBlock a={a} />
          </div>
          <p className="ueb-fuss">
            Pipeline, Team, Vergleich und Sichtbarkeit: <Link href="/statistics">Alte Statistik</Link>
          </p>
        </>
      ) : null}
    </div>
  );
}
