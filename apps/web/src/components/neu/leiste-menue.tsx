"use client";

import "@/styles/neu-leiste.css";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { usePortalZiel } from "@/components/neu/portal-ziel";

export interface LeistenWahl {
  wert: string | null;
  label: string;
}

/**
 * Eine Pille der Filterleiste als Menü (Radix, Portal in `[data-neu]`): zeigt
 * die Vorgabe oder die Auswahl; die erste Option (null) hebt den Filter auf.
 * Aus `inbox/inbox-leiste.tsx` hierher verschoben, damit Inbox und Leads
 * dieselbe Pille zeigen.
 */
export function LeistenMenue({
  titel,
  optionen,
  wert,
  punkt,
  punktFarbe,
  onWaehlen,
}: {
  titel: string;
  optionen: readonly LeistenWahl[];
  wert: string | null;
  /** Farbpunkt vor dem Label (Mockup: Firma). */
  punkt?: boolean;
  /** Farbe des Punkts; ohne Angabe Tinte. */
  punktFarbe?: string;
  onWaehlen: (wert: string | null) => void;
}) {
  const portalZiel = usePortalZiel();
  const [offen, setOffen] = useState(false);
  const aktuell = optionen.find((o) => o.wert === wert) ?? optionen[0]!;

  return (
    <Menu.Root open={offen} onOpenChange={setOffen} modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className="leiste-pille-knopf" data-aktiv={wert !== null || undefined} aria-label={`${titel}: ${aktuell.label}, ändern`}>
          {punkt ? <i aria-hidden="true" style={punktFarbe ? { background: punktFarbe } : undefined} /> : null}
          {aktuell.label}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </Menu.Trigger>
      <Menu.Portal container={portalZiel}>
        <Menu.Content asChild align="start" sideOffset={8} collisionPadding={12}>
          <GlassPanel elevation="raised" lens preset="prominent" refraction="none" variant="card" className="lg-menu-content leiste-menue">
            <Menu.Label className="lg-menu-label">{titel}</Menu.Label>
            {optionen.map((o) => {
              const an = o.wert === wert;
              return (
                <Menu.Item
                  key={o.wert ?? "alle"}
                  className="lg-menu-item leiste-menue-eintrag"
                  data-aktuell={an || undefined}
                  aria-current={an ? "true" : undefined}
                  onSelect={() => onWaehlen(o.wert)}
                >
                  {o.label}
                </Menu.Item>
              );
            })}
          </GlassPanel>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
