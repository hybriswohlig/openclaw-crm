"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { datumKurz, uhrzeitKurz } from "@/lib/anzeige";

export type StreetViewSeite = "beladen" | "entladen";

/** Antwort von `GET …/street-view?seite=&v=` (Task 5, Bericht D). */
export interface StreetViewDaten {
  status: "ok" | "kein_bild" | "fehler" | "nicht_geladen" | "ungenau" | "keine_adresse";
  bildUrl: string | null;
  panoLink: string | null;
  notiz: { text: string; von: string; am: string } | null;
  genau: boolean;
  adresse: string | null;
}

/** Hinweistext je Status; null = Bild zeigen, leer = nichts zeigen. */
export const STREET_VIEW_HINWEISE: Record<StreetViewDaten["status"], string | null> = {
  ok: null,
  kein_bild: "Kein Street-View-Bild für diese Adresse.",
  fehler: "Street View konnte nicht geladen werden.",
  nicht_geladen: "Street View noch nicht geladen.",
  ungenau: "Adresse ungenau, kein Street View.",
  keine_adresse: "",
};

type Zustand = { art: "laden" } | { art: "hinweis"; text: string } | { art: "fertig"; daten: StreetViewDaten };

/**
 * Street View einer Adresse unter der Beladen- oder Entladen-Zeile (Spec 3.6):
 * Bild 170 px, Schild „Street View · klicken für 360°“ (Link auf `panoLink`),
 * darunter die Notiz des Inhabers mit „Notiz bearbeiten“. Je Status ein
 * Hinweistext; ohne Schlüssel antwortet der Server 503 mit seinem Text.
 * `vorschau` ersetzt den Abruf (Fixture, Tests).
 */
export function StreetViewKasten({
  dealId,
  versionNr,
  seite,
  beschaeftigt,
  vorschau,
}: {
  dealId: string;
  versionNr: number;
  seite: StreetViewSeite;
  beschaeftigt: boolean;
  vorschau?: StreetViewDaten;
}) {
  const [zustand, setZustand] = useState<Zustand>(() => (vorschau ? { art: "fertig", daten: vorschau } : { art: "laden" }));
  const [notizOffen, setNotizOffen] = useState(false);

  useEffect(() => {
    if (vorschau) return;
    let aktiv = true;
    setZustand({ art: "laden" });
    setNotizOffen(false);
    void apiAufruf<StreetViewDaten>(
      `/api/v1/deals/${encodeURIComponent(dealId)}/street-view?seite=${seite}&v=${versionNr}`
    ).then((r) => {
      if (!aktiv) return;
      if (!r.ok) {
        setZustand({ art: "hinweis", text: r.status === 503 ? r.message : `Street View: ${r.message}` });
        return;
      }
      setZustand({ art: "fertig", daten: r.data });
    });
    return () => {
      aktiv = false;
    };
  }, [dealId, versionNr, seite, vorschau]);

  if (zustand.art === "laden") {
    return (
      <div className="kalk-sv" aria-busy="true">
        <span className="lg-skeleton kalk-sv-bild" />
      </div>
    );
  }
  if (zustand.art === "hinweis") {
    return (
      <div className="kalk-sv">
        <p className="kalk-sv-hinweis">{zustand.text}</p>
      </div>
    );
  }

  const { daten } = zustand;
  const hinweis = STREET_VIEW_HINWEISE[daten.status];
  if (hinweis === "") return null;
  if (hinweis !== null || !daten.bildUrl) {
    return (
      <div className="kalk-sv">
        <p className="kalk-sv-hinweis">{hinweis ?? "Kein Street-View-Bild für diese Adresse."}</p>
      </div>
    );
  }

  const bild = (
    <>
      <img src={daten.bildUrl} alt={`Street View: ${daten.adresse ?? seite}`} loading="lazy" />
      <span className="kalk-sv-schild">{daten.panoLink ? "Street View · klicken für 360°" : "Street View"}</span>
    </>
  );

  return (
    <div className="kalk-sv">
      {daten.panoLink ? (
        <a className="kalk-sv-bild" href={daten.panoLink} target="_blank" rel="noreferrer" aria-label="Street View in 360° öffnen (Google Maps)">
          {bild}
        </a>
      ) : (
        <span className="kalk-sv-bild">{bild}</span>
      )}
      {notizOffen ? (
        <NotizForm
          dealId={dealId}
          versionNr={versionNr}
          seite={seite}
          text={daten.notiz?.text ?? ""}
          onFertig={(notiz) => {
            setZustand({ art: "fertig", daten: { ...daten, notiz } });
            setNotizOffen(false);
          }}
          onAbbrechen={() => setNotizOffen(false)}
        />
      ) : (
        <p className="kalk-sv-text">
          {daten.notiz ? (
            <span title={`${daten.notiz.von} · ${datumKurz(daten.notiz.am)} ${uhrzeitKurz(daten.notiz.am)}`}>{daten.notiz.text}</span>
          ) : (
            <span>Noch keine Notiz zu Zugang, Einfahrt und Parken.</span>
          )}
          <button type="button" className="kalk-textknopf" disabled={beschaeftigt} onClick={() => setNotizOffen(true)}>
            {daten.notiz ? "Notiz bearbeiten" : "Notiz schreiben"}
          </button>
        </p>
      )}
    </div>
  );
}

/** Notiz an der Adresse (höchstens 500 Zeichen), leer löscht sie. PUT `…/street-view/notiz`. */
function NotizForm({
  dealId,
  versionNr,
  seite,
  text,
  onFertig,
  onAbbrechen,
}: {
  dealId: string;
  versionNr: number;
  seite: StreetViewSeite;
  text: string;
  onFertig: (notiz: StreetViewDaten["notiz"]) => void;
  onAbbrechen: () => void;
}) {
  const id = useId();
  const [wert, setWert] = useState(text);
  const [speichert, setSpeichert] = useState(false);

  async function speichern(e: React.FormEvent) {
    e.preventDefault();
    if (wert.trim().length > 500) {
      toast.error("Die Notiz darf höchstens 500 Zeichen haben.");
      return;
    }
    setSpeichert(true);
    const r = await apiAufruf<{ notiz: StreetViewDaten["notiz"] }>(
      `/api/v1/deals/${encodeURIComponent(dealId)}/street-view/notiz`,
      jsonAufruf("PUT", { seite, text: wert.trim(), v: versionNr })
    );
    setSpeichert(false);
    if (!r.ok) {
      toast.error("Notiz konnte nicht gespeichert werden.", { description: r.message });
      return;
    }
    onFertig(r.data.notiz);
  }

  return (
    <form className="kalk-sv-notiz-form" onSubmit={(e) => void speichern(e)}>
      <label className="sr-only" htmlFor={id}>
        Notiz zu Zugang, Einfahrt und Parken
      </label>
      <textarea
        id={id}
        className="lg-input lg-textarea"
        rows={2}
        maxLength={500}
        value={wert}
        onChange={(e) => setWert(e.target.value)}
        placeholder="Zugang, Einfahrt, Parken, Halteverbot sinnvoll?"
        autoFocus
      />
      <div className="kalk-sv-notiz-knoepfe">
        <button type="button" className="kalk-kleinknopf" data-ton="grau" disabled={speichert} onClick={onAbbrechen}>
          Abbrechen
        </button>
        <button type="submit" className="kalk-kleinknopf" disabled={speichert} aria-busy={speichert || undefined}>
          {speichert ? "Speichert …" : "Notiz speichern"}
        </button>
      </div>
    </form>
  );
}
