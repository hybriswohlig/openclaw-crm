"use client";

import { useMemo, useState } from "react";
import {
  widerrufVerzichtRequired,
  type CustomerPortalContext,
} from "@openclaw-crm/customer-portal-core";
import { ConfirmKvaDialog } from "./confirm-kva-dialog";
import { ScopeSummary } from "./scope-summary";
import { PaymentSection } from "./payment-section";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
import { OfferInclusionsSection } from "./offer-inclusions";
import { EmailCaptureBanner } from "./email-capture-banner";
import { PackageSelector } from "./package-selector";
import { DateOfferPicker } from "./date-offer-picker";

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

  // Day-based validity check anchored to server time (the server rejects an
  // accept on an expired offer with OFFER_EXPIRED; the UI should never let
  // the customer run into that).
  const expired = useMemo(() => {
    if (!ctx.kva?.validUntil) return false;
    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return (
      startOfDay(new Date(ctx.kva.validUntil)) <
      startOfDay(new Date(ctx.meta.serverTime))
    );
  }, [ctx.kva?.validUntil, ctx.meta.serverTime]);

  // The customer can choose an offer (package option, catalogue package, or a
  // proposed date) even before a base quotation exists — picking one is what
  // CREATES the quotation server-side. So only show the "wird erstellt" notice
  // when there is genuinely nothing to show or pick yet. Otherwise we would
  // hide the very picker that lets the customer proceed (deadlock).
  const hasSelectableOffers =
    ctx.dealPackageOffers.options.length > 0 ||
    ctx.packages.available.length > 0 ||
    ctx.dateOffers.options.length > 0;

  if (!ctx.kva && !hasSelectableOffers) {
    return (
      <section className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        Ihr Kostenvoranschlag wird gerade erstellt. Diese Seite aktualisiert sich
        automatisch, sobald das Angebot bereitsteht. Sie können die Seite einfach
        kurz später erneut öffnen.
      </section>
    );
  }

  const alreadyAccepted = !!ctx.acceptance;
  const offerExpired = expired && !alreadyAccepted;
  const hasOpenDateChoice =
    ctx.dateOffers.options.length > 0 && !ctx.dateOffers.selection;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start lg:gap-10">
        {/* ── Left column: details ───────────────────────────────────── */}
        <div className="space-y-5">
          {/* Mobile acceptance feedback. The wrapper stays mounted (empty
              before acceptance) so screen readers announce the card right
              after the dialog submit; empty:mb-0 keeps the space-y rhythm
              intact until then. Desktop shows the status in the right rail. */}
          <div aria-live="polite" className="lg:hidden empty:mb-0">
            {alreadyAccepted && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
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
                <p className="mt-2 leading-relaxed">
                  {ctx.payment && ctx.payment.amountCents > 0
                    ? "Damit Ihr Termin fest reserviert ist, überweisen Sie bitte die Anzahlung. Alle Zahlungsdaten finden Sie unten."
                    : "Sie erhalten Ihre Auftragsbestätigung in Kürze per E-Mail."}
                </p>
              </div>
            )}
          </div>

          <EmailCaptureBanner
            token={token}
            status={ctx.customerEmailStatus}
            branding={ctx.branding}
          />

          {/* Multi-date picker. When the operator proposed candidate dates,
              the customer picks one BEFORE accepting the offer so the binding
              total is anchored to a real date. */}
          {ctx.dateOffers.options.length > 0 && (
            <DateOfferPicker token={token} ctx={ctx} onPicked={onConfirmed} />
          )}

          {/* Operator-written summary. Calm content card so the customer reads
              context BEFORE the number. */}
          {ctx.kva?.summary && ctx.kva.summary.trim().length > 0 && (
            <div className="overflow-hidden rounded-2xl border bg-card">
              <div className="border-b px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Was umfasst der Auftrag
              </div>
              <p className="whitespace-pre-wrap p-6 text-sm leading-relaxed">
                {ctx.kva.summary}
              </p>
            </div>
          )}

          {/* Mobile price details. The right rail is desktop only, so validity,
              deposit and trust signals need a home in the column as well. The
              sticky bottom bar keeps owning the accept CTA. */}
          {ctx.kva && !alreadyAccepted && (
            <MobilePriceDetails ctx={ctx} expired={offerExpired} />
          )}

          <PackageSelector
            token={token}
            packages={ctx.packages}
            dealOffers={ctx.dealPackageOffers}
            branding={ctx.branding}
            locked={alreadyAccepted}
            onPicked={onConfirmed}
          />

          <ScopeSummary scope={ctx.scope} />

          <OfferInclusionsSection inclusions={ctx.inclusions} branding={ctx.branding} />

          {/* Detailed line-item breakdown (when variable / hourly). Sits at
              the bottom of the left column so the right-rail headline price
              gets the customer's attention first. */}
          {ctx.kva?.isVariable && ctx.kva.lineItems.length > 0 && (
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
              markedPaidAt={ctx.customerSignals.markedPaidDepositAt}
            />
          )}
        </div>

        {/* ── Right rail: sticky price card + acceptance ─────────────── */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 space-y-3">
            {ctx.kva ? (
              <PriceCard
                ctx={ctx}
                alreadyAccepted={alreadyAccepted}
                blockedByDateChoice={hasOpenDateChoice}
                expired={offerExpired}
                onAccept={() => setOpen(true)}
              />
            ) : (
              <ChooseOfferPrompt branding={ctx.branding} />
            )}
            <TrustLine branding={ctx.branding} isVariable={!!ctx.kva?.isVariable} />
          </div>
        </aside>
      </div>

      {/* ── Mobile sticky bottom bar ──────────────────────────────────── */}
      {/* Only once a quotation exists (price known). Before that the customer
          uses the package/date picker above to choose, which creates it. */}
      {!alreadyAccepted && ctx.kva && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.625rem)" }}
        >
          {offerExpired ? (
            <div className="mx-auto max-w-2xl px-4 py-3">
              <OfferExpiredNotice ctx={ctx} />
            </div>
          ) : (
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
                onClick={() => {
                  if (hasOpenDateChoice) {
                    const el = document.querySelector("[data-portal-section='date-picker']");
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    return;
                  }
                  setOpen(true);
                }}
                className="inline-flex h-11 flex-1 max-w-[60%] items-center justify-center rounded-xl text-sm font-medium text-white disabled:opacity-60"
                style={{ background: `#${ctx.branding.primaryColor}` }}
              >
                {hasOpenDateChoice ? "Termin wählen" : "Angebot annehmen"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Spacer so the last content card isn't covered by the sticky bar. */}
      {!alreadyAccepted && ctx.kva && (
        <div className={offerExpired ? "h-48 lg:hidden" : "h-20 lg:hidden"} aria-hidden />
      )}

      <ConfirmKvaDialog
        token={token}
        open={open && !offerExpired}
        onOpenChange={setOpen}
        ctx={ctx}
        widerrufNeeded={widerrufNeeded}
        onAccepted={onConfirmed}
      />
    </>
  );
}

/**
 * Right-rail placeholder shown when offers exist but no base quotation has
 * been created yet (the customer hasn't picked a package/option). Picking one
 * in the left column creates the quotation; the real PriceCard then replaces
 * this on the next render.
 */
function ChooseOfferPrompt({ branding }: { branding: { primaryColor: string } }) {
  return (
    <div className="rounded-2xl border bg-card p-5 text-sm shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Ihr Angebot
      </div>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Bitte wählen Sie nebenan Ihr passendes Paket bzw. einen Termin. Sobald
        Sie gewählt haben, sehen Sie hier den verbindlichen Preis und können den
        Auftrag annehmen.
      </p>
      <button
        type="button"
        onClick={() => {
          const el =
            document.querySelector("[data-portal-section='packages']") ??
            document.querySelector("[data-portal-section='date-picker']");
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium text-white"
        style={{ background: `#${branding.primaryColor}` }}
      >
        Angebot auswählen
      </button>
    </div>
  );
}

function PriceCard({
  ctx,
  alreadyAccepted,
  blockedByDateChoice,
  expired,
  onAccept,
}: {
  ctx: CustomerPortalContext;
  alreadyAccepted: boolean;
  blockedByDateChoice: boolean;
  expired: boolean;
  onAccept: () => void;
}) {
  const kva = ctx.kva!;
  const accent = `#${ctx.branding.primaryColor}`;
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Thin accent rule at the very top — Stripe Checkout style. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          background: `linear-gradient(90deg, ${accent}, ${accent}99)`,
        }}
      />
      <div className="border-b px-5 pb-3 pt-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {ctx.customerDisplayName ? `Angebot für ${ctx.customerDisplayName}` : "Ihr Angebot"}
      </div>
      <div className="space-y-4 px-5 py-5">
        <div>
          <div className="text-xs text-muted-foreground">
            {kva.isVariable ? "Voraussichtlich" : "Festpreis inkl. MwSt."}
          </div>
          <div className="display mt-1 text-4xl font-medium tabular-nums leading-none tracking-tight">
            {formatEurCents(kva.totalCents)}
          </div>
          {kva.validUntil && (
            <div className="mt-2 text-[11px] text-muted-foreground">
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
        ) : expired ? (
          <OfferExpiredNotice ctx={ctx} />
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (blockedByDateChoice) {
                  const el = document.querySelector("[data-portal-section='date-picker']");
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  return;
                }
                onAccept();
              }}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: `#${ctx.branding.primaryColor}` }}
            >
              {blockedByDateChoice
                ? "Zuerst Termin wählen"
                : "Angebot verbindlich annehmen"}
            </button>
            {blockedByDateChoice ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Bitte wählen Sie oben einen Termin, damit wir den Auftrag
                verbindlich für Sie reservieren können.
              </p>
            ) : (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Mit einem Klick bestätigen Sie den Auftrag rechtlich verbindlich
                (Textform gem. § 126b BGB). Sie erhalten eine Kopie per E-Mail.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Compact lg:hidden companion of the PriceCard for the left column. Carries
 * the price context the rail would otherwise show (label, validity, deposit,
 * trust line). No CTA here, the mobile sticky bottom bar owns the button.
 */
function MobilePriceDetails({
  ctx,
  expired,
}: {
  ctx: CustomerPortalContext;
  expired: boolean;
}) {
  const kva = ctx.kva!;
  return (
    <div className="space-y-3 lg:hidden">
      <div className="rounded-2xl border bg-card px-5 py-4 shadow-sm">
        <div className="text-xs text-muted-foreground">
          {kva.isVariable ? "Voraussichtlich" : "Festpreis inkl. MwSt."}
        </div>
        <div className="display mt-1 text-3xl font-medium tabular-nums leading-none tracking-tight">
          {formatEurCents(kva.totalCents)}
        </div>
        {kva.validUntil && (
          <div
            className={`mt-2 text-[11px] ${
              expired ? "font-medium text-destructive" : "text-muted-foreground"
            }`}
          >
            Gültig bis{" "}
            {new Date(kva.validUntil).toLocaleDateString("de-DE", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {expired && " (abgelaufen)"}
          </div>
        )}
        {kva.depositRequiredCents && kva.depositRequiredCents > 0 ? (
          <div className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] leading-relaxed">
            <strong className="font-medium">Anzahlung</strong>{" "}
            {formatEurCents(kva.depositRequiredCents)} zur Auftragsbestätigung.
          </div>
        ) : null}
      </div>
      <TrustLine branding={ctx.branding} isVariable={kva.isVariable} />
    </div>
  );
}

/**
 * Calm replacement for the accept CTA once the offer's validUntil has passed.
 * The server would reject the acceptance with OFFER_EXPIRED anyway, so the
 * portal routes the customer back into the WhatsApp thread instead.
 */
function OfferExpiredNotice({ ctx }: { ctx: CustomerPortalContext }) {
  return (
    <div className="rounded-lg bg-muted/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      <p className="font-medium text-foreground">Dieses Angebot ist abgelaufen.</p>
      <p className="mt-1">
        Schreiben Sie uns kurz, wir prüfen die Verfügbarkeit und senden Ihnen
        ein aktualisiertes Angebot.
      </p>
      <div className="mt-2">
        <WhatsAppContactLink
          phoneE164={ctx.branding.whatsappNumberE164}
          label="Kurz nachfragen"
          message={`Guten Tag ${ctx.branding.displayName}, das Angebot zu meinem Auftrag ${ctx.dealNumber} ist abgelaufen. Können Sie mir bitte ein aktualisiertes Angebot senden?`}
          fallback={
            <p>
              Antworten Sie einfach auf die Nachricht, mit der Sie diesen Link
              erhalten haben.
            </p>
          }
        />
      </div>
    </div>
  );
}

function TrustLine({
  branding,
  isVariable,
}: {
  branding: { firmaSlug: string; displayName: string };
  isVariable: boolean;
}) {
  return (
    <div className="px-1 text-center text-[11px] leading-relaxed text-muted-foreground">
      {isVariable
        ? "Versicherter Transport. Transparente Abrechnung nach Aufwand."
        : "Versicherter Transport. Kein Aufpreis am Tag."}
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
