"use client";

import { useEffect, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassInput } from "@/components/glassyui/glass-input";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { neueZeitpostenId, type FirmaEinstellungenAnsicht } from "@/lib/einstellungen-uebersicht";
import { Abschnitt, useSpeichern } from "./abschnitt";
import {
  speichernAktiv,
  ZEITPOSTEN_MAX,
  zeitpostenAusEntwurf,
  zeitpostenEntwurfAus,
  zeitpostenVerschieben,
  type ZeitpostenEntwurf,
} from "./einstellungen-logik";
import { TEXT } from "./texte";

/** (f) Zeitposten: Liste bearbeiten, gespeichert wird die ganze Liste über `PUT company-settings`. */
export function FirmaZeitposten({ firma, onGespeichert }: { firma: FirmaEinstellungenAnsicht; onGespeichert: () => Promise<void> }) {
  const gespeichert = zeitpostenEntwurfAus(firma.zeitposten);
  const [e, setE] = useState<ZeitpostenEntwurf[]>(gespeichert);
  const s = useSpeichern(onGespeichert);
  const schluessel = JSON.stringify(firma.zeitposten);
  useEffect(() => setE(zeitpostenEntwurfAus(JSON.parse(schluessel))), [schluessel]);

  const geprueft = zeitpostenAusEntwurf(e);
  const hinweis = geprueft.ok ? null : `Zeile ${geprueft.index + 1}: ${geprueft.fehler}`;
  const aktiv = speichernAktiv(gespeichert, e, hinweis, s.laeuft);
  const setze = (i: number, feld: keyof ZeitpostenEntwurf, wert: string) =>
    setE(e.map((z, j) => (j === i ? { ...z, [feld]: wert } : z)));

  function hinzufuegen() {
    const id = neueZeitpostenId(e.map((z) => ({ id: z.id, bezeichnung: z.bezeichnung, minuten: 1 })));
    setE([...e, { id, bezeichnung: "", minuten: "", hinweis: "" }]);
  }

  return (
    <Abschnitt
      titel={TEXT.zeitposten}
      satz={TEXT.zeitpostenSatz}
      aktiv={aktiv}
      laeuft={s.laeuft}
      fehler={s.fehler}
      hinweis={hinweis}
      onSpeichern={() => {
        if (!geprueft.ok) return;
        void s.speichern(() =>
          apiAufruf(`/api/v1/company-settings/${encodeURIComponent(firma.id)}`, jsonAufruf("PUT", { zeitposten: geprueft.liste })),
        );
      }}
      kinder={
        <>
          {e.length === 0 ? <p className="einst-leer">{TEXT.zeitpostenLeer}</p> : null}
          <ol className="einst-zeitposten">
            {e.map((z, i) => (
              <li key={z.id} className="einst-zeitposten-zeile">
                <div className="einst-zp-text">
                  <GlassInput
                    aria-label={`${TEXT.zeitpostenBezeichnung} ${i + 1}`}
                    placeholder={TEXT.zeitpostenBezeichnung}
                    maxLength={80}
                    value={z.bezeichnung}
                    onChange={(ev) => setze(i, "bezeichnung", ev.target.value)}
                  />
                </div>
                <div className="einst-zp-min">
                  <GlassInput
                    aria-label={`${TEXT.zeitpostenMinuten} ${i + 1}`}
                    placeholder="Min."
                    inputMode="numeric"
                    value={z.minuten}
                    onChange={(ev) => setze(i, "minuten", ev.target.value)}
                  />
                </div>
                <div className="einst-zp-hinweis">
                  <GlassInput
                    aria-label={`${TEXT.zeitpostenHinweis} ${i + 1}`}
                    placeholder={TEXT.zeitpostenHinweis}
                    value={z.hinweis}
                    onChange={(ev) => setze(i, "hinweis", ev.target.value)}
                  />
                </div>
                <div className="einst-zp-knoepfe">
                  <button
                    type="button"
                    className="einst-icon"
                    aria-label={`${TEXT.zeitpostenHoch}: ${z.bezeichnung || i + 1}`}
                    disabled={i === 0}
                    onClick={() => setE(zeitpostenVerschieben(e, i, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="einst-icon"
                    aria-label={`${TEXT.zeitpostenRunter}: ${z.bezeichnung || i + 1}`}
                    disabled={i === e.length - 1}
                    onClick={() => setE(zeitpostenVerschieben(e, i, 1))}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="einst-icon"
                    aria-label={`${TEXT.zeitpostenEntfernen}: ${z.bezeichnung || i + 1}`}
                    onClick={() => setE(e.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div>
            <GlassButton type="button" size="sm" variant="ghost" disabled={e.length >= ZEITPOSTEN_MAX} onClick={hinzufuegen}>
              {TEXT.zeitpostenNeu}
            </GlassButton>
            {e.length >= ZEITPOSTEN_MAX ? <span className="einst-satz"> {TEXT.zeitpostenMax}</span> : null}
          </div>
        </>
      }
    />
  );
}
