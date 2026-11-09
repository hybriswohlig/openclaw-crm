"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { GlassSwitch } from "@/components/glassyui/glass-switch";
import { apiAufruf } from "@/components/neu/akte/api";
import { Rueckfrage } from "@/components/neu/einstellungen/rueckfrage";
import { usePortalZiel } from "@/components/neu/portal-ziel";
import { BuchungDialog } from "@/components/neu/plan/buchung-dialog";
import { buchungenLaden, firmenSchalterLaden, firmenSchalterSetzen, type BuchungVoll } from "@/components/neu/plan/buchung-api";
import { berlinDateString } from "@/lib/berlin-date";
import { NUR_ADMINS } from "@/lib/einstellungen-uebersicht";
import type { LeadFirma } from "@/lib/leads-board";
import type { PlanAntwort, PlanEintrag } from "@/lib/plan-heute";

function plus(tag: string, n: number): string {
  const [j, m, d] = tag.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(j, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Reiter „Transporter“ auf /app/mitarbeiter (12b Task P): Buchungen der
 * letzten 30 und nächsten 60 Tage, „Transporter mieten“ und je Firma der
 * Schalter „Mietanteil im Preis“ (`buchung_im_preis`, Standard aus).
 */
export function TransporterReiter() {
  const portalZiel = usePortalZiel();
  const heute = berlinDateString();
  const [liste, setListe] = useState<BuchungVoll[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [firmen, setFirmen] = useState<LeadFirma[]>([]);
  const [eintraege, setEintraege] = useState<PlanEintrag[]>([]);
  const [schalter, setSchalter] = useState<Record<string, boolean>>({});
  // Plan 13: Mietanteil ändern nur Admins; Einschalten fragt wie in den Einstellungen.
  const [darfAendern, setDarfAendern] = useState<boolean | null>(null);
  const [frage, setFrage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ art: "neu" } | { art: "ansehen"; b: BuchungVoll } | null>(null);

  const laden = useCallback(async () => {
    const [b, plan] = await Promise.all([
      buchungenLaden(plus(heute, -30), plus(heute, 60)),
      apiAufruf<PlanAntwort>(`/api/v1/plan?von=${heute}&bis=${plus(heute, 61)}`),
    ]);
    if (b.ok) {
      setListe(b.data);
      setFehler(null);
    } else setFehler(b.message);
    if (plan.ok) {
      setFirmen(plan.data.firmen);
      setEintraege(plan.data.eintraege);
      const werte = await Promise.all(plan.data.firmen.map(async (f) => [f.id, (await firmenSchalterLaden(f.id))] as const));
      setSchalter(Object.fromEntries(werte.map(([id, r]) => [id, r.ok ? r.data.buchungImPreis : false])));
      setDarfAendern(werte.some(([, r]) => r.ok && r.data.darfAendern === true));
    }
  }, [heute]);

  useEffect(() => {
    void laden();
  }, [laden]);

  async function umschalten(id: string, an: boolean) {
    setSchalter((s) => ({ ...s, [id]: an }));
    const r = await firmenSchalterSetzen(id, an);
    if (!r.ok) {
      setSchalter((s) => ({ ...s, [id]: !an }));
      toast.error("Schalter nicht gespeichert.", { description: r.message });
      return;
    }
    toast.success(an ? "Mietanteil geht ab jetzt in neue Preise ein." : "Mietanteil geht nicht mehr in neue Preise ein.", {
      description: "Gesendete Preise bleiben, wie sie sind.",
    });
  }

  const kommend = (liste ?? []).filter((b) => b.bis >= heute);
  const vorbei = (liste ?? []).filter((b) => b.bis < heute);

  return (
    <div className="ma-spalten tr-spalten">
      <GlassPanel variant="panel" className="ma-liste-panel">
        <div className="ma-abschnitt-kopf">
          <h2 className="ma-panel-titel">Transporter-Buchungen</h2>
          <GlassButton type="button" size="sm" onClick={() => setDialog({ art: "neu" })}>
            Transporter mieten
          </GlassButton>
        </div>
        {fehler ? <p className="ma-fehler">Buchungen nicht geladen. {fehler}</p> : null}
        {liste === null && !fehler ? <p className="ma-leer">Buchungen werden geladen …</p> : null}
        {liste && kommend.length === 0 ? <p className="ma-leer">Keine laufende oder kommende Buchung.</p> : null}
        <ul className="ma-liste">
          {[...kommend, ...vorbei].map((b) => (
            <li key={b.id}>
              <button type="button" className="ma-zeile" data-alt={b.bis < heute || undefined} onClick={() => setDialog({ art: "ansehen", b })}>
                <span className="ma-zeile-text">
                  <b>
                    {b.klasseName} · {firmen.find((f) => f.id === b.firmaId)?.name ?? "Firma"}
                  </b>
                  <small>{b.text}</small>
                  {b.warnungen.map((w) => (
                    <small key={w} className="tr-warnung">
                      {w}
                    </small>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </GlassPanel>

      <GlassPanel variant="panel" className="ma-panel-rahmen">
        <h2 className="ma-panel-titel">Mietanteil im Preis</h2>
        <p className="ma-hinweis tr-abstand">
          An: an Tagen mit zugeordneter Buchung rechnet die Kalkulation mit dem Anteil der Buchung (Miete ÷ geplante Aufträge) statt der
          Tagesmiete. Der Anteil wird beim Sperren eingefroren. Aus: Buchungen sind reine Planung.
        </p>
        {firmen.length === 0 ? <p className="ma-leer">Keine Firma gefunden.</p> : null}
        <ul className="ma-liste">
          {firmen.map((f) => (
            <li key={f.id} className="tr-firma">
              <GlassSwitch
                size="sm"
                checked={schalter[f.id] === true}
                disabled={darfAendern !== true}
                onCheckedChange={(an) => (an ? setFrage(f.id) : void umschalten(f.id, false))}
                aria-label={`Mietanteil im Preis für ${f.name}`}
              />
              <span>{f.name}</span>
            </li>
          ))}
        </ul>
        {firmen.length > 0 && darfAendern === false ? <p className="ma-hinweis">{NUR_ADMINS}</p> : null}
      </GlassPanel>

      <Rueckfrage
        arten={frage ? ["mietanteil"] : null}
        portalZiel={portalZiel}
        onNein={() => setFrage(null)}
        onJa={() => {
          const id = frage;
          setFrage(null);
          if (id) void umschalten(id, true);
        }}
      />

      {dialog ? (
        <BuchungDialog
          key={dialog.art === "ansehen" ? dialog.b.id : "neu"}
          modus={dialog.art === "ansehen" ? { art: "ansehen", buchung: { id: dialog.b.id, von: dialog.b.von, bis: dialog.b.bis } } : { art: "neu", von: heute }}
          firmen={firmen}
          eintraege={eintraege}
          portalZiel={portalZiel}
          onSchliessen={() => setDialog(null)}
          onGeaendert={() => void laden()}
        />
      ) : null}
    </div>
  );
}
