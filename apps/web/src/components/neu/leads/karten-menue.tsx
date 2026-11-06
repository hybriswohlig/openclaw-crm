"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { spaltenTon, type LeadKarte, type LeadsStammdaten } from "@/lib/leads-board";
import { menueZiele, type ZugSeite } from "./leads-logik";

/**
 * Menü „Stufe ändern“ auf jeder Karte: dieselben Ziele und derselbe Ablauf
 * wie das Ziehen (Entscheidung 3), erreichbar per Tastatur und ohne Zeiger.
 * Der Knopf stoppt den Zeiger, damit kein Zug beginnt.
 */
export function KartenMenue({
  karte,
  stufen,
  onZug,
}: {
  karte: LeadKarte;
  stufen: LeadsStammdaten["stufen"];
  onZug: (karte: LeadKarte, nach: ZugSeite) => void;
}) {
  const portalZiel = usePortalZiel();
  const [offen, setOffen] = useState(false);
  const ziele = menueZiele(karte, stufen);
  if (ziele.length === 0) return null;

  return (
    <Menu.Root open={offen} onOpenChange={setOffen} modal={false}>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="leads-karte-menue"
          aria-label={`${karte.name}: Stufe ändern`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      </Menu.Trigger>
      <Menu.Portal container={portalZiel}>
        {/* Das Menü hängt im Portal, im React-Baum aber in der Karte: Zeiger und Klick
            dürfen dort keinen Zug starten und nicht die Akte öffnen. */}
        <Menu.Content
          asChild
          align="end"
          sideOffset={6}
          collisionPadding={12}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <GlassPanel elevation="raised" lens preset="prominent" refraction="none" variant="card" className="lg-menu-content leads-menue">
            <Menu.Label className="lg-menu-label">Stufe ändern</Menu.Label>
            {ziele.map(({ stufe }) => (
              <Menu.Item
                key={stufe.id}
                className="lg-menu-item leads-menue-eintrag"
                onSelect={() => onZug(karte, { stufeId: stufe.id, kategorie: stufe.kategorie, label: stufe.label })}
              >
                <i className="leads-punkt" data-ton={spaltenTon(stufe.kategorie)} aria-hidden="true" />
                {stufe.label}
              </Menu.Item>
            ))}
          </GlassPanel>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
