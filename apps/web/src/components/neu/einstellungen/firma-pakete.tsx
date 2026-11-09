"use client";

import { useEffect, useState } from "react";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { hebelUmschalten, type FirmaEinstellungenAnsicht, type PaketAnsicht } from "@/lib/einstellungen-uebersicht";
import { PAKET_HEBEL, PAKET_HEBEL_LABEL } from "@/lib/paket-hebel";
import { Abschnitt, useSpeichern } from "./abschnitt";
import { gleich, speichernAktiv } from "./einstellungen-logik";
import { TEXT } from "./texte";

/** (e) Pakete und Hebel: je Paket aktiv und vier Hebel-Chips. Anlegen und Texte nur alte Seite. */
export function FirmaPakete({ firma, onGespeichert }: { firma: FirmaEinstellungenAnsicht; onGespeichert: () => Promise<void> }) {
  const [e, setE] = useState<PaketAnsicht[]>(firma.pakete);
  const s = useSpeichern(onGespeichert);
  const schluessel = JSON.stringify(firma.pakete);
  useEffect(() => setE(JSON.parse(schluessel) as PaketAnsicht[]), [schluessel]);

  const aktiv = speichernAktiv(firma.pakete, e, null, s.laeuft);
  const setze = (id: string, f: (p: PaketAnsicht) => PaketAnsicht) => setE(e.map((p) => (p.id === id ? f(p) : p)));

  function klick() {
    const geaendert = e.filter((p) => !gleich(p, firma.pakete.find((v) => v.id === p.id)));
    void s.speichern(async () => {
      const ergebnisse = [];
      for (const p of geaendert) {
        ergebnisse.push(
          await apiAufruf(
            `/api/v1/customer-portal-settings/${encodeURIComponent(firma.id)}/packages/${encodeURIComponent(p.id)}`,
            jsonAufruf("PATCH", { active: p.aktiv, hebel: p.hebel }),
          ),
        );
      }
      return ergebnisse;
    });
  }

  return (
    <Abschnitt
      titel={TEXT.pakete}
      satz={TEXT.paketeSatz}
      aktiv={aktiv}
      laeuft={s.laeuft}
      fehler={s.fehler}
      onSpeichern={klick}
      ohneKnopf={firma.pakete.length === 0}
      kinder={
        e.length === 0 ? (
          <p className="einst-leer">{TEXT.paketeLeer}</p>
        ) : (
          <ul className="einst-pakete">
            {e.map((p) => (
              <li key={p.id} className="einst-paket" data-aus={!p.aktiv || undefined}>
                <label className="einst-schalter-zeile">
                  <GlassSwitch
                    size="sm"
                    checked={p.aktiv}
                    disabled={s.laeuft}
                    onCheckedChange={(an) => setze(p.id, (x) => ({ ...x, aktiv: an }))}
                    aria-label={`${p.name} ${TEXT.paketAktiv}`}
                  />
                  <span className="einst-paket-name">{p.name}</span>
                </label>
                <div className="einst-chips" role="group" aria-label={`Hebel ${p.name}`}>
                  {PAKET_HEBEL.map((h) => {
                    const an = p.hebel.includes(h);
                    return (
                      <button
                        key={h}
                        type="button"
                        className="einst-chip"
                        aria-pressed={an}
                        disabled={s.laeuft}
                        onClick={() => setze(p.id, (x) => ({ ...x, hebel: hebelUmschalten(x.hebel, h, !an) }))}
                      >
                        {PAKET_HEBEL_LABEL[h]}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )
      }
    />
  );
}
