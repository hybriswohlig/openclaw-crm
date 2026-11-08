"use client";

import { useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import {
  BEWERTUNG_MODUS_TEXT,
  istBewertungModus,
  type BewertungFirma,
  type BewertungModus,
} from "@/lib/bewertungen-kunden";
import { sendenRueckfrage } from "./bewertungen-logik";

const MODUS_LABEL: Record<BewertungModus, string> = { aus: "Aus", entwurf: "Entwurf", senden: "Senden" };

/**
 * Firmen-Leiste: je Firma der Modus der Automatik (Aus, Entwurf, Senden, mit
 * Rückfrage beim Wechsel auf Senden), der Portal-Haken und ein Hinweis ohne
 * Google-Link. Speichert über `PUT /api/v1/bewertungen/firmen/[ocId]`.
 */
export function FirmenLeiste({
  firmen,
  portalZiel,
  speichert,
  onSetzen,
}: {
  firmen: BewertungFirma[];
  portalZiel: HTMLElement | undefined;
  speichert: string | null;
  onSetzen: (ocId: string, e: { modus?: BewertungModus; hakenPortal?: boolean }) => void;
}) {
  const [frage, setFrage] = useState<BewertungFirma | null>(null);
  if (firmen.length === 0) return null;

  return (
    <>
      <div className="bew-firmen">
        {firmen.map((f) => (
          <GlassPanel key={f.id} variant="panel" className="bew-firma" data-modus={f.modus}>
            <div className="bew-firma-kopf">
              <h2 className="bew-firma-name">{f.name}</h2>
              <span className="bew-firma-modus-text">{BEWERTUNG_MODUS_TEXT[f.modus]}</span>
            </div>
            <div className="bew-firma-regler">
              <GlassSegmentedControl
                value={f.modus}
                onValueChange={(v) => {
                  if (!istBewertungModus(v) || v === f.modus) return;
                  if (v === "senden") setFrage(f);
                  else onSetzen(f.id, { modus: v });
                }}
                aria-label={`Automatik ${f.name}`}
              >
                {(["aus", "entwurf", "senden"] as const).map((m) => (
                  <GlassSegmentedControlItem key={m} value={m} disabled={speichert === f.id}>
                    {MODUS_LABEL[m]}
                  </GlassSegmentedControlItem>
                ))}
              </GlassSegmentedControl>
              <label className="bew-firma-haken">
                <GlassSwitch
                  size="sm"
                  checked={f.hakenPortal ?? false}
                  disabled={speichert === f.id}
                  onCheckedChange={(an) => onSetzen(f.id, { hakenPortal: an })}
                  aria-label={`Einwilligung im Portal abfragen, ${f.name}`}
                />
                <span>Einwilligung im Portal abfragen</span>
              </label>
            </div>
            {!f.googleLink ? (
              <p className="bew-firma-hinweis" role="note">
                Kein Google-Bewertungslink hinterlegt. Ohne Link wird nichts gesendet und der Portal-Haken bleibt unsichtbar.
              </p>
            ) : null}
          </GlassPanel>
        ))}
      </div>

      {frage ? (
        <GlassDialog open onOpenChange={(o) => !o && setFrage(null)}>
          <GlassDialogContent container={portalZiel} closeLabel="Schließen">
            <GlassDialogTitle className="akte-dialog-titel">Automatik für {frage.name} einschalten?</GlassDialogTitle>
            <GlassDialogDescription className="akte-dialog-text">{sendenRueckfrage(frage.modus, frage.modusSeit)}</GlassDialogDescription>
            <div className="akte-dialog-knoepfe">
              <GlassButton type="button" variant="ghost" onClick={() => setFrage(null)}>
                Abbrechen
              </GlassButton>
              <GlassButton
                type="button"
                onClick={() => {
                  onSetzen(frage.id, { modus: "senden" });
                  setFrage(null);
                }}
              >
                Senden einschalten
              </GlassButton>
            </div>
          </GlassDialogContent>
        </GlassDialog>
      ) : null}
    </>
  );
}
