"use client";

import "@/styles/neu-anrufe.css";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { apiAufruf } from "@/components/neu/akte/api";
import { seitentitel } from "@/components/neu/nav-config";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import {
  anrufDauerText,
  anruferText,
  hatTranskript,
  leitungen,
  nachTagen,
  zuordnungText,
  type AnrufAntwort,
} from "@/lib/anrufe";
import { uhrzeitKurz } from "@/lib/anzeige";
import { TranskriptDialog, type TranskriptVorschau } from "./transkript-dialog";

/** So viele Anrufe höchstens; mehr gibt die Liste nicht her. */
const ANZAHL = 50;

interface Karte {
  id: string;
  name: string;
}

/** Eine Zeile von `GET /api/v1/phone-calls`: der Anruf plus die Hinweise zur Zuordnung. */
interface AnrufEintrag extends AnrufAntwort {
  karten: Karte[];
  bestehendePerson: Karte | null;
  offeneLeads: Karte[];
}

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; anrufe: AnrufEintrag[] };

function alsKarten(wert: unknown): Karte[] {
  if (!Array.isArray(wert)) return [];
  return wert.filter((k): k is Karte => !!k && typeof k === "object" && typeof (k as Karte).id === "string" && typeof (k as Karte).name === "string");
}

/**
 * Name des Anrufers, wenn das CRM die Nummer kennt: die angehängte Person,
 * sonst die Person zur Nummer; bei mehreren Karten keiner (die Nummer bleibt).
 */
function anruferName(a: AnrufEintrag): string | null {
  if (a.personName) return a.personName;
  if (a.bestehendePerson?.name) return a.bestehendePerson.name;
  return a.karten.length === 1 ? (a.karten[0]!.name ?? null) : null;
}

function vorschauAus(a: AnrufEintrag): TranskriptVorschau {
  return {
    id: a.id,
    zeit: a.startedAt,
    leitung: a.lineLabel,
    angenommenVon: a.answeredBy,
    dauerSek: a.durationSeconds,
    anruferName: anruferName(a),
    nummer: a.callerE164 ?? a.callerRaw,
    zusammenfassung: a.summary,
    stichworte: a.keywords,
    dealRecordId: a.dealRecordId,
  };
}

/**
 * /app/anrufe: die letzten 50 Telefonate nach Tag, je Zeile Uhrzeit, Anrufer,
 * Leitung, Dauer, angenommen von und Zusammenfassung. Klick öffnet den
 * Transkript-Dialog. Mit Lead ein Link zur Akte; ohne Lead der Hinweis und
 * der Weg in die alte Oberfläche, wo die Zuordnung noch liegt. Filter nach
 * Leitung aus den vorhandenen Werten.
 */
