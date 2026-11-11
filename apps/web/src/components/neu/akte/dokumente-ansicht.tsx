"use client";

import { useEffect, useState } from "react";
import { tagKurz } from "@/lib/anzeige";
import { apiAufruf } from "./api";

interface Dokument {
  id: string;
  documentType: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  /** Plan 16: Version des KV, null ohne Version. */
  kvVersion?: number | null;
}

/**
 * Plan 16: ein KV ist „ersetzt“, wenn es einen neueren KV gibt oder seine Version älter ist
 * als die maßgebliche (`aktuell`, etwa gesperrt, aber noch ohne neues PDF).
 */
export function kvErsetzt(d: Pick<Dokument, "id" | "documentType" | "kvVersion">, neuesterKvId: string | null, aktuell: number | null): boolean {
  if (d.documentType !== "quotation") return false;
  if (neuesterKvId !== null && d.id !== neuesterKvId) return true;
  return aktuell !== null && typeof d.kvVersion === "number" && d.kvVersion < aktuell;
}

/**
 * Plan 16 (Review M5): KV-Nummer ist die Nummer des VPS im Dateinamen („KV-KO-20261110-ART-3“),
 * sonst keine. Die Version heißt „Kalkulation vN“, damit sie nicht wie eine zweite Nummer aussieht.
 */
export function kvNummer(fileName: string): string | null {
  const m = /^(KV-[A-Z]{2,}-\d{8}-[A-Z0-9]+(?:-\d+)?)(?:\.pdf)?$/i.exec(fileName.trim());
  return m ? m[1] : null;
}

export function kvMeta(d: Pick<Dokument, "fileName" | "kvVersion">): string {
  const nr = kvNummer(d.fileName);
  return [nr ? `Nr. ${nr}` : null, typeof d.kvVersion === "number" ? `Kalkulation v${d.kvVersion}` : null].filter(Boolean).map((t) => `${t} · `).join("");
}

/** Kürzel und Bezeichnung je Dokumentart (wie DOC_TYPE_LABELS der alten Finanzen). */
const TYP: Record<string, { kurz: string; lang: string }> = {
  quotation: { kurz: "KV", lang: "Kostenvoranschlag" },
  order_confirmation: { kurz: "AB", lang: "Auftragsbestätigung" },
  invoice: { kurz: "RE", lang: "Rechnung" },
  payment_confirmation: { kurz: "ZB", lang: "Zahlungsbestätigung" },
  worker_instructions: { kurz: "CREW", lang: "Auftragsanweisung" },
  signed_contract: { kurz: "VERTRAG", lang: "Unterschriebener Vertrag" },
};

export function dokumentTyp(art: string): { kurz: string; lang: string } {
  return TYP[art] ?? { kurz: "DOK", lang: art };
}

/** „1,2 MB“, „340 KB“. */
function groesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; dokumente: Dokument[] };

/** Liste der Dokumente des Deals, neueste zuerst, mit Typ, Datum und Öffnen. */
export function DokumenteAnsicht({ dealId, kvVersionAktuell = null }: { dealId: string; kvVersionAktuell?: number | null }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });

  useEffect(() => {
    let aktiv = true;
    setZustand({ art: "laden" });
    void apiAufruf<Dokument[]>(`/api/v1/deals/${dealId}/documents`).then((r) => {
      if (!aktiv) return;
      if (!r.ok) {
        setZustand({ art: "fehler", meldung: r.message });
        return;
      }
      const dokumente = [...(r.data ?? [])].sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
      setZustand({ art: "fertig", dokumente });
    });
    return () => {
      aktiv = false;
    };
  }, [dealId]);

  return (
    <div className="akte-gespraech-ansicht" aria-label="Dokumente">
      {zustand.art === "laden" ? <p className="akte-gespraech-leer">Dokumente werden geladen…</p> : null}
      {zustand.art === "fehler" ? (
        <p className="akte-gespraech-leer" role="alert">
          Dokumente konnten nicht geladen werden. {zustand.meldung}
        </p>
      ) : null}
      {zustand.art === "fertig" && zustand.dokumente.length === 0 ? (
        <p className="akte-gespraech-leer">Noch keine Dokumente.</p>
      ) : null}
      {zustand.art === "fertig" && zustand.dokumente.length > 0 ? (
        <ul className="akte-gespraech-liste">
          {zustand.dokumente.map((d) => {
            const typ = dokumentTyp(d.documentType);
            const neuesterKv = zustand.dokumente.find((x) => x.documentType === "quotation")?.id ?? null;
            const ersetzt = kvErsetzt(d, neuesterKv, kvVersionAktuell);
            return (
              <li key={d.id} className="akte-gespraech-zeile">
                <span className="akte-gespraech-typ" title={typ.lang} aria-label={typ.lang}>
                  {typ.kurz}
                </span>
                <span className="akte-gespraech-zeile-text">
                  <span className="akte-gespraech-zeile-name">{d.fileName}</span>
                  <span className="akte-gespraech-zeile-meta">
                    {d.documentType === "quotation" ? kvMeta(d) : ""}
                    {tagKurz(d.uploadedAt)} · {groesse(d.fileSize)}
                    {ersetzt ? " · ersetzt" : ""}
                  </span>
                </span>
                <a
                  className="akte-gespraech-oeffnen"
                  href={`/api/v1/deals/${dealId}/documents/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${typ.lang} ${d.fileName} öffnen`}
                >
                  Öffnen
                </a>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
