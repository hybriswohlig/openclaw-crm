"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import {
  GlassSelect,
  GlassSelectContent,
  GlassSelectItem,
  GlassSelectTrigger,
  GlassSelectValue,
} from "@/components/glassyui/glass-select";
import { stufenTon, type AkteDaten } from "@/lib/akte";
import { CRM_UI_CLIENT_HEADER, CRM_UI_CLIENT_VALUE } from "@/lib/deal-source";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { apiAufruf, jsonAufruf } from "./api";

type Kopf = AkteDaten["kopf"];
type Stufe = Kopf["stufen"][number];

/** Stufen, vor denen ein Dialog fragt (Entscheidung 14); Verloren verlangt den Grund. */
const MIT_RUECKFRAGE = new Set(["done_unpaid", "paid", "lost"]);

/**
 * Die Stufen-Pille im Kopf als Menü mit allen Deal-Stufen. Der Wechsel geht
 * über `PATCH /api/v1/objects/deals/records/{id}` wie in der alten Oberfläche,
 * damit `deal.stage_changed`, `move_completed_at` und Wartet wie heute laufen.
 */
export function StufenMenue({
  dealId,
  stufe,
  stufen,
  verlustGruende,
  onGewechselt,
}: {
  dealId: string;
  stufe: Kopf["stufe"];
  stufen: Kopf["stufen"];
  verlustGruende: Kopf["verlustGruende"];
  onGewechselt: () => Promise<void> | void;
}) {
  const portalZiel = usePortalZiel();
  const [menueOffen, setMenueOffen] = useState(false);
  const [rueckfrage, setRueckfrage] = useState<Stufe | null>(null);
  const [speichert, setSpeichert] = useState(false);

  async function wechseln(ziel: Stufe, verlust?: { grund: string; notiz: string }): Promise<string | null> {
    const werte: Record<string, unknown> = { stage: ziel.id };
    if (verlust) {
      werte.loss_reason = verlust.grund;
      werte.loss_reason_note = verlust.notiz || null;
    }
    setSpeichert(true);
    const r = await apiAufruf<unknown>(
      `/api/v1/objects/deals/records/${dealId}`,
      jsonAufruf("PATCH", { values: werte }, { [CRM_UI_CLIENT_HEADER]: CRM_UI_CLIENT_VALUE })
    );
    setSpeichert(false);
    if (!r.ok) return r.message;
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

/** Rückfrage vor Durchgeführt und Bezahlt; bei Verloren mit Pflichtgrund wie `LossReasonDialog`. */
function StufenDialog({
  portalZiel,
  von,
  ziel,
  verlustGruende,
  speichert,
  onAbbrechen,
  onBestaetigen,
}: {
  portalZiel: HTMLElement | undefined;
  von: string;
  ziel: Stufe;
  verlustGruende: Kopf["verlustGruende"];
  speichert: boolean;
  onAbbrechen: () => void;
  onBestaetigen: (verlust?: { grund: string; notiz: string }) => Promise<string | null>;
}) {
  const verloren = ziel.kategorie === "lost";
  const [grund, setGrund] = useState("");
  const [notiz, setNotiz] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const grundLabel = verlustGruende.find((g) => g.id === grund)?.label ?? "";
  const sonstiges = grundLabel.toLowerCase() === "sonstiges";

  async function absenden(e: React.FormEvent) {
    e.preventDefault();
    if (verloren) {
      if (!grund) return setFehler("Bitte einen Verlustgrund wählen.");
      if (sonstiges && !notiz.trim()) return setFehler("Bei Sonstiges ist ein Freitext Pflicht.");
    }
    setFehler(null);
    const problem = await onBestaetigen(verloren ? { grund, notiz: notiz.trim() } : undefined);
    if (problem) setFehler(problem);
  }

  return (
    <GlassDialog open onOpenChange={(offen) => !offen && !speichert && onAbbrechen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen">
        <GlassDialogTitle className="akte-dialog-titel">
          {verloren ? "Verlustgrund" : `Stufe auf „${ziel.label}“ setzen?`}
        </GlassDialogTitle>
        <GlassDialogDescription className="akte-dialog-text">
          {verloren
            ? "Ein Lead auf Verloren braucht einen Grund."
            : `Der Deal wechselt von „${von}“ auf „${ziel.label}“.`}
        </GlassDialogDescription>
        <form onSubmit={(e) => void absenden(e)}>
          {verloren ? (
            <>
              <label className="akte-dialog-feld">
                Grund
                <GlassSelect value={grund} onValueChange={setGrund} disabled={verlustGruende.length === 0}>
                  <GlassSelectTrigger aria-label="Verlustgrund">
                    <GlassSelectValue placeholder="Auswählen" />
                  </GlassSelectTrigger>
                  <GlassSelectContent>
                    {verlustGruende.map((g) => (
                      <GlassSelectItem key={g.id} value={g.id}>
                        {g.label}
                      </GlassSelectItem>
                    ))}
                  </GlassSelectContent>
                </GlassSelect>
              </label>
              {verlustGruende.length === 0 ? (
                <p className="akte-dialog-fehler">Im Workspace sind keine Verlustgründe angelegt.</p>
              ) : null}
              <label className="akte-dialog-feld">
                Freitext
                <textarea
                  className="lg-input lg-textarea"
                  value={notiz}
                  onChange={(e) => setNotiz(e.target.value)}
                  placeholder={sonstiges ? "Pflicht bei Sonstiges" : "Optional"}
                  rows={3}
                />
              </label>
            </>
          ) : null}
          {fehler ? <p className="akte-dialog-fehler">{fehler}</p> : null}
          <div className="akte-dialog-knoepfe">
            <GlassButton type="button" variant="ghost" onClick={onAbbrechen} disabled={speichert}>
              Abbrechen
            </GlassButton>
            <GlassButton type="submit" disabled={speichert || (verloren && verlustGruende.length === 0)}>
              {speichert ? "Speichert" : verloren ? "Als verloren markieren" : `Auf „${ziel.label}“ setzen`}
            </GlassButton>
          </div>
        </form>
      </GlassDialogContent>
    </GlassDialog>
  );
}
