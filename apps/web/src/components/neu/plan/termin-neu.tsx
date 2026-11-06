"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useEffect, useId, useState } from "react";
import { GlassButton } from "@/components/glassyui/glass-button";
import {
  GlassDialog,
  GlassDialogContent,
  GlassDialogDescription,
  GlassDialogTitle,
} from "@/components/glassyui/glass-dialog";
import { GlassInput } from "@/components/glassyui/glass-input";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { apiAufruf } from "@/components/neu/akte/api";
import type { LeadKarte, LeadsListe } from "@/lib/leads-board";
import { berlinZeitZuIso, type PlanBesichtigungFeld } from "@/lib/plan-heute";
import { DEAL_SUCHE_MAX, besichtigungZug, dealSucheUrl, festlegenZug, type Schreibzug } from "./plan-logik";

type Art = "angebote" | "festlegen" | "besichtigung";

const ART_TITEL: Record<Art, string> = {
  angebote: "Terminangebote an den Kunden",
  festlegen: "Umzugstermin festlegen",
  besichtigung: "Besichtigung eintragen",
};

type Suche = { art: "leer" } | { art: "laden" } | { art: "fehler"; meldung: string } | { art: "fertig"; treffer: LeadKarte[] };

/**
 * „+ Termin“ (Entscheidung 9): Menü mit drei Punkten, jeweils erst den Deal
 * wählen (Suche über `GET /api/v1/leads/liste?q=`, ab 2 Zeichen, 10 Treffer).
 * „Terminangebote“ öffnet `TerminDialogAlt`; „Umzugstermin festlegen“ und
 * „Besichtigung eintragen“ (nur mit `besichtigungFeld`) wählen den Tag und
 * geben den Zug an den Plan, der dieselbe Rückfrage wie beim Ziehen zeigt.
 */
export function TerminNeu({
  heute,
  besichtigungFeld,
  portalZiel,
  onZug,
  onAngebote,
}: {
  heute: string;
  besichtigungFeld: PlanBesichtigungFeld | null;
  portalZiel: HTMLElement | undefined;
  onZug: (zug: Schreibzug) => void;
  onAngebote: (dealId: string) => void;
}) {
  const [art, setArt] = useState<Art | null>(null);
  const arten: Art[] = besichtigungFeld ? ["angebote", "festlegen", "besichtigung"] : ["angebote", "festlegen"];

  return (
    <>
      <Menu.Root modal={false}>
        <Menu.Trigger asChild>
          <GlassButton>+ Termin</GlassButton>
        </Menu.Trigger>
        <Menu.Portal container={portalZiel}>
          <Menu.Content asChild align="end" sideOffset={8} collisionPadding={12}>
            <GlassPanel elevation="raised" lens preset="prominent" refraction="none" variant="card" className="lg-menu-content leiste-menue">
              {/* Der Dialog öffnet erst nach dem Schließen des Menüs, sonst bleibt der Fokus unter aria-hidden. */}
              <Menu.Label className="lg-menu-label">Neuer Termin</Menu.Label>
              {arten.map((a) => (
                <Menu.Item key={a} className="lg-menu-item leiste-menue-eintrag" onSelect={() => window.setTimeout(() => setArt(a), 0)}>
                  {ART_TITEL[a]}
                </Menu.Item>
              ))}
            </GlassPanel>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {art ? (
        <TerminNeuDialog
          key={art}
          art={art}
          heute={heute}
          besichtigungFeld={besichtigungFeld}
          portalZiel={portalZiel}
          onSchliessen={() => setArt(null)}
          onZug={(z) => {
            setArt(null);
            onZug(z);
          }}
          onAngebote={(id) => {
            setArt(null);
            onAngebote(id);
          }}
        />
      ) : null}
    </>
  );
}

