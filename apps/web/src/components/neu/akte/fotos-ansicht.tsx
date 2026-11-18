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
import { toast } from "sonner";
import { apiAufruf, jsonAufruf } from "./api";

export interface Foto {
  id: string;
  name: string;
  /** ISO-Zeit, wenn bekannt. */
  am?: string | null;
  /** Crew-Portal: für die Crew freigegeben. */
  crew?: boolean;
  /** Crew-Portal: Format lässt sich freigeben (JPEG, PNG, WebP, GIF). */
  crewMoeglich?: boolean;
  /** Crew-Portal: im Briefing für das bestätigte Team sichtbar (Standard ja). */
  briefing?: boolean;
  /** Crew-Portal: nur Chat-Fotos erscheinen im Briefing. */
  briefingMoeglich?: boolean;
}

/** Gleiche Liste wie die Crew-API (`CREW_FOTO_TYPEN`); HEIC und SVG nie. */
const CREW_FORMATE = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"]);

interface Anhang {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
  crewFreigegebenAt?: string | null;
  crewGesperrtAt?: string | null;
  briefingMoeglich?: boolean;
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
  const [schaltet, setSchaltet] = useState<string | null>(null);

  async function crewUmschalten(f: Foto) {
    const neu = !f.crew;
    setSchaltet(f.id);
    const r = await apiAufruf<{ crewFreigegebenAt: string | null }>(
      `/api/v1/deals/${encodeURIComponent(dealId)}/fotos/${encodeURIComponent(f.id)}/crew`,
      jsonAufruf("PATCH", { freigegeben: neu }),
    );
    setSchaltet(null);
    if (!r.ok) {
      toast.error("Freigabe nicht gespeichert.", { description: r.message });
      return;
    }
    // Wer es allen zeigt, zeigt es auch dem Team im Briefing.
    setZustand((z) =>
      z.art === "fertig"
        ? { ...z, fotos: z.fotos.map((x) => (x.id === f.id ? { ...x, crew: !!r.data.crewFreigegebenAt, briefing: r.data.crewFreigegebenAt ? true : x.briefing } : x)) }
        : z,
    );
  }

  async function briefingUmschalten(f: Foto) {
    const neu = !f.briefing;
    setSchaltet(f.id);
    const r = await apiAufruf<{ crewGesperrtAt: string | null }>(
      `/api/v1/deals/${encodeURIComponent(dealId)}/fotos/${encodeURIComponent(f.id)}/crew`,
      jsonAufruf("PATCH", { imBriefing: neu }),
    );
    setSchaltet(null);
    if (!r.ok) {
      toast.error("Nicht gespeichert.", { description: r.message });
      return;
    }
    // Ausblenden nimmt das Foto auch aus der Jobbörse.
    setZustand((z) =>
      z.art === "fertig"
        ? { ...z, fotos: z.fotos.map((x) => (x.id === f.id ? { ...x, briefing: !r.data.crewGesperrtAt, crew: r.data.crewGesperrtAt ? false : x.crew } : x)) }
        : z,
    );
  }

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
        .map((a) => ({
          id: a.id,
          name: a.fileName,
          am: a.createdAt,
          crew: !!a.crewFreigegebenAt,
          crewMoeglich: CREW_FORMATE.has(a.mimeType.toLowerCase()),
          briefing: !a.crewGesperrtAt,
          briefingMoeglich: a.briefingMoeglich === true,
        }));
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
            <div key={f.id} className="akte-foto-kachel">
              <button
                type="button"
                className="akte-gespraech-foto"
                onClick={() => setOffen(f)}
                aria-label={`Foto ${i + 1} von ${zustand.fotos.length} öffnen: ${f.name}`}
              >
                <img src={anhangUrl(f.id)} alt="" loading="lazy" />
              </button>
              {f.crewMoeglich || f.crew ? (
                <>
                  <label className="akte-foto-crew" title="Alle Helfer sehen es schon in der Jobbörse. Nur Innen- und Möbelfotos: keine Fassade, Hausnummer, Kennzeichen oder Gesichter.">
                    <input type="checkbox" checked={!!f.crew} disabled={schaltet === f.id} onChange={() => void crewUmschalten(f)} />
                    Allen Helfern zeigen
                  </label>
                  {f.briefingMoeglich ? (
                    <label className="akte-foto-crew" title="Das bestätigte Team sieht es im freigegebenen Briefing. Ausweise, Rechnungen o. Ä. hier abschalten (dann auch nicht für alle Helfer).">
                      <input type="checkbox" checked={f.briefing !== false} disabled={schaltet === f.id} onChange={() => void briefingUmschalten(f)} />
                      Im Briefing fürs Team
                    </label>
                  ) : null}
                </>
              ) : (
                <span className="akte-foto-crew" title="Nur JPEG, PNG, WebP oder GIF lassen sich für die Crew zeigen.">
                  Format geht nicht für die Crew
                </span>
              )}
            </div>
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
