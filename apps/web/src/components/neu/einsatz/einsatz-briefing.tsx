"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import type { CrewBriefingAnsicht } from "@/lib/einsatz-ansicht";
import { crewBriefingAktion } from "./einsatz-api";

const VERSAND: Record<NonNullable<CrewBriefingAnsicht["team"][number]["versand"]>["status"], string> = {
  gesendet: "WhatsApp gesendet",
  fehler: "Versand fehlgeschlagen",
  kein_telefon: "keine Nummer",
  kein_link: "noch kein Portal-Link",
  kein_absender: "WhatsApp nicht verbunden",
};

const zeit = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

/**
 * Briefing fürs Crew-Portal: das bestätigte Team sieht es erst nach der Freigabe.
 * „Erneut freigeben“ nach Änderungen macht es für alle wieder neu. WhatsApp geht
 * einmal je Person und Klick vom Rümpeltürken-Konto raus. Der Stand wird nur beim
 * Öffnen übernommen (Aufrufer setzt `key`).
 */
export function EinsatzBriefing({ dealId, wert }: { dealId: string; wert: CrewBriefingAnsicht }) {
  const titelId = useId();
  const [w, setW] = useState(wert);
  const [whatsapp, setWhatsapp] = useState(true);
  const [laeuft, setLaeuft] = useState(false);

  async function aktion(body: { aktion: "freigeben"; whatsapp: boolean } | { aktion: "zurueckziehen" }) {
    setLaeuft(true);
    const r = await crewBriefingAktion(dealId, body);
    setLaeuft(false);
    if (!r.ok) {
      toast.error(body.aktion === "freigeben" ? "Nicht freigegeben." : "Nicht zurückgezogen.", { description: r.message });
      return;
    }
    if (!r.data) return;
    setW(r.data);
    if (body.aktion === "zurueckziehen") {
      toast.success("Briefing zurückgezogen. Das Team sieht es nicht mehr.");
      return;
    }
    const gesendet = r.data.team.filter((p) => p.versand?.status === "gesendet").length;
    const offen = body.whatsapp ? r.data.team.length - gesendet : 0;
    toast.success(
      body.whatsapp ? `Briefing freigegeben. WhatsApp an ${gesendet} von ${r.data.team.length}.` : "Briefing freigegeben.",
      offen > 0 ? { description: "Bei den anderen steht unten, warum nicht." } : undefined,
    );
  }

  if (w.team.length === 0) {
    return (
      <section className="ez-anfragen ez-crew ez-briefing" aria-labelledby={titelId}>
        <h3 id={titelId}>Briefing</h3>
        <p className="ez-notiz">Erst das Team bestätigen, dann lässt sich das Briefing für das Team freigeben.</p>
      </section>
    );
  }

  const frei = w.freigegebenAm !== null;
  const gelesen = w.team.filter((p) => p.gelesenAm).length;
  const mitNummer = w.team.filter((p) => p.hatTelefon).length;

  return (
    <section className="ez-anfragen ez-crew ez-briefing" aria-labelledby={titelId}>
      <h3 id={titelId}>
        Briefing
        <span className={`ez-briefing-stand${frei ? " an" : ""}`}>
          {frei ? `freigegeben ${zeit(w.freigegebenAm!)} · gelesen ${gelesen} von ${w.team.length}` : "noch nicht freigegeben"}
        </span>
      </h3>

      {frei ? (
        <ul className="ez-briefing-team">
          {w.team.map((p) => (
            <li key={p.employeeId}>
              <span className="ez-briefing-name">
                {p.name}
                {p.rolle === "lead" ? <small> · Teamleitung</small> : null}
              </span>
              <span className={`ez-briefing-chip${p.gelesenAm ? " ok" : ""}`}>{p.gelesenAm ? `gelesen ${zeit(p.gelesenAm)}` : "noch nicht gelesen"}</span>
              {p.versand ? (
                <span className={`ez-briefing-chip${p.versand.status === "gesendet" ? "" : " warn"}`}>{VERSAND[p.versand.status]}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ez-notiz">
          Gilt für das bestätigte Team. Es sieht dann Startzeit, Adressen mit Etage und Ansprechpartner, Fahrzeug, Material und die
          Sonderwünsche des Kunden. Die Barzahlung sieht nur die Teamleitung. Interne Notizen und Preise nie.
        </p>
      )}

      <div className="ez-crew-zeile">
        <label className="ez-crew-schalter ez-briefing-wa">
          <input type="checkbox" checked={whatsapp} disabled={laeuft || mitNummer === 0} onChange={(e) => setWhatsapp(e.target.checked)} />
          {mitNummer === 0 ? "per WhatsApp: niemand im Team hat eine Nummer" : `per WhatsApp an ${mitNummer} ${mitNummer === 1 ? "Person" : "Personen"} (Absender Rümpeltürken)`}
        </label>
        <GlassButton
          type="button"
          size="sm"
          className="ez-briefing-knopf"
          disabled={laeuft}
          aria-busy={laeuft || undefined}
          onClick={() => void aktion({ aktion: "freigeben", whatsapp: whatsapp && mitNummer > 0 })}
        >
          {laeuft ? "Einen Moment …" : frei ? "Erneut freigeben" : "Briefing freigeben"}
        </GlassButton>
        {frei ? (
          <button type="button" className="ez-crew-link" disabled={laeuft} onClick={() => void aktion({ aktion: "zurueckziehen" })}>
            zurückziehen
          </button>
        ) : null}
      </div>
      {frei ? <p className="ez-notiz">Nach Änderungen „Erneut freigeben“: Dann ist es für alle wieder neu und muss neu gelesen werden.</p> : null}
    </section>
  );
}
