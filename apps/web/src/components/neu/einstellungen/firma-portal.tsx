"use client";

import { useEffect, useState } from "react";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import {
  portalSchalterPatch,
  type FirmaEinstellungenAnsicht,
  type PortalSchalter,
  type PortalSchalterName,
} from "@/lib/einstellungen-uebersicht";
import { Abschnitt, useSpeichern } from "./abschnitt";
import { portalRueckfrage, speichernAktiv, tagespreiseGesperrt } from "./einstellungen-logik";
import { Rueckfrage } from "./rueckfrage";
import { TEXT, type RueckfrageArt } from "./texte";

const SCHALTER: { name: PortalSchalterName; label: string }[] = [
  { name: "signatureEnabled", label: TEXT.unterschrift },
  { name: "angebotAusKalkulation", label: TEXT.angebotAusKalkulation },
  { name: "tagespreiseEnabled", label: TEXT.tagespreise },
];

/** Nur die geänderten Schalter für `PUT customer-portal-settings`. */
export function portalAenderung(vorher: PortalSchalter, nachher: PortalSchalter): Partial<PortalSchalter> {
  const aus: Partial<PortalSchalter> = {};
  for (const { name } of SCHALTER) if (vorher[name] !== nachher[name]) aus[name] = nachher[name];
  return aus;
}

/** (d) Portal: Unterschrift, Angebot aus Kalkulation, Tagespreise (Plan 5b). */
export function FirmaPortal({
  firma,
  portalZiel,
  onGespeichert,
}: {
  firma: FirmaEinstellungenAnsicht;
  portalZiel: HTMLElement | undefined;
  onGespeichert: () => Promise<void>;
}) {
  const [e, setE] = useState<PortalSchalter>(firma.portal);
  const [frage, setFrage] = useState<RueckfrageArt[] | null>(null);
  const s = useSpeichern(onGespeichert);
  const schluessel = JSON.stringify(firma.portal);
  useEffect(() => setE(JSON.parse(schluessel) as PortalSchalter), [schluessel]);

  const aenderung = portalAenderung(firma.portal, e);
  const aktiv = speichernAktiv(firma.portal, e, null, s.laeuft);

  function umschalten(name: PortalSchalterName, wert: boolean) {
    const patch = portalSchalterPatch(e, name, wert);
    if (patch) setE({ ...e, ...patch });
  }

  function senden() {
    void s.speichern(() =>
      apiAufruf(`/api/v1/customer-portal-settings/${encodeURIComponent(firma.id)}`, jsonAufruf("PUT", aenderung)),
    );
  }

  function klick() {
    const arten = SCHALTER.flatMap(({ name }) => {
      const wert = aenderung[name];
      const art = wert === undefined ? null : portalRueckfrage(name, wert);
      return art ? [art] : [];
    });
    if (arten.length > 0) setFrage(arten);
    else senden();
  }

  return (
    <>
      <Abschnitt
        titel={TEXT.portal}
        satz={firma.portal.enabled ? undefined : TEXT.portalAus}
        aktiv={aktiv}
        laeuft={s.laeuft}
        fehler={s.fehler}
        onSpeichern={klick}
        kinder={
          <ul className="einst-schalter">
            {SCHALTER.map(({ name, label }) => {
              const gesperrt = name === "tagespreiseEnabled" && tagespreiseGesperrt(e);
              return (
                <li key={name}>
                  <label className="einst-schalter-zeile" data-gesperrt={gesperrt || undefined}>
                    <GlassSwitch
                      size="sm"
                      checked={e[name]}
                      disabled={gesperrt || s.laeuft}
                      onCheckedChange={(an) => umschalten(name, an)}
                      aria-label={`${label}, ${firma.name}`}
                    />
                    <span>{label}</span>
                  </label>
                  {gesperrt ? <p className="einst-satz einst-einzug">{TEXT.tagespreiseGesperrt}</p> : null}
                </li>
              );
            })}
          </ul>
        }
      />
      <Rueckfrage
        arten={frage}
        portalZiel={portalZiel}
        onNein={() => setFrage(null)}
        onJa={() => {
          setFrage(null);
          senden();
        }}
      />
    </>
  );
}
