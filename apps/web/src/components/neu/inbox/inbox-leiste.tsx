"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useId, useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import type { InboxFilter, InboxListe } from "@/lib/inbox-neu";
import { KANAL_WAHL } from "./inbox-logik";

interface Wahl {
  wert: string | null;
  label: string;
}

/**
 * Eine Pille der Leiste als Menü (Radix, Portal in `[data-neu]`): zeigt die
 * Vorgabe oder die Auswahl; die erste Option (null) hebt den Filter auf.
 */
function LeistenMenue({
  titel,
  optionen,
  wert,
  punkt,
  onWaehlen,
}: {
  titel: string;
  optionen: readonly Wahl[];
  wert: string | null;
  /** Farbpunkt vor dem Label (Mockup: Firma). */
  punkt?: boolean;
  onWaehlen: (wert: string | null) => void;
}) {
  const portalZiel = usePortalZiel();
  const [offen, setOffen] = useState(false);
  const aktuell = optionen.find((o) => o.wert === wert) ?? optionen[0]!;

  return (
    <Menu.Root open={offen} onOpenChange={setOffen} modal={false}>
      <Menu.Trigger asChild>
        <button type="button" className="inbox-pille-knopf" data-aktiv={wert !== null || undefined} aria-label={`${titel}: ${aktuell.label}, ändern`}>
          {punkt ? <i aria-hidden="true" /> : null}
          {aktuell.label}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      </Menu.Trigger>
      <Menu.Portal container={portalZiel}>
        <Menu.Content asChild align="start" sideOffset={8} collisionPadding={12}>
          <GlassPanel elevation="raised" lens preset="prominent" refraction="none" variant="card" className="lg-menu-content inbox-menue">
            <Menu.Label className="lg-menu-label">{titel}</Menu.Label>
            {optionen.map((o) => {
              const an = o.wert === wert;
              return (
                <Menu.Item
                  key={o.wert ?? "alle"}
                  className="lg-menu-item inbox-menue-eintrag"
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

/**
 * Die Leiste unter den Chips (Entscheidung 7): Kanal, Firma, Stufe, Suche
 * (ab 2 Zeichen Server), Schalter „Nur „wartet auf uns““. Firmen und Stufen
 * kommen aus der geladenen Liste.
 */
export function InboxLeiste({
  filter,
  firmen,
  stufen,
  onFilter,
}: {
  filter: InboxFilter;
  firmen: InboxListe["firmen"];
  stufen: InboxListe["stufen"];
  onFilter: (teil: Partial<InboxFilter>) => void;
}) {
  const schalterId = useId();
  const sucheId = useId();
  const firmenWahl: Wahl[] = [{ wert: null, label: "Beide Firmen" }, ...firmen.map((f) => ({ wert: f.id, label: f.name }))];
  const stufenWahl: Wahl[] = [{ wert: null, label: "Alle Stufen" }, ...stufen.map((s) => ({ wert: s.id, label: s.label }))];

  return (
    <GlassPanel variant="panel" className="inbox-leiste" aria-label="Filter">
      <LeistenMenue
        titel="Kanal"
        optionen={KANAL_WAHL.map((k) => ({ wert: k.wert, label: k.label }))}
        wert={filter.kanal}
        onWaehlen={(w) => onFilter({ kanal: w as InboxFilter["kanal"] })}
      />
      <LeistenMenue titel="Firma" optionen={firmenWahl} wert={filter.firmaId} punkt onWaehlen={(w) => onFilter({ firmaId: w })} />
      <LeistenMenue titel="Stufe" optionen={stufenWahl} wert={filter.stufeId} onWaehlen={(w) => onFilter({ stufeId: w })} />
      <label className="inbox-suche" htmlFor={sucheId}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
        <input
          id={sucheId}
          type="search"
          value={filter.suche}
          placeholder="Name, Nummer, Text"
          autoComplete="off"
          aria-label="Suche: Name, Nummer, E-Mail, Betreff, Nachrichtentext"
          onChange={(e) => onFilter({ suche: e.target.value })}
        />
      </label>
      <div className="inbox-schalter">
        <GlassSwitch
          id={schalterId}
          size="sm"
          checked={filter.nurWartet}
          onCheckedChange={(an) => onFilter({ nurWartet: an })}
          aria-labelledby={`${schalterId}-label`}
        />
        <label id={`${schalterId}-label`} htmlFor={schalterId}>
          Nur „wartet auf uns“
        </label>
      </div>
    </GlassPanel>
  );
}