export function AnrufeSeite() {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [leitung, setLeitung] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AnrufEintrag | null>(null);
  const portalZiel = usePortalZiel();

  const laden = useCallback(async (signal?: AbortSignal) => {
    setZustand({ art: "laden" });
    const r = await apiAufruf<AnrufEintrag[]>(`/api/v1/phone-calls?limit=${ANZAHL}`, { signal });
    if (signal?.aborted) return;
    if (!r.ok) {
      setZustand({ art: "fehler", meldung: r.message });
      return;
    }
    const anrufe = (Array.isArray(r.data) ? r.data : []).map((z) => ({
      ...z,
      keywords: Array.isArray(z.keywords) ? z.keywords : [],
      karten: alsKarten(z.karten),
      bestehendePerson: z.bestehendePerson && typeof z.bestehendePerson.id === "string" ? z.bestehendePerson : null,
      offeneLeads: alsKarten(z.offeneLeads),
    }));
    setZustand({ art: "fertig", anrufe });
  }, []);

  useEffect(() => {
    const abbruch = new AbortController();
    void laden(abbruch.signal);
    return () => abbruch.abort();
  }, [laden]);

  const alle = zustand.art === "fertig" ? zustand.anrufe : [];
  const linien = useMemo(() => leitungen(alle), [alle]);
  const gefiltert = useMemo(() => (leitung ? alle.filter((a) => a.lineLabel?.trim() === leitung) : alle), [alle, leitung]);
  const tage = useMemo(() => nachTagen(gefiltert, new Date()), [gefiltert]);

  const zweite =
    zustand.art === "fertig"
      ? alle.length === 0
        ? "Noch keine Telefonate"
        : alle.length === 1
          ? "Das letzte Telefonat"
          : `Die letzten ${alle.length} Telefonate`
      : "Telefonate mit Transkript";

  return (
    <div className="anrufe">
      <header className="neu-kopf">
        <h1>{seitentitel("/app/anrufe")}</h1>
        <p className="neu-kopf-zweite">{zweite}</p>
        {linien.length > 1 ? (
          <ul className="anrufe-filter" aria-label="Nach Leitung filtern">
            <li>
              <button type="button" aria-pressed={leitung === null} onClick={() => setLeitung(null)}>
                Alle
              </button>
            </li>
            {linien.map((l) => (
              <li key={l}>
                <button type="button" aria-pressed={leitung === l} onClick={() => setLeitung(leitung === l ? null : l)}>
                  {l}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <GlassPanel variant="panel" className="anrufe-panel" elevation="raised">
        {zustand.art === "laden" ? <p className="anrufe-leer">Anrufe werden geladen …</p> : null}
        {zustand.art === "fehler" ? (
          <div role="alert">
            <p className="anrufe-leer">Anrufe konnten nicht geladen werden. {zustand.meldung}</p>
            <div className="akte-dialog-knoepfe" style={{ justifyContent: "flex-start", marginTop: 12 }}>
              <GlassButton onClick={() => void laden()}>Erneut laden</GlassButton>
            </div>
          </div>
        ) : null}
        {zustand.art === "fertig" && alle.length === 0 ? <p className="anrufe-leer">Noch keine Anrufe.</p> : null}
        {zustand.art === "fertig" && alle.length > 0 && gefiltert.length === 0 ? (
          <p className="anrufe-leer">Keine Anrufe über diese Leitung.</p>
        ) : null}

        {tage.map((t) => (
          <section key={t.tag} className="anrufe-tag" aria-label={t.titel}>
            <h2 className="anrufe-tag-titel">{t.titel}</h2>
            <ul className="anrufe-liste">
              {t.anrufe.map((a) => (
                <AnrufZeile key={a.id} a={a} onOeffnen={() => setDialog(a)} />
              ))}
            </ul>
          </section>
        ))}
      </GlassPanel>

      {dialog ? <TranskriptDialog anruf={vorschauAus(dialog)} portalZiel={portalZiel} onSchliessen={() => setDialog(null)} /> : null}
    </div>
  );
}

function AnrufZeile({ a, onOeffnen }: { a: AnrufEintrag; onOeffnen: () => void }) {
  const dauer = anrufDauerText(a.durationSeconds);
  const zuordnung = zuordnungText(a);
  const anrufer = anruferText({ name: anruferName(a), callerE164: a.callerE164, callerRaw: a.callerRaw });
  return (
    <li className="anrufe-zeile">
      <time className="anrufe-zeit" dateTime={a.startedAt}>
        {uhrzeitKurz(a.startedAt)}
      </time>
      <button type="button" className="anrufe-knopf" onClick={onOeffnen} aria-label={`Anruf von ${anrufer} öffnen`}>
        <span className="anrufe-kopfzeile">
          <b>{anrufer}</b>
          {a.lineLabel ? (
            <span className="anrufe-leitung">
              <i aria-hidden="true" />
              {a.lineLabel}
            </span>
          ) : null}
          {dauer ? <span>{dauer}</span> : null}
          {a.answeredBy ? <span>angenommen von {a.answeredBy}</span> : null}
          {hatTranskript(a.transcript) ? <span className="anrufe-transkript-marke">Transkript</span> : null}
        </span>
        {a.summary ? <span className="anrufe-zusammenfassung">{a.summary}</span> : null}
      </button>
      <div className="anrufe-zuordnung">
        {a.dealRecordId ? (
          <Link href={`/app/leads/${a.dealRecordId}`}>Akte öffnen</Link>
        ) : (
          <>
            <span className="anrufe-zuordnung-hinweis">{zuordnung}</span>
            <Link href="/anrufe">In der alten Oberfläche zuordnen</Link>
          </>
        )}
      </div>
    </li>
  );
}
