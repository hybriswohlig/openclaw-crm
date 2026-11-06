"use client";

import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import type { Lauf } from "./kalk-seite";

/** Link auf das PDF des KV-Dokuments (gleiche Route wie die Dokumente der Akte). */
export function kvDokumentLink(dealId: string, dokumentId: string): string {
  return `/api/v1/deals/${encodeURIComponent(dealId)}/documents/${encodeURIComponent(dokumentId)}`;
}

/**
 * Sperrbereich (Spec 3.6, Entscheidungen 3 und 6): beim sperrbaren Entwurf
 * „Version vN sperren und KV erstellen“ (blau), sonst der Sperrgrund mit
 * „Neu rechnen“ bei veraltetem Entwurf oder Rechnerfehler; bei gesperrter
 * Version „+ Neue Version“ und, bei der neuesten gesperrten ohne KV-Dokument
 * (`kvErstellbar`), „KV erstellen“, sonst der Link „KV öffnen“. „Tagespreise im Termin-Dialog“
 * kommt mit Plan 5 und bleibt deaktiviert. Alles während eines Laufs gesperrt.
 */
export function SperrenBereich({
  dealId,
  version,
  laeuft,
  onSperren,
  onKv,
  onNeueVersion,
  onNeuRechnen,
}: {
  dealId: string;
  version: KalkulationsAnsicht["version"];
  laeuft: Lauf | null;
  onSperren: () => void;
  onKv: () => void;
  onNeueVersion: () => void;
  onNeuRechnen: () => void;
}) {
  const beschaeftigt = laeuft !== null;
  const gesperrt = version.status === "gesperrt";
  const sperrt = laeuft === "sperren";
  const rechnet = laeuft === "neu_rechnen";
  // Ohne Montage-Echo hilft Neu rechnen nicht, solange der alte Rechner läuft (M9): kein Knopf.
  const neuRechnenNoetig = !gesperrt && (version.fehler !== null || (version.veraltet && version.veraltetGrund !== "rechner"));

  return (
    <div className="kalk-aktionen">
      {!gesperrt && version.sperrbar ? (
        <button type="button" className="kalk-knopf" disabled={beschaeftigt} aria-busy={sperrt || undefined} onClick={onSperren}>
          {sperrt ? "Sperrt und erstellt den KV …" : `Version v${version.nummer} sperren und KV erstellen`}
        </button>
      ) : null}

      {!gesperrt && !version.sperrbar ? (
        <>
          <p className="kalk-sperrgrund" data-ton={version.fehler ? "rose" : undefined} role="status">
            {version.sperrGrund ?? "Diese Version lässt sich gerade nicht sperren."}
          </p>
          {neuRechnenNoetig ? (
            <button type="button" className="kalk-knopf" disabled={beschaeftigt} aria-busy={rechnet || undefined} onClick={onNeuRechnen}>
              {rechnet ? "Rechnet …" : "Neu rechnen"}
            </button>
          ) : null}
        </>
      ) : null}

      {gesperrt ? (
        <>
          {version.kvDokument ? (
            <p className="kalk-kv-fertig">
              <span>KV erstellt: {version.kvDokument.fileName}</span>
              <a className="kalk-kleinknopf" href={kvDokumentLink(dealId, version.kvDokument.id)} target="_blank" rel="noreferrer">
                KV öffnen
              </a>
            </p>
          ) : null}
          <button type="button" className="kalk-knopf" disabled={beschaeftigt} aria-busy={laeuft === "neue_version" || undefined} onClick={onNeueVersion}>
            {laeuft === "neue_version" ? "Legt an …" : "+ Neue Version"}
          </button>
          {version.kvErstellbar ? (
            <button type="button" className="kalk-knopf" data-geist="" disabled={beschaeftigt} aria-busy={sperrt || undefined} onClick={onKv}>
              {sperrt ? "Erstellt den KV …" : "KV erstellen"}
            </button>
          ) : null}
        </>
      ) : null}

      <button type="button" className="kalk-knopf" data-geist="" disabled title="Kommt mit Plan 5">
        Tagespreise im Termin-Dialog
      </button>
      <p className="kalk-aktionen-hinweis">Tagespreise im Termin-Dialog: kommt mit Plan 5.</p>
    </div>
  );
}
