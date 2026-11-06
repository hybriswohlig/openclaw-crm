"use client";

import { Check } from "lucide-react";
import { festangebotStatusStep, kundenText, logoFuer, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { worte } from "./leistung-worte";
import { portalOfferView } from "./portal-presentation";
import { stempel, vorgangsSchritte } from "./brief";

/** Der letzte Schritt heißt wie die Leistung (Umzug, Montage, Entrümpelung). */
const FESTANGEBOT_STEPS = ["angebot", "annahme", "bestaetigung", "umzug"] as const;
const festangebotTitel = (stufe: string) => ["Angebot", "Annahme", "Bestätigung", stufe];
const stufenTitel = (stufe: string) => ["Angebot", "Bestätigung", stufe, "Abschluss"];

/** Briefkopf: Logo, Auftragsnummer, orange Linie und die Schritte als Wortzeile. */
export function StageHeader({ ctx }: { ctx: CustomerPortalContext }) {
  const fest = portalOfferView(ctx) === "festangebot";
  const w = worte(ctx);
  const logo = logoFuer(ctx.branding, ctx.annahmeRecht.serviceType);
  const angenommen = stempel({ signedAt: ctx.acceptance?.signedAt ?? null, unterschriftAt: null })[0]?.datum ?? null;
  const schritte = fest
    ? vorgangsSchritte({
        titel: festangebotTitel(w.stufe),
        aktuellIndex: FESTANGEBOT_STEPS.indexOf(festangebotStatusStep({ accepted: !!ctx.acceptance, stage: ctx.stage })),
        angenommenAm: angenommen,
      })
    : vorgangsSchritte({ titel: stufenTitel(w.stufe), aktuellIndex: ctx.stage - 1, angenommenAm: null });

  return (
    <header className="portal-header portal-briefkopf">
      <div className="portal-briefkopf-zeile">
        <div className="portal-logo">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={ctx.branding.displayName} />
          ) : (
            <span className="portal-display">{ctx.branding.displayName}</span>
          )}
        </div>
        <h1 className="portal-briefkopf-auftrag">Auftrag {ctx.dealNumber}</h1>
      </div>
      <div className="portal-briefkopf-linie" aria-hidden />
      {!fest && (
        <p className="portal-briefkopf-intro">
          {kundenText(
            ctx.branding.firmaSlug,
            `${ctx.customerDisplayName ? `${ctx.customerDisplayName}, hier` : "Hier"} sehen Sie alle Details zu ${w.deinDat}, den aktuellen Stand und Ihre Dokumente.`,
            `${ctx.customerDisplayName ? `${ctx.customerDisplayName}, hier` : "Hier"} siehst du alle Details zu ${w.deinDat}, den aktuellen Stand und deine Dokumente.`,
          )}
        </p>
      )}
      <ol className="portal-progress portal-vorgang" aria-label={kundenText(ctx.branding.firmaSlug, "Fortschritt Ihres Auftrags", "Fortschritt deines Auftrags")}>
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
