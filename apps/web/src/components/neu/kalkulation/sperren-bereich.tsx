"use client";

import Link from "next/link";
import { KvDanachKnoepfe } from "@/components/neu/kv-danach/kv-danach-knoepfe";
import { angabenLink } from "@/lib/dokument-angaben";
import type { KalkulationsAnsicht } from "@/lib/kalkulations-ansicht";
import type { Lauf } from "./kalk-seite";
import { kvKnopf, kvStatus } from "./kv-erzeugung";

/** Link auf das PDF des KV-Dokuments (gleiche Route wie die Dokumente der Akte). */
export function kvDokumentLink(dealId: string, dokumentId: string): string {
  return `/api/v1/deals/${encodeURIComponent(dealId)}/documents/${encodeURIComponent(dokumentId)}`;
}

/**
 * Sperrbereich (Spec 3.6, Entscheidungen 3 und 6): beim sperrbaren Entwurf
 * „Version vN sperren und KV erstellen“ (blau), sonst der Sperrgrund mit
 * „Neu rechnen“ bei veraltetem Entwurf oder Rechnerfehler; bei gesperrter
 * Version „+ Neue Version“ und, bei der neuesten gesperrten ohne KV-Dokument
 * (`kvErstellbar`), „KV erstellen“, sonst der Link „KV öffnen“. „Tagespreise im
 * Termin-Dialog“ ist aktiv, wenn die Firma den Schalter „Tagespreise“ hat
 * (Plan 5b, Entscheidung 15), sonst deaktiviert mit Hinweis. Die Sperrgründe
 * kommen unverändert vom Dienst. Alles während eines Laufs gesperrt.
 * Plan 5a (Entscheidung 8): bei Kottke der Zustand des VPS-KV (läuft, fertig,
 * verworfen, Fehler); solange er läuft, kein zweites „KV erstellen“.
 */
export function SperrenBereich({
  dealId,
  version,
  laeuft,
  onSperren,
  onKv,
  onNeueVersion,
  onNeuRechnen,
  tagespreise = { aktiv: false, hinweis: "Tagespreise sind für diese Firma aus." },
  onTagespreise,
  onAngebotAendern,
  jetzt = new Date(),
}: {
  dealId: string;
  version: KalkulationsAnsicht["version"];
  laeuft: Lauf | null;
  onSperren: () => void;
  onKv: () => void;
  onNeueVersion: () => void;
  onNeuRechnen: () => void;
  /** Plan 5b: Zustand des Knopfs aus `tagespreiseKnopf`. */
  tagespreise?: { aktiv: boolean; hinweis: string | null };
  onTagespreise?: () => void;
  /** Plan 16: an der maßgeblichen gesperrten Version „Angebot ändern“ (Entwurf + Vorschlagsliste). */
  onAngebotAendern?: () => void;
  jetzt?: Date;
}) {
  const beschaeftigt = laeuft !== null;
  const gesperrt = version.status === "gesperrt";
  const sperrt = laeuft === "sperren";
  const rechnet = laeuft === "neu_rechnen";
  // Ohne Montage-Echo hilft Neu rechnen nicht, solange der alte Rechner läuft (M9): kein Knopf.
  const neuRechnenNoetig = !gesperrt && (version.fehler !== null || (version.veraltet && version.veraltetGrund !== "rechner"));
  const status = kvStatus(version, jetzt);
  const knopf = kvKnopf(version, jetzt);

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
          {status ? (
            <p className="kalk-kv-fertig" data-ton={status.ton} role="status" aria-live="polite">
              <span>{status.text}</span>
              {status.dokumentId ? (
                <a className="kalk-kleinknopf" href={kvDokumentLink(dealId, status.dokumentId)} target="_blank" rel="noreferrer">
                  KV öffnen
                </a>
              ) : null}
              {/* Nächster Schritt zum Kunden (kv-danach): Link kopieren oder im Chat vorbereiten. */}
              {status.dokumentId ? <KvDanachKnoepfe dealId={dealId} klasse="kalk-kleinknopf" gruppeKlasse="kalk-kv-danach" /> : null}
              {status.angabenFehlen ? (
                <Link className="kalk-kleinknopf" href={angabenLink(dealId)}>
                  Angaben ergänzen
                </Link>
              ) : null}
            </p>
          ) : null}
          {onAngebotAendern ? (
            <button type="button" className="kalk-knopf" disabled={beschaeftigt} aria-busy={laeuft === "neue_version" || undefined} onClick={onAngebotAendern}>
              {laeuft === "neue_version" ? "Legt an …" : "Angebot ändern"}
            </button>
          ) : (
            <button type="button" className="kalk-knopf" disabled={beschaeftigt} aria-busy={laeuft === "neue_version" || undefined} onClick={onNeueVersion}>
              {laeuft === "neue_version" ? "Legt an …" : "+ Neue Version"}
            </button>
          )}
          {knopf ? (
            <button type="button" className="kalk-knopf" data-geist="" disabled={beschaeftigt} aria-busy={sperrt || undefined} onClick={onKv}>
              {sperrt ? "Erstellt den KV …" : knopf}
            </button>
          ) : null}
        </>
      ) : null}

      <button
        type="button"
        className="kalk-knopf"
        data-geist=""
        disabled={!tagespreise.aktiv || !onTagespreise || beschaeftigt}
        onClick={onTagespreise}
      >
        Tagespreise im Termin-Dialog
      </button>
      {tagespreise.hinweis ? <p className="kalk-aktionen-hinweis">{tagespreise.hinweis}</p> : null}
    </div>
  );
}
