"use client";

import "@/styles/neu-kv-danach.css";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import type { KalkKontext } from "@/components/neu/kalkulation/kalk-seite";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import { paketeZeile } from "@/lib/kv-danach";

/**
 * Klare Zeile im KV-Fenster (Auftrag kv-danach): „Pakete: werden angeboten
 * (Basis, Komfort, Premium)“ oder „Pakete: nicht angeboten“ mit Grund, dazu
 * der Schalter „Pakete anbieten“ für diesen Deal (Plan 15, `pakete_anbieten`),
 * soweit die Firma es erlaubt, sonst der Link in die Einstellungen. Darunter
 * die Tagespreise als Hinweis. Umschalten rechnet den Entwurf neu wie der
 * Schalter in der Marge-Spalte; an einer gesperrten Version nur der Hinweis,
 * dass es dafür eine neue Version braucht.
 */
export function PaketeZeileKasten({
  ansicht,
  kontext,
  gesperrt,
}: {
  ansicht: KalkulationsAnsicht;
  kontext: KalkKontext;
  /** Überschreibt den Stand der Ansicht, etwa direkt nach dem Sperren (Kottke-Dialog). */
  gesperrt?: boolean;
}) {
  const id = useId();
  const [laeuft, setLaeuft] = useState(false);
  /** Einschalten fragt nach wie der Schalter in der Marge-Spalte: der Kunde sieht danach Paketkarten. */
  const [frage, setFrage] = useState(false);
  /** Zahl der Paketoptionen des Deals (Review I2); null solange unbekannt. */
  const [optionen, setOptionen] = useState<number | null>(null);
  useEffect(() => {
    let aktiv = true;
    void apiAufruf<{ options?: unknown[] } | null>(`/api/v1/deals/${encodeURIComponent(kontext.dealId)}/package-options`).then((r) => {
      if (aktiv && r.ok) setOptionen(r.data?.options?.length ?? 0);
    });
    return () => {
      aktiv = false;
    };
  }, [kontext.dealId]);
  const z = paketeZeile({
    optionen,
    schalter: ansicht.paketSchalter,
    tagespreise: ansicht.schalter.tagespreise,
    preisModus: ansicht.version.preisModus,
    pakete: ansicht.pakete,
    tage: ansicht.tage.length,
    gesperrt: gesperrt ?? ansicht.version.status === "gesperrt",
  });

  async function umschalten() {
    if (!z.schalter || laeuft) return;
    setFrage(false);
    setLaeuft(true);
    const r = await apiAufruf<unknown>(
      `/api/v1/deals/${encodeURIComponent(kontext.dealId)}/calculation/pakete`,
      jsonAufruf("PUT", { wert: z.schalter.wert })
    );
    setLaeuft(false);
    if (!r.ok) {
      toast.error("Pakete konnten nicht umgestellt werden.", { description: r.message });
      return;
    }
    toast.success(z.schalter.an ? "Pakete für diesen Deal aus." : "Pakete für diesen Deal an.", {
      description: kontext.bearbeitbar ? "Der Entwurf rechnet neu." : "Gilt ab dem nächsten Entwurf.",
    });
    if (kontext.bearbeitbar) await kontext.neuRechnen();
    else await kontext.neuLaden();
  }

  const beschaeftigt = laeuft || kontext.laeuft !== null;
  return (
    <div className="kv-pakete" role="group" aria-labelledby={`${id}-text`}>
      <div className="kv-pakete-kopf">
        <span id={`${id}-text`} className="kv-pakete-text" data-an={z.angeboten || undefined}>
          {z.text}
        </span>
        {z.schalter ? (
          <label className="kv-pakete-schalter">
            <input
              type="checkbox"
              checked={z.schalter.an}
              disabled={beschaeftigt || frage}
              onChange={() => (z.schalter?.an ? void umschalten() : setFrage(true))}
            />
            {beschaeftigt && laeuft ? "Schaltet …" : "Pakete für diesen Deal anbieten"}
          </label>
        ) : null}
      </div>
      {frage ? (
        <div className="kv-pakete-frage" role="alert">
          <p className="kv-pakete-grund">Der Kunde sieht danach Paketkarten (Basis, Komfort, Premium) im Portal. Die Kalkulation rechnet je Paket einen Preis.</p>
          <span className="kv-pakete-frage-knoepfe">
            <button type="button" className="kalk-kleinknopf" data-ton="grau" onClick={() => setFrage(false)}>
              Abbrechen
            </button>
            <button type="button" className="kalk-kleinknopf" onClick={() => void umschalten()}>
              Ja, Pakete anbieten
            </button>
          </span>
        </div>
      ) : null}
      {z.grund ? <p className="kv-pakete-grund">{z.grund}</p> : null}
      {z.einstellungen ? (
        <p className="kv-pakete-hinweis">
          <a href={z.einstellungen.href}>{z.einstellungen.text}</a>
        </p>
      ) : null}
      {z.gesperrtHinweis ? <p className="kv-pakete-hinweis">{z.gesperrtHinweis}</p> : null}
      <p className="kv-pakete-hinweis">{z.tagespreise}</p>
    </div>
  );
}
