"use client";

import "@/styles/neu-anrufe.css";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { apiAufruf } from "@/components/neu/akte/api";
import { anrufDauerText, anruferText, hatTranskript, telefonAnzeige, type AnrufAntwort } from "@/lib/anrufe";
import { tagKurz, uhrzeitKurz } from "@/lib/anzeige";

/**
 * Was der Dialog schon vor dem Laden weiß (aus der Akte oder der Liste), damit
 * Kopf und Zusammenfassung sofort stehen. Das Transkript kommt erst über
 * `GET /api/v1/phone-calls/[callId]`.
 */
export interface TranskriptVorschau {
  id: string;
  /** ISO-Zeit des Anrufbeginns. */
  zeit: string;
  leitung: string | null;
  angenommenVon: string | null;
  dauerSek: number | null;
  /** Name des Anrufers, wenn bekannt (Liste), sonst null. */
  anruferName: string | null;
  /** Nummer des Anrufers: E.164 oder roh. */
  nummer: string | null;
  zusammenfassung: string | null;
  stichworte: string[];
  dealRecordId: string | null;
}

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; anruf: AnrufAntwort };

/**
 * Der Transkript-Dialog eines Anrufs (Akte und /app/anrufe): Kopfdaten
 * (Leitung, Anrufer, angenommen von, Dauer, Zeit), Zusammenfassung,
 * Stichworte und das Transkript vorformatiert und scrollbar. `akteLink`
 * zeigt „Akte öffnen“, wenn der Anruf an einem Lead hängt; in der Akte selbst
 * bleibt er aus.
 */
export function TranskriptDialog({
  anruf,
  portalZiel,
  akteLink = true,
  onSchliessen,
}: {
  anruf: TranskriptVorschau;
  portalZiel: HTMLElement | undefined;
  akteLink?: boolean;
  onSchliessen: () => void;
}) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [lauf, setLauf] = useState(0);

  useEffect(() => {
    const abbruch = new AbortController();
    setZustand({ art: "laden" });
    void apiAufruf<AnrufAntwort>(`/api/v1/phone-calls/${encodeURIComponent(anruf.id)}`, { signal: abbruch.signal }).then((r) => {
      if (abbruch.signal.aborted) return;
      setZustand(r.ok ? { art: "fertig", anruf: r.data } : { art: "fehler", meldung: r.message });
    });
    return () => abbruch.abort();
  }, [anruf.id, lauf]);

  const geladen = zustand.art === "fertig" ? zustand.anruf : null;
  const leitung = geladen?.lineLabel ?? anruf.leitung;
  const angenommenVon = geladen?.answeredBy ?? anruf.angenommenVon;
  const dauer = anrufDauerText(geladen?.durationSeconds ?? anruf.dauerSek);
  const zeit = geladen?.startedAt ?? anruf.zeit;
  const nummer = telefonAnzeige(geladen?.callerE164 ?? geladen?.callerRaw ?? anruf.nummer);
  const anruferName = geladen?.personName ?? anruf.anruferName;
  const anrufer = anruferText({
    name: anruferName,
    callerE164: geladen?.callerE164 ?? null,
    callerRaw: geladen?.callerRaw ?? anruf.nummer,
  });
  const zusammenfassung = geladen?.summary ?? anruf.zusammenfassung;
  const stichworte = geladen?.keywords ?? anruf.stichworte;
  const dealRecordId = geladen?.dealRecordId ?? anruf.dealRecordId;

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="anrufe-dialog">
        <GlassDialogTitle className="akte-dialog-titel">{leitung ? `Anruf · ${leitung}` : "Anruf"}</GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {[tagKurz(zeit), uhrzeitKurz(zeit), dauer].filter(Boolean).join(" · ")}
        </GlassDialogDescription>

        <dl className="anrufe-dialog-kopf">
          <div>
            <dt>Leitung</dt>
            <dd>{leitung ?? "keine Angabe"}</dd>
          </div>
          <div>
            <dt>Anrufer</dt>
            <dd>
              {anrufer}
              {anruferName && nummer && nummer !== anrufer ? <small>{nummer}</small> : null}
            </dd>
          </div>
          <div>
            <dt>Angenommen von</dt>
            <dd>{angenommenVon ?? "keine Angabe"}</dd>
          </div>
          <div>
            <dt>Dauer</dt>
            <dd>{dauer ?? "keine Angabe"}</dd>
          </div>
          <div>
            <dt>Zeit</dt>
            <dd>
              {tagKurz(zeit)} {uhrzeitKurz(zeit)}
            </dd>
          </div>
        </dl>

        {zusammenfassung ? (
          <section className="anrufe-dialog-abschnitt" aria-label="Zusammenfassung">
            <h3>Zusammenfassung</h3>
            <p className="anrufe-dialog-text">{zusammenfassung}</p>
          </section>
        ) : null}

        {stichworte.length > 0 ? (
          <section className="anrufe-dialog-abschnitt" aria-label="Stichworte">
            <h3>Stichworte</h3>
            <ul className="anrufe-stichworte">
              {stichworte.map((s, i) => (
                <li key={`${s}-${i}`}>{s}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="anrufe-dialog-abschnitt" aria-label="Transkript">
          <h3>Transkript</h3>
          {zustand.art === "laden" ? <p className="anrufe-dialog-hinweis">Transkript wird geladen …</p> : null}
          {zustand.art === "fehler" ? (
            <p className="anrufe-dialog-hinweis" role="alert">
              {zustand.meldung}{" "}
              <button type="button" className="anrufe-dialog-link" onClick={() => setLauf((n) => n + 1)}>
                Erneut laden
              </button>
            </p>
          ) : null}
          {geladen ? (
            hatTranskript(geladen.transcript) ? (
              <pre className="anrufe-transkript" tabIndex={0}>
                {geladen.transcript}
              </pre>
            ) : (
              <p className="anrufe-dialog-hinweis">Zu diesem Anruf gibt es kein Transkript.</p>
            )
          ) : null}
        </section>

        <div className="akte-dialog-knoepfe">
          {akteLink && dealRecordId ? (
            <GlassButton asChild variant="ghost">
              <Link href={`/app/leads/${dealRecordId}`}>Akte öffnen</Link>
            </GlassButton>
          ) : null}
          <GlassButton type="button" onClick={onSchliessen}>
            Schließen
          </GlassButton>
        </div>
      </GlassDialogContent>
    </GlassDialog>
  );
}
