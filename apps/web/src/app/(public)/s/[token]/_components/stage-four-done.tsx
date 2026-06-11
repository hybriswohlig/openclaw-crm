"use client";

import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { PaymentSection } from "./payment-section";
import { CrewRatingSection } from "./crew-rating-section";
import { GoogleReviewButton } from "./google-review-button";

/**
 * Stage 4 — after the move. Composition:
 *   1. Friendly "we're done" header
 *   2. Final invoice document card (when uploaded; no inline PDF embed,
 *      <object type="application/pdf"> is blank on iOS Safari and in-app
 *      browsers)
 *   3. Payment widget (only when amount > 0)
 *   4. Crew rating
 *   5. Google review CTA (when configured)
 */
export function StageFourDone({
  token,
  ctx,
}: {
  token: string;
  ctx: CustomerPortalContext;
}) {
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <div className="font-medium">Der Umzug ist abgeschlossen.</div>
        <p className="mt-1 text-xs">
          {ctx.customerDisplayName
            ? `Vielen Dank für Ihr Vertrauen, ${ctx.customerDisplayName}, und einen guten Start im neuen Zuhause!`
            : "Vielen Dank für Ihr Vertrauen und einen guten Start im neuen Zuhause!"}
        </p>
      </div>

      {ctx.documents.invoiceUrl && (
        <div className="rounded-2xl border border-border/50 bg-card">
          <div className="border-b border-border/50 px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Rechnung
          </div>
          <div className="space-y-3 p-5">
            <div className="text-sm text-muted-foreground">Rechnung (PDF)</div>
            <a
              href={ctx.documents.invoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-white"
              style={{ background: `#${ctx.branding.primaryColor}` }}
            >
              PDF öffnen
            </a>
          </div>
        </div>
      )}

      {ctx.payment && ctx.payment.amountCents > 0 && (
        <PaymentSection
          token={token}
          payment={ctx.payment}
          branding={ctx.branding}
          variant="final"
        />
      )}

      <CrewRatingSection token={token} crew={ctx.crew} branding={ctx.branding} />

      {ctx.branding.googleReviewUrl && (
        <GoogleReviewButton
          url={ctx.branding.googleReviewUrl}
          primaryColor={ctx.branding.primaryColor}
        />
      )}
    </section>
  );
}
