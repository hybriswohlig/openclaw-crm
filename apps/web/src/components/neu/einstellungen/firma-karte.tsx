"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import type { FirmaEinstellungenAnsicht } from "@/lib/einstellungen-uebersicht";
import { Abschnitt, useSpeichern } from "./abschnitt";
import { FirmaBewertung } from "./firma-bewertung";
import { FirmaPakete } from "./firma-pakete";
import { FirmaPortal } from "./firma-portal";
import { FirmaZahlung } from "./firma-zahlung";
import { FirmaZeitposten } from "./firma-zeitposten";
import { Rueckfrage } from "./rueckfrage";
import { TEXT, type RueckfrageArt } from "./texte";

const MARKE_TEXT = { kottke: "Kottke", ceylan: "Ceylan" } as const;

/** Einsatz (Plan 12b): Mietanteil im Preis. Sätze und Mitarbeiter auf /app/mitarbeiter. */
function FirmaEinsatz({
  firma,
  portalZiel,
  onGespeichert,
}: {
  firma: FirmaEinstellungenAnsicht;
  portalZiel: HTMLElement | undefined;
  onGespeichert: () => Promise<void>;
}) {
  const [an, setAn] = useState(firma.einsatz.buchungImPreis);
  const [frage, setFrage] = useState<RueckfrageArt[] | null>(null);
  const s = useSpeichern(onGespeichert);
  useEffect(() => setAn(firma.einsatz.buchungImPreis), [firma.einsatz.buchungImPreis]);

  const senden = () =>
    void s.speichern(() =>
      apiAufruf(`/api/v1/einsatz/firmen/${encodeURIComponent(firma.id)}`, jsonAufruf("PUT", { buchungImPreis: an })),
    );

  return (
    <>
      <Abschnitt
        titel={TEXT.einsatz}
        satz={
          <>
            {TEXT.mietanteilSatz} <Link href="/app/mitarbeiter">{TEXT.mitarbeiter}</Link>.
          </>
        }
        aktiv={!s.laeuft && an !== firma.einsatz.buchungImPreis}
        laeuft={s.laeuft}
        fehler={s.fehler}
        onSpeichern={() => (an ? setFrage(["mietanteil"]) : senden())}
        kinder={
          <label className="einst-schalter-zeile">
            <GlassSwitch
              size="sm"
              checked={an}
              disabled={s.laeuft}
              onCheckedChange={setAn}
              aria-label={`${TEXT.mietanteil}, ${firma.name}`}
            />
            <span>{TEXT.mietanteil}</span>
          </label>
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

/** Eine Karte je Firma (Entscheidung 7), jeder Abschnitt speichert für sich. */
export function FirmaKarte({
  firma,
  portalZiel,
  onGespeichert,
}: {
  firma: FirmaEinstellungenAnsicht;
  portalZiel: HTMLElement | undefined;
  onGespeichert: () => Promise<void>;
}) {
  return (
    <GlassPanel variant="panel" className="einst-firma" id={`firma-${firma.id}`}>
      <div className="einst-firma-kopf">
        <h2>{firma.name}</h2>
        <p className="einst-satz">
          {TEXT.marke}: {firma.marke ? MARKE_TEXT[firma.marke] : TEXT.markeGemeinsam}. {TEXT.markeSatz}
        </p>
      </div>
      <div className="einst-firma-raster">
        <FirmaZahlung firma={firma} portalZiel={portalZiel} onGespeichert={onGespeichert} />
        <FirmaPortal firma={firma} portalZiel={portalZiel} onGespeichert={onGespeichert} />
        <FirmaBewertung firma={firma} portalZiel={portalZiel} onGespeichert={onGespeichert} />
        <FirmaEinsatz firma={firma} portalZiel={portalZiel} onGespeichert={onGespeichert} />
        <FirmaPakete firma={firma} onGespeichert={onGespeichert} />
        <FirmaZeitposten firma={firma} onGespeichert={onGespeichert} />
      </div>
    </GlassPanel>
  );
}
