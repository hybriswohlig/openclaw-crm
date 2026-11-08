"use client";

import "@/styles/neu-kunden.css";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { apiAufruf } from "@/components/neu/akte/api";
import type { KundenAkte } from "@/lib/bewertungen-kunden";
import { KONTAKTART_LABELS } from "@/lib/kontaktart";
import { FirmenChips } from "./firmen-chips";
import { KundenakteGespraeche } from "./kundenakte-gespraeche";
import { KundenakteUmzuege } from "./kundenakte-umzuege";
import { euro } from "./kunden-logik";

type Zustand = { art: "laden" } | { art: "fehlt" } | { art: "fehler"; meldung: string } | { art: "fertig"; akte: KundenAkte };

/**
 * Kundenakte /app/kunden/[id] (Plan 11, Entscheidung 14): Kopf mit Kontakt,
 * Firmen und Merkmalen, offener Rest gesamt, alle Umzüge, Gespräche je Firma,
 * Hinweis auf mögliche Dubletten (nur Link, kein Zusammenführen).
 */
export function Kundenakte({ personId }: { personId: string }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });

  const laden = useCallback(async () => {
    setZustand({ art: "laden" });
    const r = await apiAufruf<KundenAkte>(`/api/v1/kunden/${encodeURIComponent(personId)}`);
    if (r.ok) setZustand({ art: "fertig", akte: r.data });
    else if (r.status === 404) setZustand({ art: "fehlt" });
    else setZustand({ art: "fehler", meldung: r.message });
  }, [personId]);

  useEffect(() => {
    void laden();
  }, [laden]);

  if (zustand.art === "laden") {
    return (
      <div className="kd" aria-busy="true" aria-label="Kundenakte wird geladen">
        <span className="lg-skeleton kd-skelett-kopf" />
        <span className="lg-skeleton kd-skelett-gross" />
      </div>
    );
  }
  if (zustand.art === "fehlt" || zustand.art === "fehler") {
    return (
      <GlassPanel variant="panel" className="kd-panel kd-hinweis" role="alert">
        <p>
          {zustand.art === "fehlt"
            ? "Diesen Kunden gibt es nicht (mehr). Vielleicht wurde er mit einer anderen Person zusammengeführt."
            : `Kundenakte konnte nicht geladen werden. ${zustand.meldung}`}
        </p>
        {zustand.art === "fehler" ? (
          <GlassButton size="sm" onClick={() => void laden()}>
            Erneut versuchen
          </GlassButton>
        ) : (
          <Link href="/app/kunden">Zur Kundenliste</Link>
        )}
      </GlassPanel>
    );
  }

  const k = zustand.akte;
  const merkmale = [
    k.kontaktart ? KONTAKTART_LABELS[k.kontaktart] : null,
    k.art === "kunde" ? "Kunde" : k.art === "anfrage" ? "Anfrage" : null,
    k.wiederkehrer ? "Wiederkehrer" : null,
    k.mehrfachFirma ? "bei beiden Firmen" : null,
  ].filter((x): x is string => !!x);

  return (
    <div className="kd kd-akte">
      <header className="neu-kopf kd-kopf">
        <div>
          <h1>{k.name}</h1>
          <p className="neu-kopf-zweite kd-akte-kontakt">
            {[...k.telefone, ...k.emails].join(" · ") || "Keine Telefonnummer oder E-Mail"}
          </p>
          <div className="kd-akte-merkmale">
            <FirmenChips firmen={k.firmen} />
            {merkmale.map((m) => (
              <span key={m} className="kd-merkmal">
                {m}
              </span>
            ))}
            {k.bewertungGesperrt ? (
              <span className="kd-merkmal" data-ton="rose">
                keine Bewertungsanfragen
              </span>
            ) : null}
          </div>
        </div>
        <div className="kd-akte-offen" data-offen={k.offenCent != null && k.offenCent > 0 ? true : undefined}>
          <span>Offen gesamt</span>
          <b>{k.offenCent == null ? "unbekannt" : euro(k.offenCent)}</b>
        </div>
      </header>

      {k.dubletten.length > 0 ? (
        <div className="kd-dublette" role="note">
          Mögliche Dublette:{" "}
          {k.dubletten.map((d, i) => (
            <span key={d.personId}>
              {i > 0 ? ", " : ""}
              <Link href={`/app/kunden/${d.personId}`}>{d.name}</Link>
              {d.grund === "vorschlag" ? " (Vorschlag aus dem Abgleich)" : " (gleicher Name)"}
            </span>
          ))}
          . Zusammenführen geht noch nicht in der neuen Oberfläche.
        </div>
      ) : null}

      <div className="kd-akte-raster">
        <GlassPanel variant="panel" className="kd-panel" aria-labelledby="kd-umzuege">
          <h2 id="kd-umzuege" className="kd-panel-titel">
            Aufträge
          </h2>
          <KundenakteUmzuege umzuege={k.umzuege} />
        </GlassPanel>
        <GlassPanel variant="panel" className="kd-panel" aria-labelledby="kd-gespraeche">
          <h2 id="kd-gespraeche" className="kd-panel-titel">
            Gespräche
          </h2>
          <KundenakteGespraeche gruppen={k.gespraeche} />
        </GlassPanel>
      </div>
    </div>
  );
}
