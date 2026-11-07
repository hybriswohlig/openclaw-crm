"use client";

import "@/styles/neu-anrufe.css";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { jsonAufruf } from "@/components/neu/akte/api";
import { kundeLink, type AnrufDialogLage, type Karte } from "@/lib/handy-links";
import { zuordnenErgebnis, zuordnenKoerper, zuordnenTitel } from "./anruf-zuordnen-logik";

type Stand =
  | { art: "waehlen"; lage: AnrufDialogLage; hinweis: string | null }
  | { art: "senden"; lage: AnrufDialogLage }
  | { art: "fertig"; dealRecordId: string; bereitsDa: boolean };

/**
 * Dialog „Zuordnen“ auf der Seite Anrufe (Plan 10, Entscheidung 11). Die Lage
 * kommt aus der Listenzeile (`anrufDialogLage`); die Wahl trifft immer ein
 * Mensch. Ein 409 ersetzt die Lage aus `karten` und `leads` der Antwort.
 */
export function AnrufZuordnenDialog({
  callId,
  lage: start,
  namensVorschlag,
  portalZiel,
  onZugeordnet,
  onSchliessen,
}: {
  callId: string;
  lage: AnrufDialogLage;
  namensVorschlag: string | null;
  portalZiel: HTMLElement | undefined;
  /** Nach Erfolg: die Liste lädt neu. */
  onZugeordnet: () => void;
  onSchliessen: () => void;
}) {
  const id = useId();
  const [stand, setStand] = useState<Stand>({ art: "waehlen", lage: start, hinweis: null });
  const [personId, setPersonId] = useState<string | null>(null);
  /** Person aus „Welcher Kunde?“, geht bei jedem weiteren Schritt mit. */
  const [gewaehlt, setGewaehlt] = useState<Karte | null>(null);
  const [lead, setLead] = useState<string | null>(null);
  const [name, setName] = useState(namensVorschlag ?? "");
  const [fehler, setFehler] = useState<string | null>(null);

  const lage = stand.art === "fertig" ? null : stand.lage;
  const sendet = stand.art === "senden";

  async function absenden(e: FormEvent) {
    e.preventDefault();
    if (!lage) return;
    const k = zuordnenKoerper(lage, { personId, lead, name }, gewaehlt?.id || null);
    if (!k.ok) {
      setFehler(k.text);
      return;
    }
    setFehler(null);
    const person =
      gewaehlt ??
      (lage.art === "person_waehlen" ? (lage.treffer.find((t) => t.id === personId) ?? null) : "person" in lage ? lage.person : null);
    if (lage.art === "person_waehlen" && person) setGewaehlt(person);
    setStand({ art: "senden", lage });

    let status = 0;
    let body: unknown = null;
    try {
      const res = await fetch(`/api/v1/phone-calls/${encodeURIComponent(callId)}/lead`, jsonAufruf("POST", k.koerper));
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
    }
    const r = zuordnenErgebnis(status, body, person);
    if (r.art === "fertig") {
      setStand({ art: "fertig", dealRecordId: r.dealRecordId, bereitsDa: r.bereitsDa });
      onZugeordnet();
      return;
    }
    if (r.art === "konflikt" && r.lage) {
      setLead(null);
      setStand({ art: "waehlen", lage: r.lage, hinweis: r.text });
      return;
    }
    setFehler(r.text);
    setStand({ art: "waehlen", lage, hinweis: null });
  }

  const kopf = lage ? zuordnenTitel(lage) : { titel: "Zugeordnet", text: "" };

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !sendet && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="anrufe-zuordnen">
        <GlassDialogTitle className="akte-dialog-titel">{kopf.titel}</GlassDialogTitle>

        {stand.art === "fertig" ? (
          <>
            <GlassDialogDescription className="akte-dialog-text">
              {stand.bereitsDa ? "Der Anruf hing schon an einem Lead." : "Der Anruf ist jetzt dem Lead zugeordnet."}
            </GlassDialogDescription>
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={onSchliessen}>
                Schließen
              </GlassButton>
              <GlassButton asChild>
                <Link href={`/app/leads/${encodeURIComponent(stand.dealRecordId)}`}>Akte öffnen</Link>
              </GlassButton>
            </div>
          </>
        ) : lage ? (
          <form onSubmit={(e) => void absenden(e)}>
            <GlassDialogDescription className="akte-dialog-text">{kopf.text}</GlassDialogDescription>
            {stand.art === "waehlen" && stand.hinweis ? <p className="anrufe-zuordnen-hinweis">{stand.hinweis}</p> : null}

            {lage.art === "person_waehlen" ? (
              <fieldset className="anrufe-wahl" disabled={sendet}>
                <legend className="sr-only">Kunde</legend>
                {lage.treffer.map((t) => (
                  <div key={t.id} className="anrufe-wahl-zeile">
                    <label>
                      <input type="radio" name={`${id}-person`} value={t.id} checked={personId === t.id} onChange={() => setPersonId(t.id)} />
                      <span>{t.name}</span>
                    </label>
                    <Link href={kundeLink(t.id)} target="_blank" rel="noopener">
                      ansehen
                    </Link>
                  </div>
                ))}
              </fieldset>
            ) : null}

            {lage.art === "lead_waehlen" ? (
              <fieldset className="anrufe-wahl" disabled={sendet}>
                <legend className="sr-only">Lead</legend>
                {lage.leads.map((l) => (
                  <div key={l.id} className="anrufe-wahl-zeile">
                    <label>
                      <input type="radio" name={`${id}-lead`} value={l.id} checked={lead === l.id} onChange={() => setLead(l.id)} />
                      <span>{l.name}</span>
                    </label>
                    <Link href={`/app/leads/${encodeURIComponent(l.id)}`} target="_blank" rel="noopener">
                      ansehen
                    </Link>
                  </div>
                ))}
                <div className="anrufe-wahl-zeile">
                  <label>
                    <input type="radio" name={`${id}-lead`} value="neu" checked={lead === "neu"} onChange={() => setLead("neu")} />
                    <span>Neuer Lead</span>
                  </label>
                </div>
              </fieldset>
            ) : null}

            {lage.art === "neuer_lead" && !lage.person && !gewaehlt ? (
              <label className="akte-dialog-feld">
                Name des Anrufers
                <input
                  className="lg-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  autoComplete="off"
                  disabled={sendet}
                  required
                />
              </label>
            ) : null}

            {fehler ? (
              <p className="akte-dialog-fehler" role="alert">
                {fehler}
              </p>
            ) : null}
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={onSchliessen} disabled={sendet}>
                Abbrechen
              </GlassButton>
              <GlassButton type="submit" disabled={sendet}>
                {sendet ? "Ordnet zu" : lage.art === "person_waehlen" ? "Weiter" : lage.art === "neuer_lead" ? "Lead anlegen" : "Zuordnen"}
              </GlassButton>
            </div>
          </form>
        ) : null}
      </GlassDialogContent>
    </GlassDialog>
  );
}
