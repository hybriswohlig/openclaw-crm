"use client";

import "@/styles/neu-plan-zeile.css";

import Link from "next/link";
import type { PlanEintrag, PlanLive } from "@/lib/plan-heute";
import { TON_TEXT, bisText, livePille, teamLuecke, teamText, teamZeigen, zeileLabel, zeitRest, zeitSpalte } from "./plan-zeile-logik";
import { KUERZEL_FARBEN } from "@/lib/dunkel-abschaltung";

/**
 * Füllungen der Team-Kürzel nach Reihenfolge (wie die Board-Karte): dunkle
 * Tinten, auf denen weiße Schrift 4,5:1 erreicht.
 */

/**
 * Eine Zeile der Tagesansicht und der Startseite „Heute“ (Plan 8,
 * Entscheidungen 11 und 16): links die Uhrzeit, rechts Titel, Zeile
 * (`eintragZeile`, bei Gold mit Grund), darunter Team, Fahrzeugtyp, Stufe,
 * Firma. Farbe nach `ton`, die Bedeutung steht zusätzlich als Text da.
 * `live` zeigt den Stand am Einsatztag („unterwegs seit 07:12“).
 * `kompakt` (Panel „Morgen“): ohne Fußzeile. Mit `onWaehlen` öffnet der Titel
 * das Popover des Plans, und die Akte hat einen eigenen Link; ohne führt der
 * Titel direkt in die Akte.
 */
export function PlanZeile({
  eintrag: e,
  live,
  kompakt = false,
  onWaehlen,
}: {
  eintrag: PlanEintrag;
  live?: PlanLive | null;
  kompakt?: boolean;
  onWaehlen?: (e: PlanEintrag) => void;
}) {
  const rest = zeitRest(e);
  const bis = bisText(e);
  const pille = livePille(live);
  const mitTeam = teamZeigen(e);

  return (
    <article className="plan-zeile" data-ton={e.ton} data-kompakt={kompakt || undefined} aria-label={zeileLabel(e, live)}>
      <div className="plan-zeile-zeit">
        <b>{zeitSpalte(e)}</b>
        {!kompakt && rest ? <span>{rest}</span> : null}
      </div>

      <div className="plan-zeile-haupt">
        <div className="plan-zeile-kopf">
          {onWaehlen ? (
            <button type="button" className="plan-zeile-titel" onClick={() => onWaehlen(e)}>
              {e.titel}
            </button>
          ) : (
            <Link href={e.href} className="plan-zeile-titel">
              {e.titel}
            </Link>
          )}
          <span className="plan-zeile-sr">{TON_TEXT[e.ton]}</span>
          {pille ? (
            <span className="plan-zeile-live" data-live={pille.stufe}>
              <i aria-hidden="true" />
              {pille.text}
            </span>
          ) : null}
          {kompakt && mitTeam ? <Team eintrag={e} /> : null}
        </div>

        <p className="plan-zeile-text">
          {e.zeile}
          {bis ? <span className="plan-zeile-bis"> · {bis}</span> : null}
        </p>

        {kompakt ? null : (
          <div className="plan-zeile-fuss">
            {mitTeam ? (
              <span className="plan-zeile-team-zeile">
                <Team eintrag={e} />
                <span className="plan-zeile-namen">{teamText(e)}</span>
              </span>
            ) : null}
            {e.transporter ? (
              <span className="plan-zeile-wagen">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M2 7h11v9H2zM13 10h4l3 3v3h-7z" />
                  <circle cx="6" cy="17.5" r="1.8" />
                  <circle cx="16.5" cy="17.5" r="1.8" />
                </svg>
                {e.transporter}
              </span>
            ) : null}
            <span className="plan-zeile-stufe">{e.stufe.label}</span>
            {e.firma ? (
              <span className="plan-zeile-firma">
                <i style={{ background: e.firma.farbe }} aria-hidden="true" />
                {e.firma.name}
              </span>
            ) : null}
            {onWaehlen ? (
              <Link href={e.href} className="plan-zeile-akte">
                Akte öffnen
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}

function Team({ eintrag: e }: { eintrag: PlanEintrag }) {
  return (
    <span className="plan-zeile-team" role="img" aria-label={teamText(e)}>
      {e.team.map((m, i) => (
        <span key={`${m.name}-${i}`} className="plan-zeile-avatar" style={{ background: KUERZEL_FARBEN[i % KUERZEL_FARBEN.length] }} title={m.name}>
          {m.kuerzel}
        </span>
      ))}
      {teamLuecke(e) ? (
        <span className="plan-zeile-avatar plan-zeile-avatar-fehlt" title="Team unvollständig">
          ?
        </span>
      ) : null}
    </span>
  );
}
