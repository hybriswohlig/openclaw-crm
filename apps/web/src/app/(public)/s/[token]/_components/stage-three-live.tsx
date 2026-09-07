"use client";

import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { LiveMediaFeed } from "./live-media-feed";
import { HourlyClock } from "./hourly-clock";
import { DocumentsSection } from "./documents-section";
import { OrderDetails, MoveFacts, ContactPanel, CrewPanel } from "./portal-ui";
import { recordedMoveStatus } from "./portal-presentation";
import { PortalRequestForm } from "./portal-request-form";

export function StageThreeLive({ token, ctx }: { token: string; ctx: CustomerPortalContext }) {
  // Live updates require explicit activation and actual recorded events.
  const liveEnabled = ctx.features?.liveTracking === true;
  const status = liveEnabled ? recordedMoveStatus(ctx.timing) : null;
  const milestones = [
    { label: "Team unterwegs", at: ctx.timing.departureAt },
    { label: "Team vor Ort", at: ctx.timing.onsiteAt },
    { label: "Umzug abgeschlossen", at: ctx.timing.finishedAt },
  ];
  return <div className="portal-stack">
    <section className="portal-panel portal-live-hero">
      <p className="portal-eyebrow">Ihr Umzug</p>
      <h2>{status ? "Ihr Umzug läuft." : "Alles Wichtige für Ihren Umzug."}</h2>
      {status ? <><p className="font-semibold">{status}</p><p>Hier sehen Sie den zuletzt erfassten Stand. Bei Fragen sind wir für Sie erreichbar.</p><ol className="portal-live-timeline" aria-label="Erfasster Umzugsstatus">{milestones.map(step => <li key={step.label} data-complete={!!step.at}><strong>{step.label}</strong><time dateTime={step.at ?? undefined}>{step.at ? new Date(step.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) + " Uhr" : "Noch nicht erfasst"}</time></li>)}</ol></> : <p>Hier finden Sie Ihren Termin, die Adressen und Ihre Unterlagen. Für Fragen zum Ablauf kontaktieren Sie uns direkt.</p>}
    </section>
    <MoveFacts ctx={ctx} />
    <div className="portal-columns">
      <div className="portal-stack">
        {status && ctx.kva?.isVariable && <HourlyClock timing={ctx.timing} kva={ctx.kva} crew={ctx.crew} primaryColor={ctx.branding.primaryColor} />}
        <CrewPanel ctx={ctx} />
        <ContactPanel ctx={ctx} token={token} title="Kontakt & Hilfe" />
        {liveEnabled && ctx.attachments.length > 0 && <LiveMediaFeed token={token} attachments={ctx.attachments} primaryColor={ctx.branding.primaryColor} />}
        <PortalRequestForm token={token} kind="damage" triggerLabel="Problem melden" title="Problem zu Ihrem Umzug melden" primaryColor={ctx.branding.primaryColor} />
        <DocumentsSection ctx={ctx} token={token} />
      </div>
      <aside><OrderDetails ctx={ctx} token={token} /></aside>
    </div>
  </div>;
}