function TerminNeuDialog({
  art,
  heute,
  besichtigungFeld,
  portalZiel,
  onSchliessen,
  onZug,
  onAngebote,
}: {
  art: Art;
  heute: string;
  besichtigungFeld: PlanBesichtigungFeld | null;
  portalZiel: HTMLElement | undefined;
  onSchliessen: () => void;
  onZug: (zug: Schreibzug) => void;
  onAngebote: (dealId: string) => void;
}) {
  const sucheId = useId();
  const tagId = useId();
  const zeitId = useId();
  const [frage, setFrage] = useState("");
  const [suche, setSuche] = useState<Suche>({ art: "leer" });
  const [deal, setDeal] = useState<LeadKarte | null>(null);
  const [ziel, setZiel] = useState(heute);
  const [uhrzeit, setUhrzeit] = useState("");
  const [hinweis, setHinweis] = useState<string | null>(null);
  const mitZeit = art === "besichtigung" && besichtigungFeld?.typ === "timestamp";

  useEffect(() => {
    const url = dealSucheUrl(frage);
    if (!url) {
      setSuche({ art: "leer" });
      return;
    }
    const abbruch = new AbortController();
    const t = window.setTimeout(async () => {
      setSuche({ art: "laden" });
      const r = await apiAufruf<LeadsListe>(url, { signal: abbruch.signal });
      if (abbruch.signal.aborted) return;
      setSuche(r.ok ? { art: "fertig", treffer: r.data.zeilen.slice(0, DEAL_SUCHE_MAX) } : { art: "fehler", meldung: r.message });
    }, 250);
    return () => {
      window.clearTimeout(t);
      abbruch.abort();
    };
  }, [frage]);

  function waehlen(k: LeadKarte) {
    if (art === "angebote") return onAngebote(k.id);
    setDeal(k);
    if (art === "festlegen" && k.termin && k.termin >= heute) setZiel(k.termin);
  }

  function weiter(e: React.FormEvent) {
    e.preventDefault();
    if (!deal) return;
    const r =
      art === "besichtigung" && besichtigungFeld
        ? besichtigungZug({ dealId: deal.id, name: deal.name }, besichtigungFeld, ziel, uhrzeit, mitZeit ? berlinZeitZuIso(ziel, uhrzeit) : null)
        : festlegenZug({ dealId: deal.id, name: deal.name, termin: deal.termin, annahmeAm: deal.fakten.annahmeAm }, ziel, heute);
    if ("zug" in r) onZug(r.zug);
    else setHinweis(r.hinweis);
  }

  return (
    <GlassDialog open onOpenChange={(o) => !o && onSchliessen()}>
      <GlassDialogContent container={portalZiel} closeLabel="Schließen" className="plan-dialog">
        <GlassDialogTitle className="akte-dialog-titel">{ART_TITEL[art]}</GlassDialogTitle>
        {deal ? (
          <>
            <GlassDialogDescription className="akte-dialog-text">
              {deal.name} · {deal.was || deal.stufe.label}
            </GlassDialogDescription>
            <form onSubmit={weiter}>
              <label className="akte-dialog-feld" htmlFor={tagId}>
                {art === "besichtigung" ? "Tag der Besichtigung" : "Umzugstag"}
                <GlassInput id={tagId} type="date" min={heute} required value={ziel} onChange={(e) => setZiel(e.target.value)} />
              </label>
              {mitZeit ? (
                <label className="akte-dialog-feld" htmlFor={zeitId}>
                  Uhrzeit
                  <GlassInput id={zeitId} type="time" required value={uhrzeit} onChange={(e) => setUhrzeit(e.target.value)} />
                </label>
              ) : null}
              {hinweis ? (
                <p className="akte-dialog-fehler" role="alert">
                  {hinweis}
                </p>
              ) : null}
              <div className="akte-dialog-knoepfe">
                <GlassButton type="button" variant="ghost" onClick={() => setDeal(null)}>
                  Anderer Deal
                </GlassButton>
                <GlassButton type="submit">Weiter</GlassButton>
              </div>
            </form>
          </>
        ) : (
          <>
            <GlassDialogDescription className="akte-dialog-text">Für welchen Deal? Name, Ort, Deal-Nummer oder Telefon.</GlassDialogDescription>
            <label className="akte-dialog-feld" htmlFor={sucheId}>
              Deal suchen
              <GlassInput id={sucheId} type="search" autoComplete="off" autoFocus value={frage} placeholder="mindestens 2 Zeichen" onChange={(e) => setFrage(e.target.value)} />
            </label>
            <div className="plan-suche-ergebnis" aria-live="polite">
              {suche.art === "laden" ? <p className="plan-dialog-hinweis">Sucht …</p> : null}
              {suche.art === "fehler" ? <p className="akte-dialog-fehler">{suche.meldung}</p> : null}
              {suche.art === "fertig" && suche.treffer.length === 0 ? <p className="plan-dialog-hinweis">Keine Deals gefunden.</p> : null}
              {suche.art === "fertig" && suche.treffer.length > 0 ? (
                <ul className="plan-suche-liste">
                  {suche.treffer.map((k) => (
                    <li key={k.id}>
                      <button type="button" onClick={() => waehlen(k)}>
                        <b>{k.name}</b>
                        <span>{[k.stufe.label, k.was].filter(Boolean).join(" · ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        )}
      </GlassDialogContent>
    </GlassDialog>
  );
}
