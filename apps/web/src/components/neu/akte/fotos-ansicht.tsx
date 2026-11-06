"use client";

import { useEffect, useState } from "react";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { tagKurz, uhrzeitKurz } from "@/lib/anzeige";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { apiAufruf } from "./api";

export interface Foto {
  id: string;
  name: string;
  /** ISO-Zeit, wenn bekannt. */
  am?: string | null;
}

interface Anhang {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export function istBild(mime: string): boolean {
  return mime.toLowerCase().startsWith("image/");
}

/** Bytes eines Anhangs (Bild oder Datei), nur mit Sitzung. */
export function anhangUrl(id: string): string {
  return `/api/v1/inbox/attachments/${encodeURIComponent(id)}/content`;
}

type Zustand = { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; fotos: Foto[] };

/** Raster aller Bildanhänge des Deals; Klick öffnet das Bild im Vollbild. */
export function FotosAnsicht({ dealId }: { dealId: string }) {
  const [zustand, setZustand] = useState<Zustand>({ art: "laden" });
  const [offen, setOffen] = useState<Foto | null>(null);

  useEffect(() => {
    let aktiv = true;
    setZustand({ art: "laden" });
    void apiAufruf<Anhang[]>(`/api/v1/deals/${dealId}/attachments`).then((r) => {
      if (!aktiv) return;
      if (!r.ok) {
        setZustand({ art: "fehler", meldung: r.message });
        return;
      }
      const fotos = (r.data ?? [])
        .filter((a) => istBild(a.mimeType))
        .map((a) => ({ id: a.id, name: a.fileName, am: a.createdAt }));
      setZustand({ art: "fertig", fotos });
    });
    return () => {
      aktiv = false;
    };
  }, [dealId]);

  return (
    <div className="akte-gespraech-ansicht" aria-label="Fotos">
      {zustand.art === "laden" ? <p className="akte-gespraech-leer">Fotos werden geladen…</p> : null}
      {zustand.art === "fehler" ? (
        <p className="akte-gespraech-leer" role="alert">
          Fotos konnten nicht geladen werden. {zustand.meldung}
        </p>
      ) : null}
      {zustand.art === "fertig" && zustand.fotos.length === 0 ? (
        <p className="akte-gespraech-leer">Noch keine Fotos.</p>
      ) : null}
      {zustand.art === "fertig" && zustand.fotos.length > 0 ? (
        <div className="akte-gespraech-raster">
          {zustand.fotos.map((f, i) => (
            <button
              key={f.id}
              type="button"
              className="akte-gespraech-foto"
              onClick={() => setOffen(f)}
              aria-label={`Foto ${i + 1} von ${zustand.fotos.length} öffnen: ${f.name}`}
            >
              <img src={anhangUrl(f.id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
      <FotoVollbild foto={offen} onClose={() => setOffen(null)} />
    </div>
  );
}

/** Ein Bild groß im Glasdialog; `foto` null = zu. */
export function FotoVollbild({ foto, onClose }: { foto: Foto | null; onClose: () => void }) {
  const portalZiel = usePortalZiel();
  return (
    <GlassDialog open={foto !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      {foto ? (
        <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="akte-gespraech-vollbild">
          <GlassDialogTitle className="akte-gespraech-vollbild-titel">{foto.name}</GlassDialogTitle>
          <img src={anhangUrl(foto.id)} alt={foto.name} />
          <GlassDialogDescription className="akte-gespraech-vollbild-meta">
            {foto.am ? `${tagKurz(foto.am)} · ${uhrzeitKurz(foto.am)}` : "Anhang aus dem Gespräch"}
          </GlassDialogDescription>
        </GlassDialogContent>
      ) : null}
    </GlassDialog>
  );
}
