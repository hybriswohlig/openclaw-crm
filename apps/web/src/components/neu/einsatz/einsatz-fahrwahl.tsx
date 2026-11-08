"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import { dealLoesen, dealZuordnen, stammdatenLaden, type RechnerKlasse, type RechnerStation } from "@/components/neu/plan/buchung-api";
import type { EinsatzAnsicht } from "@/lib/einsatz-ansicht";

const GRUND = "im Einsatz festgelegt";

/**
 * 12b Entscheidung 10 im Einsatz-Dialog: Buchung zuordnen oder lösen (nur
 * Buchungen der Firma, die den Tag decken) und Station und Klasse als
 * Übersteuerung mit Grund festlegen (Auswahl aus dem Rechner; der
 * Stationsvergleich der Kalkulation hilft beim Wählen). Mit Buchung im Preis
 * kommen Station und Fahrzeug aus der Buchung.
 */
export function EinsatzFahrwahl({ ansicht, onGeaendert }: { ansicht: EinsatzAnsicht; onGeaendert: () => void | Promise<void> }) {
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [offen, setOffen] = useState(false);
  const [stamm, setStamm] = useState<{ stationen: RechnerStation[]; klassen: RechnerKlasse[] } | null>(null);
  const [station, setStation] = useState(ansicht.stationVorgabe ?? "");
  const [klasse, setKlasse] = useState(ansicht.klasseVorgabe ?? "");

  useEffect(() => {
    if (offen && !stamm) {
      void stammdatenLaden().then((r) => {
        if (r.ok) setStamm(r.data);
        else toast.error("Stationen nicht erreichbar.", { description: r.message });
      });
    }
  }, [offen, stamm]);

  async function zuordnen(id: string) {
    setLaeuft(id);
    const r = await dealZuordnen(id, ansicht.dealId);
    setLaeuft(null);
    if (!r.ok) return void toast.error("Nicht zugeordnet.", { description: r.message });
    if (r.data.warnungen.length > 0) toast.warning(r.data.warnungen.join(" "));
    await onGeaendert();
  }

  async function loesen() {
    if (!ansicht.buchung) return;
    setLaeuft("loesen");
    const r = await dealLoesen(ansicht.buchung.id, ansicht.dealId);
    setLaeuft(null);
    if (!r.ok) return void toast.error("Nicht gelöst.", { description: r.message });
    await onGeaendert();
  }

  async function vorgabeSpeichern(werte: { station: string | null; klasse: string | null }) {
    if (!ansicht.version) return;
    setLaeuft("vorgabe");
    const basis = `/api/v1/deals/${encodeURIComponent(ansicht.dealId)}/calculation/versions/${ansicht.version.nummer}/overrides`;
    let version = ansicht.version.nummer;
    for (const [key, wert] of [["station", werte.station], ["fahrzeugklasse", werte.klasse]] as const) {
      const vorher = key === "station" ? ansicht.stationVorgabe : ansicht.klasseVorgabe;
      if ((wert ?? null) === (vorher ?? null)) continue;
      const r = await apiAufruf<{ version: number; neu: boolean }>(
        basis.replace(`/versions/${ansicht.version.nummer}/`, `/versions/${version}/`),
        jsonAufruf("POST", { art: "eingabe", key, wert, grund: GRUND }),
      );
      if (!r.ok) {
        setLaeuft(null);
        return void toast.error("Vorgabe nicht gespeichert.", { description: r.message });
      }
      version = r.data.version;
    }
    setLaeuft(null);
    setOffen(false);
    toast.success("In der Kalkulation festgelegt.", { description: "Der Preis ändert sich erst nach dem Neurechnen." });
    await onGeaendert();
  }

  const ausBuchung = ansicht.buchungImPreis && ansicht.buchung !== null;
  const stationen = stamm?.stationen.filter((s) => s.aktiv) ?? [];
  const st = stationen.find((s) => s.id === station) ?? null;
  const klassen = stamm?.klassen.filter((k) => k.typ === "transporter" && k.aktiv && (!st || k.anbieter === st.anbieter)) ?? [];
  const andere = ansicht.buchungenAmTag.filter((b) => b.id !== ansicht.buchung?.id);

  return (
    <div className="ez-fahrwahl">
      {ansicht.buchung ? (
        <div className="ez-fahrwahl-zeile">
          <span>{ausBuchung ? "Station und Fahrzeug kommen aus der Buchung." : "Zugeordnet. Mietanteil im Preis ist für die Firma aus."}</span>
          <button type="button" className="ez-link" disabled={laeuft !== null} onClick={() => void loesen()}>
            Buchung lösen
          </button>
        </div>
      ) : null}
      {andere.map((b) => (
        <div key={b.id} className="ez-fahrwahl-zeile">
          <span>{b.text}</span>
          <button type="button" className="ez-link" disabled={laeuft !== null} onClick={() => void zuordnen(b.id)}>
            {ansicht.buchung ? "Stattdessen zuordnen" : "Zuordnen"}
          </button>
        </div>
      ))}
      {!ausBuchung && ansicht.version ? (
        offen ? (
          <div className="ez-fahrwahl-form">
            <label className="ma-feld">
              <span>Station</span>
              <select value={station} onChange={(e) => (setStation(e.target.value), setKlasse(""))}>
                <option value="">günstigste (Rechner wählt)</option>
                {stationen.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ma-feld">
              <span>Klasse</span>
              <select value={klasse} onChange={(e) => setKlasse(e.target.value)}>
                <option value="">Empfehlung (Rechner wählt)</option>
                {klassen.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="ma-knoepfe">
              <GlassButton type="button" size="sm" variant="ghost" onClick={() => setOffen(false)}>
                Abbrechen
              </GlassButton>
              <GlassButton type="button" size="sm" disabled={laeuft !== null} onClick={() => void vorgabeSpeichern({ station: station || null, klasse: klasse || null })}>
                In Kalkulation festlegen
              </GlassButton>
            </div>
          </div>
        ) : (
          <div className="ez-fahrwahl-zeile">
            <span>
              {ansicht.stationVorgabe || ansicht.klasseVorgabe ? "Station oder Klasse fest vorgegeben." : "Station und Klasse wählt der Rechner (günstigste)."}
            </span>
            <button type="button" className="ez-link" onClick={() => setOffen(true)}>
              {ansicht.stationVorgabe || ansicht.klasseVorgabe ? "Ändern" : "Festlegen"}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
