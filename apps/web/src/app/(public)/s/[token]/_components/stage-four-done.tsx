"use client";

import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { PaymentSection } from "./payment-section";
import { CrewRatingSection } from "./crew-rating-section";
import { GoogleReviewButton } from "./google-review-button";

/**
 * Stage 4 — after the move. Composition:
 *   1. Friendly "we're done" header
 *   2. Final invoice PDF (when uploaded)
 *   3. Payment widget (only when amount > 0)
 *   4. Crew rating
 *   5. Google review CTA (when configured)
 *   6. "Coming soon: Mitarbeiter-Bewertung" placeholder for the granular flow
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
          Vielen Dank für dein Vertrauen, {ctx.customerDisplayName ?? "und einen guten Start im neuen Zuhause"}!
        </p>
      </div>

      {ctx.documents.invoiceUrl && (
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
          <div className="border-b border-border/50 px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Rechnung
          </div>
          <object
            data={ctx.documents.invoiceUrl}
            type="application/pdf"
            className="h-[60vh] w-full"
          >
            <a
              href={ctx.documents.invoiceUrl}
              className="block p-6 text-sm underline"
            >
              Rechnung herunterladen
            </a>
          </object>
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

      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-5 text-sm">
        <div className="font-medium text-muted-foreground">
          Detaillierte Bewertung · in Kürze verfügbar
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Demnächst kannst du jede:n Mitarbeiter:in separat nach Pünktlichkeit,
          Sorgfalt und Freundlichkeit bewerten.
        </p>
      </div>
    </section>
  );
}
