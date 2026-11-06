"use client";

import "@/styles/neu-leiste.css";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { LISTEN_SPALTEN, type ListenSpalte } from "@/lib/leads-board";

/**
 * Menü „Spalten“ der Liste (Entscheidung 15): ein Haken je Spalte aus
 * `LISTEN_SPALTEN`, „Name“ fest. Das Menü bleibt beim Umschalten offen.
 */
export function SpaltenWahl({ gewaehlt, onUmschalten }: { gewaehlt: readonly ListenSpalte[]; onUmschalten: (key: ListenSpalte) => void }) {
  const portalZiel = usePortalZiel();
  const [offen, setOffen] = useState(false);
  return (
    <Menu.Root open={offen} onOpenChange={setOffen} modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className="leiste-pille-knopf" aria-label={`Spalten: ${gewaehlt.length} gewählt, ändern`}>
          Spalten
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </Menu.Trigger>
      <Menu.Portal container={portalZiel}>
        <Menu.Content asChild align="end" sideOffset={8} collisionPadding={12}>
          <GlassPanel elevation="raised" lens preset="prominent" refraction="none" variant="card" className="lg-menu-content leiste-menue">
            <Menu.Label className="lg-menu-label">Spalten</Menu.Label>
            {LISTEN_SPALTEN.map((s) => {
              const an = gewaehlt.includes(s.key);
              const fest = s.key === "name";
              return (
                <Menu.CheckboxItem
                  key={s.key}
                  className="lg-menu-item leiste-menue-eintrag leads-spalten-eintrag"
                  checked={an}
                  disabled={fest}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={() => onUmschalten(s.key)}
                >
                  <span className="leads-haken" data-an={an || undefined} aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  </span>
                  {s.label}
                </Menu.CheckboxItem>
              );
            })}
          </GlassPanel>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
