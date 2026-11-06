"use client";

import type { InboxEintrag } from "@/lib/inbox-neu";
import { avatarFarbe, kompaktPille } from "./inbox-logik";

/**
 * Ein Eintrag der Liste (Mockup 8b): Kürzel mit Kanalpunkt, Name, Zeit (blau
 * bei ungelesen), Vorschau mit fettem Präfix, Pillen. `kompakt` am Handy:
 * kürzere Pillen, keine Stufe (Entscheidung 15).
 */
export function InboxEintragZeile({
  e,
  aktiv,
  kompakt,
  onWaehlen,
}: {
  e: InboxEintrag;
  aktiv: boolean;
  kompakt: boolean;
  onWaehlen: (key: string) => void;
}) {
  const wartetArt = e.wartet.auf === "uns" ? "uns" : "kunde";
  return (
    <li>
      <button
        type="button"
        className="inbox-eintrag"
        aria-current={aktiv ? "true" : undefined}
        data-gruppe={e.gruppe}
        onClick={() => onWaehlen(e.key)}
      >
        <span className="inbox-avatar" style={{ background: avatarFarbe(e.name, e.gruppe) }} aria-hidden="true">
          {e.kuerzel}
          <i className="inbox-kanalpunkt" data-kanal={e.kanal} />
        </span>
        <span className="inbox-eintrag-name">{e.name}</span>
        <span className="inbox-eintrag-zeit" data-ungelesen={e.ungelesen > 0 || undefined}>
          {e.zeitText}
        </span>
        <span className="inbox-eintrag-vorschau">
          {e.vorschauPraefix && !kompakt ? <b>{e.vorschauPraefix} </b> : null}
          {e.vorschau}
        </span>
        <span className="inbox-eintrag-pillen">
          {e.ungelesen > 0 ? (
            <span className="inbox-pille" data-art="un" aria-label={`${e.ungelesen} ungelesen`}>
              {e.ungelesen}
            </span>
          ) : null}
          {e.wartet.text ? (
            <span className="inbox-pille" data-art={wartetArt}>
              {kompakt ? kompaktPille(e.wartet.text) : e.wartet.text}
            </span>
          ) : null}
          {e.kiEntwurf ? (
            <span className="inbox-pille" data-art="ki">
              {kompakt ? kompaktPille(e.kiEntwurf.text) : e.kiEntwurf.text}
            </span>
          ) : null}
          {e.laneText ? (
            <span className="inbox-pille" data-art="stufe">
              {e.laneText}
            </span>
          ) : null}
          {e.stufe && !kompakt && !e.laneText ? (
            <span className="inbox-pille" data-art="stufe">
              {e.stufe.label}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
