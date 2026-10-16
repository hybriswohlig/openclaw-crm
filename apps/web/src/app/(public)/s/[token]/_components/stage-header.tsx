"use client";

import { Check } from "lucide-react";
import { festangebotStatusStep, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { portalOfferView } from "./portal-presentation";

const FESTANGEBOT_STEPS = [
  ["angebot", "Angebot"],
  ["annahme", "Annahme"],
  ["bestaetigung", "Bestätigung"],
  ["umzug", "Umzug"],
] as const;

export function StageHeader({ ctx }: { ctx: CustomerPortalContext }) {
  if (portalOfferView(ctx) === "festangebot") return <FestangebotHeader ctx={ctx} />;
  const stages = [
    ["Kostenvoranschlag", "Angebot"],
    ["Auftragsbestätigung", "Bestätigung"],
    ["Während des Umzugs", "Umzug"],
    ["Nach dem Umzug", "Abschluss"],
  ];
  return (
    <header className="portal-header">
      <div className="portal-header-top">
        <div className="portal-logo">
          {ctx.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ctx.branding.logoUrl} alt={ctx.branding.displayName} />
          ) : <span>{ctx.branding.displayName}</span>}
        </div>
        <div className="portal-heading">
          <h1>Ihr Auftrag · {ctx.dealNumber}</h1>
          <p>{ctx.customerDisplayName ? `${ctx.customerDisplayName}, hier` : "Hier"} sehen Sie alle Details zu Ihrem Umzug, den aktuellen Stand und Ihre Dokumente.</p>
        </div>
        <p className="portal-header-note">{ctx.branding.displayName}<br /><span>Ihr persönliches Kundenportal</span></p>
      </div>
      <ol className="portal-progress" aria-label="Fortschritt Ihres Auftrags">
        {stages.map(([title, short], i) => {
          const n = i + 1;
          const state = n < ctx.stage ? "done" : n === ctx.stage ? "active" : "future";
          return <li key={title} data-state={state} aria-current={state === "active" ? "step" : undefined}>
            <span className="portal-step-number">{state === "done" ? <Check size={17} aria-hidden /> : n}</span>
            <span className="portal-step-title"><span className="hidden sm:inline">{title}</span><span className="sm:hidden">{short}</span></span>
            <span className="portal-step-status">{state === "done" ? "Abgeschlossen" : state === "active" ? "Aktuell" : "Ausstehend"}</span>
          </li>;
        })}
      </ol>
    </header>
  );
}

function FestangebotHeader({ ctx }: { ctx: CustomerPortalContext }) {
  const current = festangebotStatusStep({ accepted: !!ctx.acceptance, stage: ctx.stage });
  const currentIndex = FESTANGEBOT_STEPS.findIndex(([id]) => id === current);
  const label = FESTANGEBOT_STEPS[currentIndex]?.[1] ?? "Angebot";
  return (
    <header className="portal-header portal-header-fest">
      <div className="portal-header-top">
        <div className="portal-logo">
          {ctx.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ctx.branding.logoUrl} alt={ctx.branding.displayName} />
          ) : <span>{ctx.branding.displayName}</span>}
        </div>
        <div className="portal-heading">
          <h1>Auftrag {ctx.dealNumber}</h1>
        </div>
        <p className="portal-header-status">Status: {label}</p>
      </div>
      <ol className="portal-progress" aria-label="Fortschritt Ihres Auftrags">
        {FESTANGEBOT_STEPS.map(([id, title], i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "future";
          return (
            <li key={id} data-state={state} aria-current={state === "active" ? "step" : undefined}>
              <span className="portal-step-number">{state === "done" ? <Check size={17} aria-hidden /> : i + 1}</span>
              <span className="portal-step-title">{title}</span>
              <span className="portal-step-status">{state === "done" ? "Abgeschlossen" : state === "active" ? "Aktuell" : "Ausstehend"}</span>
            </li>
          );
        })}
      </ol>
    </header>
  );
}
