"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GlassInput } from "@/components/glassyui/glass-input";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import type { SearchResult } from "@/services/search";
import { apiAufruf } from "./akte/api";

/** Ab so vielen Zeichen wird gesucht; davor bleibt die Liste leer. */
const MINDESTLAENGE = 2;

/**
 * Suche auf dem Platzhalter /app/leads, bis das Board kommt (Entscheidung 1):
 * `GET /api/v1/search?q=`, nur Treffer des Objekts `deals`, Link auf die Akte.
 */
export function LeadSuche() {
  const [frage, setFrage] = useState("");
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [treffer, setTreffer] = useState<SearchResult[] | null>(null);

  useEffect(() => {
    const q = frage.trim();
    if (q.length < MINDESTLAENGE) {
      setTreffer(null);
      setFehler(null);
      setLaedt(false);
      return;
    }
    const abbruch = new AbortController();
    const timer = window.setTimeout(async () => {
      setLaedt(true);
      const r = await apiAufruf<SearchResult[]>(`/api/v1/search?q=${encodeURIComponent(q)}&limit=50`, {
        signal: abbruch.signal,
      });
      if (abbruch.signal.aborted) return;
      setLaedt(false);
      if (!r.ok) {
        setFehler(r.message);
        setTreffer(null);
        return;
      }
      setFehler(null);
      setTreffer(r.data.filter((t) => t.type === "record" && t.objectSlug === "deals"));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      abbruch.abort();
    };
  }, [frage]);

  return (
    <GlassPanel variant="panel" className="akte-suche">
      <h2 className="akte-suche-titel">Akte öffnen</h2>
      <GlassInput
        type="search"
        aria-label="Deal suchen"
        placeholder="Name, Ort oder Telefonnummer"
        autoComplete="off"
        value={frage}
        onChange={(e) => setFrage(e.target.value)}
      />
      {laedt ? <p className="akte-suche-hinweis">Sucht …</p> : null}
      {fehler ? <p className="akte-suche-hinweis">{fehler}</p> : null}
      {!laedt && !fehler && treffer && treffer.length === 0 ? (
        <p className="akte-suche-hinweis">Keine Deals gefunden.</p>
      ) : null}
      {treffer && treffer.length > 0 ? (
        <ul className="akte-suche-liste">
          {treffer.map((t) => (
            <li key={t.id}>
              <Link href={`/app/leads/${t.id}`} className="akte-suche-treffer">
                <b>{t.title}</b>
                <span>{t.subtitle}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </GlassPanel>
  );
}
