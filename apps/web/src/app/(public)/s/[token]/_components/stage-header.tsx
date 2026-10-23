"use client";

import { Check } from "lucide-react";
import { festangebotStatusStep, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { portalOfferView } from "./portal-presentation";
import { stempel, vorgangsSchritte } from "./brief";

const FESTANGEBOT_STEPS = [
  ["angebot", "Angebot"],
  ["annahme", "Annahme"],
  ["bestaetigung", "Bestätigung"],
  ["umzug", "Umzug"],
] as const;

const STUFEN = ["Angebot", "Bestätigung", "Umzug", "Abschluss"] as const;

/** Briefkopf: Logo, Auftragsnummer, orange Linie und die Schritte als Wortzeile. */
export function StageHeader({ ctx }: { ctx: CustomerPortalContext }) {
  const fest = portalOfferView(ctx) === "festangebot";
  const angenommen = stempel({ signedAt: ctx.acceptance?.signedAt ?? null, unterschriftAt: null })[0]?.datum ?? null;
  const schritte = fest
    ? vorgangsSchritte({
        titel: FESTANGEBOT_STEPS.map(([, t]) => t),
        aktuellIndex: FESTANGEBOT_STEPS.findIndex(
          ([id]) => id === festangebotStatusStep({ accepted: !!ctx.acceptance, stage: ctx.stage }),
        ),
        angenommenAm: angenommen,
      })
    : vorgangsSchritte({ titel: STUFEN, aktuellIndex: ctx.stage - 1, angenommenAm: null });

  return (
    <header className="portal-header portal-briefkopf">
      <div className="portal-briefkopf-zeile">
        <div className="portal-logo">
          {ctx.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ctx.branding.logoUrl} alt={ctx.branding.displayName} />
          ) : (
            <span className="portal-display">{ctx.branding.displayName}</span>
          )}
        </div>
        <h1 className="portal-briefkopf-auftrag">Auftrag {ctx.dealNumber}</h1>
      </div>
      <div className="portal-briefkopf-linie" aria-hidden />
      {!fest && (
        <p className="portal-briefkopf-intro">
          {ctx.customerDisplayName ? `${ctx.customerDisplayName}, hier` : "Hier"} sehen Sie alle Details zu Ihrem Umzug, den
          aktuellen Stand und Ihre Dokumente.
        </p>
      )}
      <ol className="portal-progress portal-vorgang" aria-label="Fortschritt Ihres Auftrags">
        {schritte.map((s) => (
          <li key={s.titel} data-state={s.zustand} aria-current={s.zustand === "aktuell" ? "step" : undefined}>
            <span className="portal-step-title">
              {s.zustand === "erledigt" && <Check size={13} strokeWidth={3} aria-hidden />}
              {s.titel}
            </span>
            {s.datum && <span className="portal-step-status">{s.datum}</span>}
          </li>
        ))}
      </ol>
    </header>
  );
}
