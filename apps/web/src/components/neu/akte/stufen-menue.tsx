"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { toast } from "sonner";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { stufenTon, type AkteDaten } from "@/lib/akte";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { stufeSetzen } from "@/components/neu/stufen-wechsel/stufe-setzen";
import { StufenDialog } from "@/components/neu/stufen-wechsel/stufen-dialog";

type Kopf = AkteDaten["kopf"];
type Stufe = Kopf["stufen"][number];

/** Stufen, vor denen ein Dialog fragt (Entscheidung 14); Verloren verlangt den Grund. */
const MIT_RUECKFRAGE = new Set(["done_unpaid", "paid", "lost"]);

/**
 * Die Stufen-Pille im Kopf als Menü mit allen Deal-Stufen. Der Wechsel geht
 * über `stufeSetzen` (PATCH wie in der alten Oberfläche, mit `x-crm-client: ui`),
 * damit `deal.stage_changed`, `move_completed_at` und Wartet wie heute laufen.
 * Ist schon ein Verlustgrund gespeichert, fragt Verloren nicht erneut danach
 * (wie `needsLossReasonPrompt` der alten Seite), nur noch zur Bestätigung.
 */
export function StufenMenue({
  dealId,
  stufe,
  stufen,
  verlustGruende,
  verlustGrund,
  onGewechselt,
}: {
  dealId: string;
  stufe: Kopf["stufe"];
  stufen: Kopf["stufen"];
  verlustGruende: Kopf["verlustGruende"];
  verlustGrund: string | null;
  onGewechselt: () => Promise<void> | void;
}) {
  const portalZiel = usePortalZiel();
  const [menueOffen, setMenueOffen] = useState(false);
  const [rueckfrage, setRueckfrage] = useState<Stufe | null>(null);
  const [speichert, setSpeichert] = useState(false);

  async function wechseln(ziel: Stufe, verlust?: { grund: string; notiz: string }): Promise<string | null> {
    setSpeichert(true);
    const fehler = await stufeSetzen(dealId, ziel.id, verlust);
    setSpeichert(false);
    if (fehler) return fehler;
    toast.success(`Stufe auf „${ziel.label}“ gesetzt.`);
    await onGewechselt();
    return null;
  }

  async function waehlen(ziel: Stufe) {
    setMenueOffen(false);
    if (ziel.id === stufe.id) return;
    if (ziel.kategorie && MIT_RUECKFRAGE.has(ziel.kategorie)) {
      setRueckfrage(ziel);
      return;
    }
    const fehler = await wechseln(ziel);
    if (fehler) toast.error("Stufe konnte nicht gesetzt werden.", { description: fehler });
  }

  return (
    <>
      <Menu.Root open={menueOffen} onOpenChange={setMenueOffen} modal={false}>
        <Menu.Trigger asChild>
          <button type="button" className="akte-pille" disabled={speichert} aria-label={`Stufe: ${stufe.label}, ändern`}>
            <i className="akte-punkt" data-ton={stufe.ton} aria-hidden="true" />
            {stufe.label}
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </Menu.Trigger>
        <Menu.Portal container={portalZiel}>
          <Menu.Content asChild align="end" sideOffset={8} collisionPadding={12}>
            <GlassPanel
              elevation="raised"
              lens
              preset="prominent"
              refraction="none"
              variant="card"
              className="lg-menu-content akte-stufen-menue"
            >
              <Menu.Label className="lg-menu-label">Stufe</Menu.Label>
              {stufen.map((s) => {
                const aktuell = s.id === stufe.id;
                return (
                  <Menu.Item
                    key={s.id}
                    className="lg-menu-item akte-stufen-eintrag"
                    data-aktuell={aktuell || undefined}
                    aria-current={aktuell ? "true" : undefined}
                    onSelect={() => void waehlen(s)}
                  >
                    <i className="akte-punkt" data-ton={stufenTon(s.kategorie)} aria-hidden="true" />
                    {s.label}
                  </Menu.Item>
                );
              })}
            </GlassPanel>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      {rueckfrage ? (
        <StufenDialog
          portalZiel={portalZiel}
          von={stufe.label}
          ziel={rueckfrage}
          grundNoetig={rueckfrage.kategorie === "lost" && !verlustGrund}
          verlustGruende={verlustGruende}
          speichert={speichert}
          onAbbrechen={() => setRueckfrage(null)}
          onBestaetigen={async (verlust) => {
            const fehler = await wechseln(rueckfrage, verlust);
            if (!fehler) setRueckfrage(null);
            return fehler;
          }}
        />
      ) : null}
    </>
  );
}
