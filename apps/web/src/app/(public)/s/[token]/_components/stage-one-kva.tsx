"use client";

import { useMemo, useState } from "react";
import {
  widerrufVerzichtRequired,
  type CustomerPortalContext,
} from "@openclaw-crm/customer-portal-core";
import { ConfirmKvaDialog } from "./confirm-kva-dialog";
import { ScopeSummary } from "./scope-summary";
import { PaymentSection } from "./payment-section";
import { OfferInclusionsSection } from "./offer-inclusions";
import { EmailCaptureBanner } from "./email-capture-banner";
import { PackageSelector } from "./package-selector";

/**
 * Stage 1 layout — desktop is a two-column grid with a sticky price/CTA
 * card on the right (Stripe Checkout, Tesla configurator, Booking.com
 * reference). Mobile collapses to a single column with a sticky bottom
 * bar that holds the total + accept button.
 *
 * Information order on the left column:
 *   1. Email-capture banner (when needed)
 *   2. "Was umfasst der Auftrag" (the operator-written summary, if set)
 *   3. Packages (when at least one is defined for the firma)
 *   4. Eckdaten (date, addresses, floors, volume)
 *   5. Leistungsumfang (when standard inclusions are enabled)
 *   6. Acceptance / Anzahlung
 *
 * The right rail (and mobile sticky bar) shows the total, customer name,
 * acceptance status, and the primary CTA. It's the only thing the customer
 * needs to read to make a decision.
 */
