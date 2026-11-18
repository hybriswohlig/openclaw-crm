"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import type { CrewAnsprechpartnerAnsicht } from "@/lib/einsatz-ansicht";
import { crewAnsprechpartnerSetzen } from "./einsatz-api";

/**
 * Ansprechpartner fürs Team: wen die bestätigten Helfer bei Fragen anrufen.
 * Ohne Eintrag gilt der Standard. Sofort gespeichert; übernommen nur beim
 * Öffnen (Aufrufer setzt `key`).
 */
export function EinsatzAnsprechpartner({ dealId, wert }: { dealId: string; wert: CrewAnsprechpartnerAnsicht }) {
  const id = useId();
  const [w, setW] = useState(wert);
  const [laeuft, setLaeuft] = useState(false);
  const standardName = w.kandidaten.find((k) => k.employeeId === w.standard)?.name ?? null;

  async function setzen(body: { employeeId: string | null; alsStandard?: boolean }) {
    setLaeuft(true);
    const r = await crewAnsprechpartnerSetzen(dealId, body);
    setLaeuft(false);
    if (!r.ok) {
      toast.error("Nicht gespeichert.", { description: r.message });
      return;
    }
    if (r.data) setW(r.data);
    if (body.alsStandard) toast.success("Gilt jetzt als Standard für alle Jobs.");
  }

  const auswahl = w.eingetragen ?? "";
  return (
    <div className="ez-crew-zeile ez-ansprech">
      <label className="ez-crew-label" htmlFor={id}>
        Ansprechpartner fürs Team
      </label>
      <select
        id={id}
        value={auswahl}
        disabled={laeuft || w.kandidaten.length === 0}
        onChange={(e) => void setzen({ employeeId: e.target.value === "" ? null : e.target.value })}
      >
        <option value="">{standardName ? `Standard (${standardName})` : "Standard (keiner festgelegt)"}</option>
        {w.kandidaten.map((k) => (
          <option key={k.employeeId} value={k.employeeId}>
            {k.name}
          </option>
        ))}
      </select>
      {w.eingetragen && w.eingetragen !== w.standard ? (
        <button type="button" className="ez-crew-link" disabled={laeuft} onClick={() => void setzen({ employeeId: w.eingetragen, alsStandard: true })}>
          als Standard für alle Jobs
        </button>
      ) : null}
      {!w.gilt ? <span className="ez-crew-herkunft">Niemand mit Telefonnummer gewählt: Das Team sieht keinen Ansprechpartner.</span> : null}
    </div>
  );
}
