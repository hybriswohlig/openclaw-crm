"use client";

import Link from "next/link";
import { GlassButton } from "@/components/glassyui/glass-button";
import { GlassPanel } from "@/components/glassyui/glass-panel";
import { PlanZeile } from "@/components/neu/plan/plan-zeile";
import type { HeuteAntwort } from "@/lib/plan-heute";
import { LEER_HEUTE, LEER_MORGEN, morgenTag, panelUnter, planTagLink, termineAnsicht } from "./heute-logik";

/**
 * Panels „Heute“ und „Morgen“ (Entscheidung 11): Umzüge und Besichtigungen
 * nach Uhrzeit, gleiche Ton-Regel wie im Plan. Heute mit Team, Fahrzeugtyp,
 * Strecke und Live-Stand, Morgen kompakt. Sind beide leer, ein gemeinsamer
 * Hinweis mit dem nächsten Termin der kommenden 14 Tage.
 */
export function HeuteTermine({ antwort: a }: { antwort: HeuteAntwort }) {
  const ansicht = termineAnsicht(a);
  const morgen = morgenTag(a);

  if (ansicht.art === "leer") {
    return (
      <GlassPanel variant="panel" className="akte-panel heute-panel" aria-labelledby="heute-termine-titel">
        <div className="akte-panel-kopf">
          <div>
            <h2 className="akte-panel-titel" id="heute-termine-titel">
              Heute und morgen
            </h2>
            <p className="akte-panel-unter">Umzüge und Besichtigungen</p>
          </div>
        </div>
        <div className="heute-panel-koerper heute-leer">
          <p>{ansicht.text}</p>
          {a.naechster ? (
            <Link href={a.naechster.href} className="heute-naechster">
              {ansicht.naechster}
            </Link>
          ) : null}
          <GlassButton size="sm" variant="soft" asChild>
            <Link href={planTagLink(a.naechster?.tag ?? a.tag)}>Plan öffnen</Link>
          </GlassButton>
        </div>
      </GlassPanel>
    );
  }

  return (
    <>
      <GlassPanel variant="panel" className="akte-panel heute-panel" aria-labelledby="heute-heute-titel">
        <div className="akte-panel-kopf">
          <div>
            <h2 className="akte-panel-titel" id="heute-heute-titel">
              Heute
            </h2>
            <p className="akte-panel-unter">{panelUnter(a.tag, a.heute.length)}</p>
          </div>
          <Link href={planTagLink(a.tag)} className="akte-panel-rechts heute-panel-link">
            Im Plan
          </Link>
        </div>
        <div className="heute-panel-koerper">
          {a.heute.length === 0 ? (
            <p className="heute-panel-leer">{LEER_HEUTE}</p>
          ) : (
            <ul className="heute-termine">
              {a.heute.map((t) => (
                <li key={t.id}>
                  <PlanZeile eintrag={t} live={t.live} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </GlassPanel>

      <GlassPanel variant="panel" className="akte-panel heute-panel" aria-labelledby="heute-morgen-titel">
        <div className="akte-panel-kopf">
          <div>
            <h2 className="akte-panel-titel" id="heute-morgen-titel">
              Morgen
            </h2>
            <p className="akte-panel-unter">{panelUnter(morgen, a.morgen.length)}</p>
          </div>
          <Link href={planTagLink(morgen)} className="akte-panel-rechts heute-panel-link">
            Im Plan
          </Link>
        </div>
        <div className="heute-panel-koerper">
          {a.morgen.length === 0 ? (
            <p className="heute-panel-leer">{LEER_MORGEN}</p>
          ) : (
            <ul className="heute-termine">
              {a.morgen.map((t) => (
                <li key={t.id}>
                  <PlanZeile eintrag={t} kompakt />
                </li>
              ))}
            </ul>
          )}
        </div>
      </GlassPanel>
    </>
  );
}
