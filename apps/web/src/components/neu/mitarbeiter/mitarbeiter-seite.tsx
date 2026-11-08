"use client";

import "@/styles/neu-einsatz.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { seitentitel } from "@/components/neu/nav-config";
import { berlinDateString } from "@/lib/berlin-date";
import { ortText, tageZwischen, type EinsatzPerson, type KapazitaetTag } from "@/lib/einsatz";
import { kapazitaetLaden, personenLaden } from "./mitarbeiter-api";
import { PersonPanel } from "./person-panel";

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; personen: EinsatzPerson[] };

function plusTage(tag: string, n: number): string {
  return tageZwischen(tag, "9999-12-31", n + 1)[n]!;
}

/**
 * Seite Mitarbeiter (Plan 12a Task E): Liste aktiv oben, „Deaktiviert (N)“
 * eingeklappt; rechts das Panel der gewählten Person. Ab 12b ein zweiter
 * Reiter „Transporter“ (`reiter`).
 */
export function MitarbeiterSeite({ transporter }: { transporter?: React.ReactNode }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [gewaehlt, setGewaehlt] = useState<string | "neu" | null>(null);
  const [deaktiviertOffen, setDeaktiviertOffen] = useState(false);
  const [kapazitaet, setKapazitaet] = useState<KapazitaetTag[]>([]);
  const [reiter, setReiter] = useState<"personen" | "transporter">("personen");

  const laden = useCallback(async () => {
    const r = await personenLaden();
    setZustand(r.ok ? { art: "fertig", personen: r.data } : { art: "fehler", meldung: r.message });
  }, []);

  const kapazitaetNeu = useCallback(async () => {
    const heute = berlinDateString();
    const r = await kapazitaetLaden(heute, plusTage(heute, 13));
    if (r.ok) setKapazitaet(r.data);
  }, []);

  useEffect(() => {
    void laden();
    void kapazitaetNeu();
  }, [laden, kapazitaetNeu]);

  const personen = zustand.art === "fertig" ? zustand.personen : [];
  const aktive = useMemo(() => personen.filter((p) => p.aktiv), [personen]);
  const inaktive = useMemo(() => personen.filter((p) => !p.aktiv), [personen]);
  const person = gewaehlt && gewaehlt !== "neu" ? personen.find((p) => p.id === gewaehlt) ?? null : null;

  useEffect(() => {
    if (gewaehlt === null && aktive.length > 0 && typeof window !== "undefined" && window.innerWidth > 900) setGewaehlt(aktive[0]!.id);
  }, [aktive, gewaehlt]);

  function nachSpeichern(p: EinsatzPerson) {
    setZustand((z) =>
      z.art === "fertig"
        ? { art: "fertig", personen: [...z.personen.filter((x) => x.id !== p.id), p].sort((a, b) => a.name.localeCompare(b.name, "de")) }
        : z,
    );
    setGewaehlt(p.id);
    void kapazitaetNeu();
  }

  const zeile = (p: EinsatzPerson) => {
    const ort = ortText(p);
    const heute = kapazitaet[0];
    const lage = !heute
      ? null
      : heute.abwesend.some((a) => a.person.id === p.id)
        ? "abwesend"
        : heute.belegt.some((b) => b.person.id === p.id)
          ? "belegt"
          : heute.frei.some((f) => f.id === p.id)
            ? "frei"
            : null;
    return (
      <li key={p.id}>
        <button
          type="button"
          className="ma-zeile"
          aria-current={gewaehlt === p.id ? "true" : undefined}
          onClick={() => {
            setGewaehlt(p.id);
            requestAnimationFrame(() => document.getElementById("ma-panel")?.scrollIntoView({ block: "start", behavior: "smooth" }));
          }}
        >
          <span className="ez-avatar" aria-hidden="true">
            {p.kuerzel}
          </span>
          <span className="ma-zeile-text">
            <b>{p.name}</b>
            <small>{[ort ?? "Ort fehlt", p.kannSprinter ? "Sprinter" : null, p.eigenerPkw ? "eigener PKW" : null].filter(Boolean).join(" · ")}</small>
          </span>
          {lage && lage !== "frei" && p.aktiv ? (
            <span className="ez-lage" data-lage={lage}>
              heute {lage}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  return (
    <div className="ma-seite">
      <header className="neu-kopf">
        <h1>{seitentitel("/app/mitarbeiter")}</h1>
        <p className="neu-kopf-zweite">
          {zustand.art === "fertig" ? `${aktive.length} aktiv · Wohnort, Sprinter, Sätze und Abwesenheiten` : "Stammdaten und Abwesenheiten"}
        </p>
      </header>

      {transporter ? (
        <div className="ma-reiter" role="tablist" aria-label="Bereich">
          <button type="button" role="tab" aria-selected={reiter === "personen"} onClick={() => setReiter("personen")}>
            Personen
          </button>
          <button type="button" role="tab" aria-selected={reiter === "transporter"} onClick={() => setReiter("transporter")}>
            Transporter
          </button>
        </div>
      ) : null}

      {reiter === "transporter" && transporter ? (
        transporter
      ) : (
        <div className="ma-spalten">
          <GlassPanel variant="panel" className="ma-liste-panel">
            <div className="ma-abschnitt-kopf">
              <h2 className="ma-panel-titel">Personen</h2>
              <GlassButton type="button" size="sm" onClick={() => setGewaehlt("neu")}>
                + Person
              </GlassButton>
            </div>
            {zustand.art === "laden" ? <p className="ma-leer">Mitarbeiter werden geladen …</p> : null}
            {zustand.art === "fehler" ? <p className="ma-fehler">Mitarbeiter konnten nicht geladen werden. {zustand.meldung}</p> : null}
            {zustand.art === "fertig" && aktive.length === 0 ? <p className="ma-leer">Noch keine aktiven Mitarbeiter.</p> : null}
            <ul className="ma-liste">{aktive.map(zeile)}</ul>
            {inaktive.length > 0 ? (
              <div className="ma-deaktiviert">
                <button type="button" className="ez-link" aria-expanded={deaktiviertOffen} onClick={() => setDeaktiviertOffen((o) => !o)}>
                  Deaktiviert ({inaktive.length}) {deaktiviertOffen ? "einklappen" : "zeigen"}
                </button>
                {deaktiviertOffen ? <ul className="ma-liste">{inaktive.map(zeile)}</ul> : null}
              </div>
            ) : null}
          </GlassPanel>

          <GlassPanel variant="panel" className="ma-panel-rahmen" id="ma-panel">
            {gewaehlt === "neu" ? (
              <PersonPanel person={null} kapazitaet={kapazitaet} onGespeichert={nachSpeichern} onAbbrechen={() => setGewaehlt(aktive[0]?.id ?? null)} />
            ) : person ? (
              <PersonPanel person={person} kapazitaet={kapazitaet} onGespeichert={nachSpeichern} />
            ) : (
              <p className="ma-leer">Person in der Liste wählen.</p>
            )}
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