export function StageOneKva({
  token,
  ctx,
  onConfirmed,
}: {
  token: string;
  ctx: CustomerPortalContext;
  onConfirmed: () => void;
}) {
  const [open, setOpen] = useState(false);

  const widerrufNeeded = useMemo(
    () => widerrufVerzichtRequired(ctx.scope.moveDate, new Date(ctx.meta.serverTime)),
    [ctx.scope.moveDate, ctx.meta.serverTime]
  );

  if (!ctx.kva) {
    return (
      <section className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Ihr Kostenvoranschlag wird gerade erstellt. Diese Seite aktualisiert sich
        automatisch, sobald das Angebot bereitsteht. Sie können die Seite einfach
        kurz später erneut öffnen.
      </section>
    );
  }

  const alreadyAccepted = !!ctx.acceptance;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start lg:gap-10">
        {/* ── Left column: details ───────────────────────────────────── */}
        <div className="space-y-5">
          <EmailCaptureBanner
            token={token}
            status={ctx.customerEmailStatus}
            branding={ctx.branding}
          />

          {/* Operator-written summary. Calm content card so the customer reads
              context BEFORE the number. */}
          {ctx.kva.summary && ctx.kva.summary.trim().length > 0 && (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <div className="border-b px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Was umfasst der Auftrag
              </div>
              <p className="whitespace-pre-wrap p-6 text-sm leading-relaxed">
                {ctx.kva.summary}
              </p>
            </div>
          )}

          <PackageSelector packages={ctx.packages} branding={ctx.branding} />

          <ScopeSummary scope={ctx.scope} />

          <OfferInclusionsSection inclusions={ctx.inclusions} branding={ctx.branding} />

          {/* Detailed line-item breakdown (when variable / hourly). Sits at
              the bottom of the left column so the right-rail headline price
              gets the customer's attention first. */}
          {ctx.kva.isVariable && ctx.kva.lineItems.length > 0 && (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <div className="border-b px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Aufschlüsselung
              </div>
              <ul className="divide-y px-6">
                {ctx.kva.lineItems.map((li, i) => (
                  <li
                    key={i}
                    className="flex items-baseline justify-between gap-4 py-3 text-sm"
                  >
                    <div>
                      <span className="font-medium">
                        {li.description || labelForType(li.type)}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {li.quantity} × {formatEur(li.unitRate)}
                      </span>
                    </div>
                    <span className="tabular-nums">{formatEur(li.lineTotal)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {alreadyAccepted && ctx.payment && ctx.payment.amountCents > 0 && (
            <PaymentSection
              token={token}
              payment={ctx.payment}
              branding={ctx.branding}
              variant="deposit"
            />
          )}
        </div>

        {/* ── Right rail: sticky price card + acceptance ─────────────── */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-3">
            <PriceCard
              ctx={ctx}
              alreadyAccepted={alreadyAccepted}
              onAccept={() => setOpen(true)}
            />
            <TrustLine branding={ctx.branding} />
          </div>
        </aside>
      </div>

      {/* ── Mobile sticky bottom bar ──────────────────────────────────── */}
      {!alreadyAccepted && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.625rem)" }}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
            <div className="leading-tight">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {ctx.kva.isVariable ? "Voraussichtlich" : "Festpreis"}
              </div>
              <div className="display text-lg font-medium tabular-nums">
                {formatEurCents(ctx.kva.totalCents)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex h-11 flex-1 max-w-[60%] items-center justify-center rounded-xl text-sm font-medium text-white"
              style={{ background: `#${ctx.branding.primaryColor}` }}
            >
              Angebot annehmen
            </button>
          </div>
        </div>
      )}

      {/* Spacer so the last content card isn't covered by the sticky bar. */}
      {!alreadyAccepted && <div className="h-20 lg:hidden" aria-hidden />}

      <ConfirmKvaDialog
        token={token}
        open={open}
        onOpenChange={setOpen}
        ctx={ctx}
        widerrufNeeded={widerrufNeeded}
        onConfirmed={() => {
          setOpen(false);
          onConfirmed();
        }}
      />
    </>
  );
}

function PriceCard({
  ctx,
  alreadyAccepted,
  onAccept,
}: {
  ctx: CustomerPortalContext;
  alreadyAccepted: boolean;
  onAccept: () => void;
}) {
  const kva = ctx.kva!;
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-5 py-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {ctx.customerDisplayName ? `Angebot für ${ctx.customerDisplayName}` : "Ihr Angebot"}
      </div>
      <div className="space-y-4 px-5 py-5">
        <div>
          <div className="text-xs text-muted-foreground">
            {kva.isVariable ? "Voraussichtlich" : "Festpreis"}
          </div>
          <div className="display mt-1 text-3xl font-medium tabular-nums leading-none">
            {formatEurCents(kva.totalCents)}
          </div>
          {kva.validUntil && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              Gültig bis{" "}
              {new Date(kva.validUntil).toLocaleDateString("de-DE", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </div>
          )}
        </div>

        {kva.depositRequiredCents && kva.depositRequiredCents > 0 ? (
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] leading-relaxed">
            <strong className="font-medium">Anzahlung</strong>{" "}
            {formatEurCents(kva.depositRequiredCents)} zur Auftragsbestätigung.
          </div>
        ) : null}

        {alreadyAccepted ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
            <div className="flex items-center gap-2 font-medium">
              <span aria-hidden>✓</span>
              Angebot angenommen
            </div>
            <p className="mt-1 leading-relaxed">
              Bestätigt am{" "}
              {new Date(ctx.acceptance!.signedAt).toLocaleString("de-DE", {
                dateStyle: "long",
                timeStyle: "short",
              })}
              .
            </p>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={onAccept}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: `#${ctx.branding.primaryColor}` }}
            >
              Angebot verbindlich annehmen
            </button>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Mit einem Klick bestätigen Sie den Auftrag rechtlich verbindlich
              (Textform gem. § 126b BGB). Sie erhalten eine Kopie per E-Mail.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function TrustLine({ branding }: { branding: { firmaSlug: string; displayName: string } }) {
  return (
    <div className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
      Versicherter Transport. Kein Aufpreis am Tag.
      <br />
      Persönlicher Ansprechpartner bei {branding.displayName}.
    </div>
  );
}

function labelForType(type: "helper" | "transporter" | "other"): string {
  switch (type) {
    case "helper":
      return "Umzugshelfer";
    case "transporter":
      return "Transporter";
    case "other":
      return "Weitere Leistung";
  }
}

function formatEur(eur: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(eur);
}

function formatEurCents(cents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
