"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSegmentedControl, GlassSegmentedControlItem } from "@/components/glassyui/glass-segmented-control";
import { apiAufruf, jsonAufruf } from "@/components/neu/akte/api";
import {
  DARSTELLUNG_LABEL,
  DARSTELLUNGEN,
  darstellungPruefen,
  kalenderAboUrl,
  webcalUrl,
  type Darstellung,
  type EinstellungenAntwort,
} from "@/lib/einstellungen-uebersicht";
import { datumText, firmaKurz } from "./einstellungen-logik";
import { Rueckfrage } from "./rueckfrage";
import { TEXT, type RueckfrageArt } from "./texte";

/**
 * „Für mich“ (Entscheidung 10): Darstellung (wirksam mit Plan 14) und
 * Kalender-Abo. Speichert sofort, beides betrifft nur den eigenen Zugang.
 */
export function FuerMich({
  ich,
  firmen,
  portalZiel,
  onGespeichert,
}: {
  ich: EinstellungenAntwort["ich"];
  firmen: { id: string; name: string }[];
  portalZiel: HTMLElement | undefined;
  onGespeichert: () => Promise<void>;
}) {
  const [darstellung, setDarstellung] = useState<Darstellung>(ich.darstellung);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [frage, setFrage] = useState<RueckfrageArt | null>(null);
  const [firmaId, setFirmaId] = useState<string>("alle");
  const [origin, setOrigin] = useState("");
  useEffect(() => setDarstellung(ich.darstellung), [ich.darstellung]);
  useEffect(() => setOrigin(window.location.origin), []);

  async function darstellungSetzen(v: string) {
    const neu = darstellungPruefen(v);
    if (!neu || neu === darstellung) return;
    const vorher = darstellung;
    setDarstellung(neu);
    setLaeuft("darstellung");
    const r = await apiAufruf(`/api/v1/me/ansichten/darstellung`, jsonAufruf("PUT", neu));
    setLaeuft(null);
    if (!r.ok) {
      setDarstellung(vorher);
      toast.error(TEXT.nichtGespeichert, { description: r.message });
      return;
    }
    toast.success(TEXT.gespeichert);
  }

  async function kalender(methode: "POST" | "DELETE", pfad = "/api/v1/calendar/subscription") {
    setLaeuft("kalender");
    const r = await apiAufruf(pfad, { method: methode });
    if (!r.ok) toast.error(TEXT.nichtGespeichert, { description: r.message });
    await onGespeichert();
    setLaeuft(null);
  }

  const url = ich.kalender.pfad && origin ? kalenderAboUrl(origin, ich.kalender.pfad, firmaId === "alle" ? null : firmaId) : null;

  async function kopieren() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(TEXT.kalenderKopiert);
    } catch {
      toast.error("Kopieren nicht möglich. Bitte den Link markieren und kopieren.");
    }
  }

  return (
    <section className="einst-bereich" aria-labelledby="einst-ich">
      <h2 className="einst-bereich-titel" id="einst-ich">
        {TEXT.abschnittIch}
      </h2>
      <div className="einst-ich">
        <GlassPanel variant="panel" className="einst-karte" id="darstellung">
          <h3>{TEXT.darstellung}</h3>
          <GlassSegmentedControl
            value={darstellung}
            onValueChange={(v) => void darstellungSetzen(v)}
            aria-label={TEXT.darstellung}
            aria-busy={laeuft === "darstellung" || undefined}
          >
            {DARSTELLUNGEN.map((d) => (
              <GlassSegmentedControlItem key={d} value={d} disabled={laeuft === "darstellung"}>
                {DARSTELLUNG_LABEL[d]}
              </GlassSegmentedControlItem>
            ))}
          </GlassSegmentedControl>
          <p className="einst-satz">{TEXT.darstellungSatz}</p>
        </GlassPanel>

        <GlassPanel variant="panel" className="einst-karte" id="kalender" aria-busy={laeuft === "kalender" || undefined}>
          <h3>{TEXT.kalender}</h3>
          <p className="einst-satz">{TEXT.kalenderSatz}</p>
          {!ich.kalender.pfad ? (
            <div>
              <GlassButton type="button" size="sm" disabled={laeuft === "kalender"} onClick={() => void kalender("POST")}>
                {TEXT.kalenderErstellen}
              </GlassButton>
            </div>
          ) : (
            <>
              {firmen.length > 1 ? (
                <GlassSegmentedControl value={firmaId} onValueChange={setFirmaId} aria-label="Termine welcher Firma">
                  <GlassSegmentedControlItem value="alle">{TEXT.kalenderAlle}</GlassSegmentedControlItem>
                  {firmen.map((f) => (
                    <GlassSegmentedControlItem key={f.id} value={f.id}>
                      {firmaKurz(f.name)}
                    </GlassSegmentedControlItem>
                  ))}
                </GlassSegmentedControl>
              ) : null}
              <code className="einst-link">{url ?? "…"}</code>
              <div className="einst-knoepfe">
                <GlassButton type="button" size="sm" onClick={() => void kopieren()} disabled={!url}>
                  {TEXT.kalenderKopieren}
                </GlassButton>
                <GlassButton type="button" size="sm" variant="ghost" asChild>
                  <a href={url ? webcalUrl(url) : undefined}>{TEXT.kalenderOeffnen}</a>
                </GlassButton>
                <GlassButton type="button" size="sm" variant="ghost" disabled={laeuft === "kalender"} onClick={() => setFrage("kalenderNeu")}>
                  {TEXT.kalenderNeu}
                </GlassButton>
                <GlassButton type="button" size="sm" variant="ghost" disabled={laeuft === "kalender"} onClick={() => setFrage("kalenderEnde")}>
                  {TEXT.kalenderEnde}
                </GlassButton>
              </div>
              {ich.kalender.erstelltAm ? (
                <p className="einst-satz">
                  {TEXT.kalenderSeit} {datumText(ich.kalender.erstelltAm)}.
                </p>
              ) : null}
            </>
          )}
        </GlassPanel>
      </div>
      <Rueckfrage
        arten={frage ? [frage] : null}
        portalZiel={portalZiel}
        onNein={() => setFrage(null)}
        onJa={() => {
          const art = frage;
          setFrage(null);
          if (art === "kalenderNeu") void kalender("POST", "/api/v1/calendar/subscription/regenerate");
          if (art === "kalenderEnde") void kalender("DELETE");
        }}
      />
    </section>
  );
}
