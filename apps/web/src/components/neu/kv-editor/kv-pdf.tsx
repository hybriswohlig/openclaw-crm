"use client";

import type { KvStandKopf } from "@/lib/kv-editor";
import { pdfAnsicht, verlaufZeilen } from "./kv-editor-logik";

/**
 * Mitte (Spec 10): das PDF des gezeigten Stands im `iframe`; beim Drucken ein Platzhalter,
 * bei Fehler ein roter Kasten mit „Neu drucken“ (neuer Stand). Am Handy statt `iframe`
 * eine Karte mit „PDF öffnen“ (Blättern im Vollbild des Geräts).
 */
export function KvPdf({
  stand,
  pdfUrl,
  jetzt,
  beschaeftigt,
  onNeuDrucken,
}: {
  stand: KvStandKopf;
  jetzt: Date;
  pdfUrl: string | null;
  beschaeftigt: boolean;
  onNeuDrucken: () => void;
}) {
  const a = pdfAnsicht(stand);
  if (a.art === "druckt") {
    return (
      <div className="kve-pdf kve-pdf-leer" aria-busy="true">
        <div className="kve-blatt" aria-hidden="true">
          <span className="kve-blatt-zeile" data-breit="kurz" />
          <span className="kve-blatt-zeile" />
          <span className="kve-blatt-zeile" />
          <span className="kve-blatt-zeile" data-breit="mittel" />
          <span className="kve-blatt-block" />
          <span className="kve-blatt-zeile" />
          <span className="kve-blatt-zeile" data-breit="mittel" />
        </div>
        <p className="kve-pdf-status" role="status">
          <b>Stand {stand.nummer} wird gedruckt …</b>
          <span>{a.text}</span>
        </p>
      </div>
    );
  }
  if (a.art === "fehler") {
    return (
      <div className="kve-pdf kve-pdf-leer">
        <div className="kve-fehlerkasten" role="alert">
          <b>{a.titel}</b>
          <p>{a.text}</p>
          {a.details.length > 0 ? (
            <ul>
              {a.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
          <p className="kve-klein">Dieser Stand lässt sich nicht pushen. „Neu drucken“ legt einen neuen Stand mit denselben Änderungen an.</p>
          <button type="button" className="kve-knopf" disabled={beschaeftigt} onClick={onNeuDrucken}>
            Neu drucken
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="kve-pdf">
      {pdfUrl ? (
        <iframe className="kve-iframe" src={pdfUrl} title={`KV, Stand ${stand.nummer}`} loading="lazy" />
      ) : (
        <div className="kve-pdf-ohne neu-hell-fest">
          <b>PDF-Vorschau</b>
          <span>Stand {stand.nummer} (Testdaten ohne Datei)</span>
        </div>
      )}
      <div className="kve-pdf-handy">
        <b>KV, Stand {stand.nummer}</b>
        <ul>
          {verlaufZeilen(stand, jetzt).map((z) => (
            <li key={z}>{z}</li>
          ))}
        </ul>
        {pdfUrl ? (
          <a className="kve-knopf" href={pdfUrl} target="_blank" rel="noopener noreferrer">
            PDF öffnen
          </a>
        ) : (
          <span className="kve-klein">Testdaten ohne Datei</span>
        )}
      </div>
    </div>
  );
}
