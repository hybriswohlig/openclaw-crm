"use client";

import * as Popover from "@radix-ui/react-popover";
import Link from "next/link";
import { useId, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { tagKurz } from "@/lib/anzeige";
import type { PlanEintrag } from "@/lib/plan-heute";
import { TEAM_ZUORDNEN_URL, popoverAktionen, type PopoverAktionen } from "./plan-logik";
import { TON_TEXT, teamText, teamZeigen } from "./plan-zeile-logik";

export interface PopoverHandlungen {
  /** Prüft und startet den Zug; liefert einen Hinweis, wenn er nicht geht (dann bleibt das Popover offen). */
  onVerschieben: (e: PlanEintrag, ziel: string) => string | null;
  onBestaetigen: (e: PlanEintrag, stufe: { id: string; label: string }) => void;
  onTerminangebote: (e: PlanEintrag) => void;
}

/**
 * Details und Aktionen eines Eintrags (Entscheidung 17): „Akte öffnen“,
 * „Verschieben auf …“ (nur ziehbar; Datumsfeld, gleiche Prüfung und
 * Rückfrage wie das Ziehen), „Durchführung bestätigen“ (nur mit Grund
 * „bestätigen“ und vorhandener Stufe Durchgeführt), „Terminangebote“ (nicht
 * feste Umzüge), „Team zuordnen“ (Link auf /operations). Desktop als Popover
 * am Eintrag, am Handy als Dialog.
 */
export function EintragPopover({
  eintrag: e,
  anker,
  heute,
  stufen,
  kompakt,
  portalZiel,
  onSchliessen,
  ...h
}: PopoverHandlungen & {
  eintrag: PlanEintrag;
  anker: HTMLElement;
  heute: string;
  stufen: readonly { id: string; label: string; kategorie: PlanEintrag["stufe"]["kategorie"] }[];
  kompakt: boolean;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
}) {
  const aktionen = popoverAktionen(e, stufen);
  const titelId = useId();

  if (kompakt) {
    return (
      <GlassDialog open onOpenChange={(o) => !o && onSchliessen()}>
        <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="plan-dialog">
          <GlassDialogTitle className="akte-dialog-titel">{e.titel}</GlassDialogTitle>
          <GlassDialogDescription className="plan-popover-ton">{TON_TEXT[e.ton]}</GlassDialogDescription>
          <Inhalt eintrag={e} aktionen={aktionen} heute={heute} {...h} />
        </GlassDialogContent>
      </GlassDialog>
    );
  }

  return (
    <Popover.Root open onOpenChange={(o) => !o && onSchliessen()}>
      <Popover.Anchor virtualRef={{ current: anker }} />
      <Popover.Portal container={portalZiel}>
        <Popover.Content
          asChild
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-labelledby={titelId}
          onCloseAutoFocus={(ev) => {
            // Kein Auslöser im Sinne von Radix: den Fokus selbst zurück auf den Eintrag.
            ev.preventDefault();
            if (anker.isConnected) anker.focus();
          }}
        >
          <GlassPanel elevation="raised" lens preset="prominent" refraction="none" variant="card" className="plan-popover">
            <div className="plan-popover-kopf">
              <i data-ton={e.ton} aria-hidden="true" />
              <div>
                <h3 id={titelId}>{e.titel}</h3>
                <p className="plan-popover-ton">{TON_TEXT[e.ton]}</p>
              </div>
              <Popover.Close className="plan-popover-zu" aria-label="Schließen">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </Popover.Close>
            </div>
            <Inhalt eintrag={e} aktionen={aktionen} heute={heute} {...h} />
          </GlassPanel>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Inhalt({ eintrag: e, aktionen, heute, onVerschieben, onBestaetigen, onTerminangebote }: PopoverHandlungen & { eintrag: PlanEintrag; aktionen: PopoverAktionen; heute: string }) {
  const feldId = useId();
  const [ziel, setZiel] = useState(e.tag < heute ? heute : e.tag);
  const [hinweis, setHinweis] = useState<string | null>(null);
  const wann = [e.bisTag !== e.tag ? `${tagKurz(e.tag)} bis ${tagKurz(e.bisTag)}` : tagKurz(e.tag), e.zeitText].filter(Boolean).join(" · ");

  return (
    <>
      <dl className="plan-popover-daten">
        <div>
          <dt>Wann</dt>
          <dd>{wann}</dd>
        </div>
        <div>
          <dt>{e.art === "besichtigung" ? e.label : "Auftrag"}</dt>
          <dd>{e.zeile}</dd>
        </div>
        {teamZeigen(e) ? (
          <div>
            <dt>Team</dt>
            <dd>{teamText(e)}</dd>
          </div>
        ) : null}
        {e.transporter ? (
          <div>
            <dt>Fahrzeug</dt>
            <dd>{e.transporter}</dd>
          </div>
        ) : null}
        <div>
          <dt>Stufe</dt>
          <dd>
            {e.stufe.label}
            {e.firma ? (
              <span className="plan-popover-firma">
                <i style={{ background: e.firma.farbe }} aria-hidden="true" />
                {e.firma.name}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      {aktionen.verschieben ? (
        <form
          className="plan-popover-verschieben"
          onSubmit={(ev) => {
            ev.preventDefault();
            setHinweis(onVerschieben(e, ziel));
          }}
        >
          <label htmlFor={feldId}>Verschieben auf …</label>
          <div>
            <input id={feldId} type="date" min={heute} value={ziel} required onChange={(ev) => setZiel(ev.target.value)} />
            <GlassButton type="submit" size="sm" variant="soft">
              Verschieben
            </GlassButton>
          </div>
          {hinweis ? (
            <p className="plan-popover-hinweis" role="status">
              {hinweis}
            </p>
          ) : null}
        </form>
      ) : null}

      <div className="plan-popover-knoepfe">
        <GlassButton asChild size="sm">
          <Link href={e.href}>Akte öffnen</Link>
        </GlassButton>
        {aktionen.bestaetigen ? (
          <GlassButton size="sm" variant="soft" onClick={() => onBestaetigen(e, aktionen.bestaetigen!)}>
            Durchführung bestätigen
          </GlassButton>
        ) : null}
        {aktionen.terminangebote ? (
          <GlassButton size="sm" variant="soft" onClick={() => onTerminangebote(e)}>
            Terminangebote
          </GlassButton>
        ) : null}
        {aktionen.teamZuordnen ? (
          <GlassButton asChild size="sm" variant="ghost">
            <Link href={TEAM_ZUORDNEN_URL}>Team zuordnen</Link>
          </GlassButton>
        ) : null}
      </div>
    </>
  );
}
