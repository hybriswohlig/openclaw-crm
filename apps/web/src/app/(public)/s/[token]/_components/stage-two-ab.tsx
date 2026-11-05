"use client";

import { kundenText, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { MovingChecklist } from "./moving-checklist";
import { worte } from "./leistung-worte";
import { PortalRequestForm } from "./portal-request-form";
import { DocumentsSection } from "./documents-section";
import { OrderDetails, SuccessBanner, ContactPanel, CrewPanel } from "./portal-ui";

export function StageTwoAb({ ctx, token }: { ctx: CustomerPortalContext; token: string }) {
  return <div className="portal-columns">
    <div className="portal-stack">
      <SuccessBanner ctx={ctx} />
      <DocumentsSection ctx={ctx} token={token} preview />
      <ContactPanel ctx={ctx} token={token} />
      {worte(ctx).checkliste && <details className="portal-panel"><summary className="cursor-pointer font-semibold">{`Gut vorbereitet für ${worte(ctx).deinAkk}`}</summary><div className="mt-4"><MovingChecklist token={token} /></div></details>}
      <PortalRequestForm token={token} firmaSlug={ctx.branding.firmaSlug} kind="reschedule" triggerLabel="Terminänderung anfragen" title="Terminänderung anfragen" intro={kundenText(ctx.branding.firmaSlug, "Nennen Sie uns gern bis zu drei Wunschtermine. Wir prüfen die Verfügbarkeit und melden uns.", "Nenne uns gern bis zu drei Wunschtermine. Wir prüfen die Verfügbarkeit und melden uns.")} primaryColor={ctx.branding.primaryColor} />
    </div>
    <aside className="portal-stack"><OrderDetails ctx={ctx} token={token} /><CrewPanel ctx={ctx} /></aside>
  </div>;
}
