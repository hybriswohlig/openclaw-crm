"use client";

import { Star, CreditCard } from "lucide-react";
import { kundenText, type CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { formatPortalMoney } from "./portal-presentation";
import { PaymentSection } from "./payment-section";
import { CrewRatingSection } from "./crew-rating-section";
import { GoogleReviewButton } from "./google-review-button";
import { PortalRequestForm } from "./portal-request-form";
import { DocumentsSection } from "./documents-section";
import { SuccessBanner, OrderDetails, ContactPanel, CrewPanel, CompletionSummary, PanelHeading } from "./portal-ui";

export function StageFourDone({ token, ctx }: { token: string; ctx: CustomerPortalContext }) {
  const t = (sie: string, du: string) => kundenText(ctx.branding.firmaSlug, sie, du);
  return <div className="portal-columns">
    <div className="portal-stack">
      <SuccessBanner ctx={ctx} completed />
      <div className={`grid gap-4 ${ctx.features?.payments === true ? "xl:grid-cols-2" : ""}`}>
        {(ctx.branding.googleReviewUrl || ctx.crew.length > 0) && <section className="portal-panel"><PanelHeading icon={Star} title={t("Ihre Meinung zählt!", "Deine Meinung zählt!")}><p>{t("Wie hat Ihnen unser Service gefallen? Wir freuen uns über Ihr Feedback.", "Wie hat dir unser Service gefallen? Wir freuen uns über dein Feedback.")}</p></PanelHeading>
          <CrewRatingSection token={token} crew={ctx.crew} branding={ctx.branding} ratedAt={ctx.customerSignals.crewRatedAt} leistung={ctx.leistung} />
          {ctx.branding.googleReviewUrl && <div className="mt-4"><GoogleReviewButton url={ctx.branding.googleReviewUrl} primaryColor={ctx.branding.primaryColor} /></div>}
        </section>}
        {ctx.features?.payments === true && (ctx.payment && ctx.payment.amountCents > 0 ? <PaymentSection token={token} payment={ctx.payment} branding={ctx.branding} variant="final" markedPaidAt={ctx.customerSignals.markedPaidFinalAt} serviceType={ctx.annahmeRecht.serviceType} /> : <section className="portal-panel"><PanelHeading icon={CreditCard} title="Zahlung" /><p className="text-sm text-muted-foreground">{ctx.paymentStatus?.paid ? t("Die Zahlung für Ihren Auftrag ist vollständig erfasst. Vielen Dank.", "Die Zahlung für deinen Auftrag ist vollständig erfasst. Vielen Dank.") : t("Aktuell liegt hier keine Zahlungsaufforderung vor. Bei Fragen zu Ihrer Abrechnung schreiben Sie uns gern.", "Aktuell liegt hier keine Zahlungsaufforderung vor. Bei Fragen zu deiner Abrechnung schreib uns gern.")}</p>{ctx.paymentStatus && ctx.paymentStatus.receivedCents > 0 && <p className="mt-3 text-sm">Erfasste Zahlungseingänge: {formatPortalMoney(ctx.paymentStatus.receivedCents)}</p>}</section>)}
      </div>
      <CompletionSummary ctx={ctx} />
      <DocumentsSection ctx={ctx} token={token} />
    </div>
    <aside className="portal-stack">
      <OrderDetails ctx={ctx} token={token} />
      <CrewPanel ctx={ctx} />
      <ContactPanel ctx={ctx} token={token} title="Noch etwas offen?" />
      <section className="portal-panel"><PortalRequestForm token={token} firmaSlug={ctx.branding.firmaSlug} kind="damage" triggerLabel="Schaden oder Problem melden" title="Schaden oder Problem melden" intro={t("Beschreiben Sie kurz, was passiert ist. Wir kümmern uns darum.", "Beschreibe kurz, was passiert ist. Wir kümmern uns darum.")} primaryColor={ctx.branding.primaryColor} /></section>
    </aside>
  </div>;
}
