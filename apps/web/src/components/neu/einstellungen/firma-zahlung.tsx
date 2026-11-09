"use client";

import { useEffect, useState } from "react";
import { GlassInput } from "@/components/glassyui/glass-input";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { zahlungsregelText, type FirmaEinstellungenAnsicht } from "@/lib/einstellungen-uebersicht";
import { Abschnitt, useSpeichern } from "./abschnitt";
import {
  speichernAktiv,
  zahlungAusEntwurf,
  zahlungEntwurfAus,
  zahlungRueckfrage,
  type ZahlungEntwurf,
} from "./einstellungen-logik";
import { Rueckfrage } from "./rueckfrage";
import { TEXT, type RueckfrageArt } from "./texte";

const FELD_TEXT: Record<keyof ZahlungEntwurf, string> = {
  basis: TEXT.zahlungBasis,
  tage: `${TEXT.zahlungTage}: ganze Zahl von 0 bis 60.`,
  erinnerungModus: TEXT.zahlungErinnerung,
  erinnerungTage: `${TEXT.zahlungErste}: ganze Zahl von 1 bis 60.`,
  erinnerung2Tage: `${TEXT.zahlungZweite}: ganze Zahl von 1 bis 60.`,
};

/** (a) Zahlung: Basis, Tage, Erinnerung (Plan 9), gespeichert über `PUT company-settings`. */
export function FirmaZahlung({
  firma,
  portalZiel,
  onGespeichert,
}: {
  firma: FirmaEinstellungenAnsicht;
  portalZiel: HTMLElement | undefined;
  onGespeichert: () => Promise<void>;
}) {
  const gespeichert = zahlungEntwurfAus(firma.zahlung);
  const [e, setE] = useState<ZahlungEntwurf>(gespeichert);
  const [frage, setFrage] = useState<RueckfrageArt[] | null>(null);
  const s = useSpeichern(onGespeichert);
  const schluessel = JSON.stringify(firma.zahlung);
  useEffect(() => setE(zahlungEntwurfAus(JSON.parse(schluessel))), [schluessel]);

  const geprueft = zahlungAusEntwurf(e);
  const hinweis = geprueft.ok ? null : FELD_TEXT[geprueft.feld];
  const aktiv = speichernAktiv(gespeichert, e, hinweis, s.laeuft);

  function senden() {
    if (!geprueft.ok) return;
    void s.speichern(() =>
      apiAufruf(`/api/v1/company-settings/${encodeURIComponent(firma.id)}`, jsonAufruf("PUT", { zahlung: geprueft.regel })),
    );
  }

  function klick() {
    if (!geprueft.ok) return;
    const art = zahlungRueckfrage(firma.zahlung, geprueft.regel);
    if (art) setFrage([art]);
    else senden();
  }

  const setz = (k: keyof ZahlungEntwurf) => (ev: React.ChangeEvent<HTMLInputElement>) => setE({ ...e, [k]: ev.target.value });

  return (
    <>
      <Abschnitt
        titel={TEXT.zahlung}
        satz={geprueft.ok ? zahlungsregelText(geprueft.regel) : zahlungsregelText(firma.zahlung)}
        aktiv={aktiv}
        laeuft={s.laeuft}
        fehler={s.fehler}
        hinweis={hinweis}
        onSpeichern={klick}
        kinder={
          <div className="einst-raster">
            <div className="einst-feld">
              <span className="einst-label" id={`basis-${firma.id}`}>
                {TEXT.zahlungBasis}
              </span>
              <GlassSegmentedControl
                value={e.basis}
                onValueChange={(v) => (v === "umzugstag" || v === "rechnungstag") && setE({ ...e, basis: v })}
                aria-labelledby={`basis-${firma.id}`}
              >
                <GlassSegmentedControlItem value="umzugstag">{TEXT.zahlungBasisUmzug}</GlassSegmentedControlItem>
                <GlassSegmentedControlItem value="rechnungstag">{TEXT.zahlungBasisRechnung}</GlassSegmentedControlItem>
              </GlassSegmentedControl>
            </div>
            <div className="einst-feld einst-feld-zahl">
              <GlassInput
                label={TEXT.zahlungTage}
                inputMode="numeric"
                value={e.tage}
                onChange={setz("tage")}
                aria-invalid={!geprueft.ok && geprueft.feld === "tage"}
              />
            </div>
            <div className="einst-feld">
              <span className="einst-label" id={`erinnerung-${firma.id}`}>
                {TEXT.zahlungErinnerung}
              </span>
              <GlassSegmentedControl
                value={e.erinnerungModus}
                onValueChange={(v) => (v === "aus" || v === "entwurf") && setE({ ...e, erinnerungModus: v })}
                aria-labelledby={`erinnerung-${firma.id}`}
              >
                <GlassSegmentedControlItem value="aus">{TEXT.zahlungErinnerungAus}</GlassSegmentedControlItem>
                <GlassSegmentedControlItem value="entwurf">{TEXT.zahlungErinnerungEntwurf}</GlassSegmentedControlItem>
              </GlassSegmentedControl>
            </div>
            <div className="einst-feld einst-feld-zahl">
              <GlassInput
                label={TEXT.zahlungErste}
                inputMode="numeric"
                value={e.erinnerungTage}
                onChange={setz("erinnerungTage")}
                disabled={e.erinnerungModus === "aus"}
                aria-invalid={!geprueft.ok && geprueft.feld === "erinnerungTage"}
              />
            </div>
            <div className="einst-feld einst-feld-zahl">
              <GlassInput
                label={TEXT.zahlungZweite}
                inputMode="numeric"
                value={e.erinnerung2Tage}
                onChange={setz("erinnerung2Tage")}
                disabled={e.erinnerungModus === "aus"}
                aria-invalid={!geprueft.ok && geprueft.feld === "erinnerung2Tage"}
              />
            </div>
          </div>
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
