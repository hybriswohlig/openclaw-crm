"use client";

import { kundenText, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { LiveMediaFeed } from "./live-media-feed";
import { HourlyClock } from "./hourly-clock";
import { DocumentsSection } from "./documents-section";
import { OrderDetails, MoveFacts, ContactPanel, CrewPanel } from "./portal-ui";
import { recordedMoveStatus } from "./portal-presentation";
import { PortalRequestForm } from "./portal-request-form";
import { worte } from "./leistung-worte";

export function StageThreeLive({ token, ctx }: { token: string; ctx: CustomerPortalContext }) {
  // Live updates require explicit activation and actual recorded events.
  const liveEnabled = ctx.features?.liveTracking === true;
  const w = worte(ctx);
  const status = liveEnabled ? recordedMoveStatus(ctx.timing, w.abgeschlossen) : null;
  const milestones = [
    { label: "Team unterwegs", at: ctx.timing.departureAt },
    { label: "Team vor Ort", at: ctx.timing.onsiteAt },
    { label: w.abgeschlossen, at: ctx.timing.finishedAt },
  ];
  const t = (sie: string, du: string) => kundenText(ctx.branding.firmaSlug, sie, du);
  return <div className="portal-stack">
    <section className="portal-panel portal-live-hero">
      <p className="portal-eyebrow">{w.deinNom}</p>
      <h2>{status ? `${w.deinNom} läuft.` : `Alles Wichtige für ${w.deinAkk}.`}</h2>
      {status ? <><p className="font-semibold">{status}</p><p>{t("Hier sehen Sie den zuletzt erfassten Stand. Bei Fragen sind wir für Sie erreichbar.", "Hier siehst du den zuletzt erfassten Stand. Bei Fragen sind wir für dich erreichbar.")}</p><ol className="portal-live-timeline" aria-label="Erfasster Stand">{milestones.map(step => <li key={step.label} data-complete={!!step.at}><strong>{step.label}</strong><time dateTime={step.at ?? undefined}>{step.at ? new Date(step.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) + " Uhr" : "Noch nicht erfasst"}</time></li>)}</ol></> : <p>{t("Hier finden Sie Ihren Termin, die Adressen und Ihre Unterlagen. Für Fragen zum Ablauf kontaktieren Sie uns direkt.", "Hier findest du deinen Termin, die Adressen und deine Unterlagen. Für Fragen zum Ablauf kontaktiere uns direkt.")}</p>}
    </section>
    <MoveFacts ctx={ctx} />
    <div className="portal-columns">
      <div className="portal-stack">
        {status && ctx.kva?.isVariable && <HourlyClock timing={ctx.timing} kva={ctx.kva} crew={ctx.crew} primaryColor={ctx.branding.primaryColor} />}
        <CrewPanel ctx={ctx} />
        <ContactPanel ctx={ctx} token={token} title="Kontakt & Hilfe" />
        {liveEnabled && ctx.attachments.length > 0 && <LiveMediaFeed token={token} attachments={ctx.attachments} primaryColor={ctx.branding.primaryColor} />}
        <PortalRequestForm token={token} firmaSlug={ctx.branding.firmaSlug} kind="damage" triggerLabel="Problem melden" title={`Problem zu ${w.deinDat} melden`} primaryColor={ctx.branding.primaryColor} />
        <DocumentsSection ctx={ctx} token={token} />
      </div>
      <aside><OrderDetails ctx={ctx} token={token} /></aside>
    </div>
  </div>;
}
