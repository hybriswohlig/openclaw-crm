"use client";

import "@/styles/neu-kunden.css";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { apiAufruf } from "@/components/neu/akte/api";
import { seitentitel } from "@/components/neu/nav-config";
import { KUNDEN_ANSICHTEN, type KundenAnsicht, type KundenListeAntwort } from "@/lib/bewertungen-kunden";
import { DealsOhneKunde } from "./deals-ohne-kunde";
import { KundenListe } from "./kunden-liste";
import { ANSICHT_LEER, ANSICHT_TITEL, apiUrl, istKundenAnsicht, kundenUrl, SUCHE_TEXT } from "./kunden-logik";
import { KundenSuche } from "./kunden-suche";

/** Verzögerung der Suche nach dem letzten Tastendruck. */
const SUCH_VERZUG_MS = 250;

type Zustand =
  | { art: "laden" }
  | { art: "fehler"; meldung: string }
  | { art: "fertig"; antwort: KundenListeAntwort; mehrLaedt: boolean };

/**
 * /app/kunden (Plan 11, Entscheidung 13): Reiter Kunden, Anfragen und Deals
 * ohne Kunde, Suche nach Name, Telefon (jede Schreibweise), E-Mail und
 * Deal-Nummer mit 250 ms Verzögerung, Ansicht und Suche in der URL,
 * „Mehr laden“ seitenweise über den Cursor der Route.
 */
export function KundenSeite() {
  const params = useSearchParams();
  const [ansicht, setAnsicht] = useState<KundenAnsicht>(() => {
    const a = params.get("ansicht");
    return istKundenAnsicht(a) ? a : "kunden";
  });
  const [eingabe, setEingabe] = useState(() => params.get("q") ?? "");
  const [q, setQ] = useState(eingabe);
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const lauf = useRef(0);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(eingabe), SUCH_VERZUG_MS);
    return () => window.clearTimeout(t);
  }, [eingabe]);

  useEffect(() => {
    const url = kundenUrl(ansicht, q);
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, "", url);
  }, [ansicht, q]);

  const laden = useCallback(async () => {
    const dieser = ++lauf.current;
    setZustand({ art: "laden" });
    const r = await apiAufruf<KundenListeAntwort>(apiUrl(ansicht, q, null));
    if (dieser !== lauf.current) return;
    setZustand(r.ok ? { art: "fertig", antwort: r.data, mehrLaedt: false } : { art: "fehler", meldung: r.message });
  }, [ansicht, q]);

  useEffect(() => {
    void laden();
  }, [laden]);

  async function mehr() {
    if (zustand.art !== "fertig" || !zustand.antwort.weiter) return;
    const dieser = lauf.current;
    const vorher = zustand.antwort;
    setZustand({ ...zustand, mehrLaedt: true });
    const r = await apiAufruf<KundenListeAntwort>(apiUrl(ansicht, q, vorher.weiter));
    if (dieser !== lauf.current) return;
    if (!r.ok) return setZustand({ art: "fertig", antwort: vorher, mehrLaedt: false });
    setZustand({
      art: "fertig",
      mehrLaedt: false,
      antwort: {
        ...r.data,
        zeilen: [...vorher.zeilen, ...r.data.zeilen],
        ohneKunde: [...vorher.ohneKunde, ...r.data.ohneKunde],
      },
    });
  }

  const a = zustand.art === "fertig" ? zustand.antwort : null;
  const anzahl = a ? (ansicht === "ohne_kunde" ? a.ohneKunde.length : a.zeilen.length) : 0;
  const sucht = q.trim().length > 0;

  return (
    <div className="kd">
      <header className="neu-kopf kd-kopf">
        <div>
          <h1>{seitentitel("/app/kunden")}</h1>
          <p className="neu-kopf-zweite">Wer bei euch gebucht hat, wer angefragt hat, und Deals ohne Person</p>
        </div>
        <div className="kd-reiter">
          <GlassSegmentedControl value={ansicht} onValueChange={(v) => istKundenAnsicht(v) && setAnsicht(v)} aria-label="Ansicht">
            {KUNDEN_ANSICHTEN.map((x) => (
              <GlassSegmentedControlItem key={x} value={x}>
                {ANSICHT_TITEL[x]}
              </GlassSegmentedControlItem>
            ))}
          </GlassSegmentedControl>
        </div>
      </header>

      <KundenSuche wert={eingabe} onAendern={setEingabe} art={a && a.suche !== "leer" ? SUCHE_TEXT[a.suche] : ""} />

      <GlassPanel variant="panel" className="kd-panel" aria-busy={zustand.art === "laden" || undefined}>
        {zustand.art === "laden" ? (
          <div className="kd-laden" aria-label="Wird geladen">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="lg-skeleton kd-skelett" />
            ))}
          </div>
        ) : null}
        {zustand.art === "fehler" ? (
          <div className="kd-hinweis" role="alert">
            <p>Kunden konnten nicht geladen werden. {zustand.meldung}</p>
            <GlassButton size="sm" onClick={() => void laden()}>
              Erneut versuchen
            </GlassButton>
          </div>
        ) : null}
        {a ? (
          anzahl === 0 ? (
            <p className="kd-leer">{sucht ? "Keine Treffer." : ANSICHT_LEER[ansicht]}</p>
          ) : ansicht === "ohne_kunde" ? (
            <DealsOhneKunde zeilen={a.ohneKunde} />
          ) : (
            <KundenListe zeilen={a.zeilen} />
          )
        ) : null}
        {a?.weiter ? (
          <div className="kd-mehr">
            <GlassButton size="sm" variant="ghost" disabled={zustand.art === "fertig" && zustand.mehrLaedt} onClick={() => void mehr()}>
              {zustand.art === "fertig" && zustand.mehrLaedt ? "Lädt …" : "Mehr laden"}
            </GlassButton>
          </div>
        ) : null}
      </GlassPanel>
    </div>
  );
}
