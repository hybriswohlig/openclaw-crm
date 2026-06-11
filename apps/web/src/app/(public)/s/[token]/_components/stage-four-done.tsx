"use client";

import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { PaymentSection } from "./payment-section";
import { CrewRatingSection } from "./crew-rating-section";
import { GoogleReviewButton } from "./google-review-button";

/**
 * Stage 4 — after the move. Composition:
 *   1. Friendly "we're done" header
 *   2. Payment widget (only when amount > 0)
 *   3. Crew rating
 *   4. Google review CTA (when configured)
 * The invoice PDF lives in the DocumentsSection rendered by StagePortal.
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

      {ctx.payment && ctx.payment.amountCents > 0 && (
        <PaymentSection
          token={token}
          payment={ctx.payment}
          branding={ctx.branding}
          variant="final"
          markedPaidAt={ctx.customerSignals.markedPaidFinalAt}
        />
      )}

      <CrewRatingSection
        token={token}
        crew={ctx.crew}
        branding={ctx.branding}
        ratedAt={ctx.customerSignals.crewRatedAt}
      />

      {ctx.branding.googleReviewUrl && (
        <GoogleReviewButton
          url={ctx.branding.googleReviewUrl}
          primaryColor={ctx.branding.primaryColor}
        />
      )}
    </section>
  );
}
