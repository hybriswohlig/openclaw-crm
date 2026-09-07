"use client";

import { useMemo, useState } from "react";
import {
  offerAcceptanceBlockReason,
  pickDefaultDealOption,
  widerrufVerzichtRequired,
  type CustomerPortalContext,
  type OfferAcceptanceBlockReason,
} from "@openclaw-crm/customer-portal-core";
import { ConfirmKvaDialog } from "./confirm-kva-dialog";
import { FileText, Info, ArrowRight, CheckCircle2 } from "lucide-react";
import { PanelHeading, OrderDetails, ContactPanel } from "./portal-ui";
import { QuotationPreview } from "./quotation-preview";
import { formatPortalMoney } from "./portal-presentation";
import { PaymentSection } from "./payment-section";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
import { OfferInclusionsSection } from "./offer-inclusions";
import { EmailCaptureBanner } from "./email-capture-banner";
import { PackageSelector } from "./package-selector";
import { DateOfferPicker } from "./date-offer-picker";
import { CustomerPhotosSection } from "./customer-photos-section";
import { FurnitureListSection } from "./furniture-list-section";

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
  onConfirmed: () => void | Promise<void>;
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

  const hasMultipleOffers = (ctx.dealPackageOffers.options.length || ctx.packages.available.length) > 1;
  const alreadyAccepted = !!ctx.acceptance;
  const offerExpired = expired && !alreadyAccepted;
  const hasOpenDateChoice =
    ctx.dateOffers.options.length > 0 && !ctx.dateOffers.selection;
  const defaultOption = pickDefaultDealOption(
    ctx.dealPackageOffers.options,
    ctx.dealPackageOffers.selectedOptionId
  );
  const displayTotalCents =
    defaultOption && defaultOption.priceCents > 0
      ? defaultOption.priceCents
      : ctx.kva?.totalCents ?? 0;
  const acceptBlock = offerAcceptanceBlockReason({
    dealOptions: ctx.dealPackageOffers.options,
    selectedOptionId: defaultOption?.id ?? ctx.dealPackageOffers.selectedOptionId,
    totalCents: displayTotalCents,
    isVariable: !!ctx.kva?.isVariable,
    hasOpenDateChoice,
  });

  return (
    <>
      <div className="portal-columns">
        <div className="portal-stack">
          <EmailCaptureBanner token={token} status={ctx.customerEmailStatus} branding={ctx.branding} />
          <div aria-live="polite" className="empty:hidden">{alreadyAccepted && <section className="portal-panel"><PanelHeading icon={CheckCircle2} title="Ihr Angebot wurde angenommen"><p>Vielen Dank für Ihr Vertrauen. Ihre Auftragsbestätigung erscheint hier, sobald sie bereitsteht.</p></PanelHeading><p className="text-sm text-muted-foreground">{defaultOption?.displayName ?? "Ihr Angebot"} · {formatPortalMoney(displayTotalCents)} · Angenommen am {new Date(ctx.acceptance!.signedAt).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}</p>{ctx.features?.payments === true && ctx.payment && ctx.payment.amountCents > 0 && <p className="mt-2 text-sm text-muted-foreground">Die Angaben zur vereinbarten Anzahlung finden Sie weiter unten.</p>}</section>}</div>
          {ctx.dateOffers.options.length > 0 && <DateOfferPicker token={token} ctx={ctx} onPicked={onConfirmed} />}
          <section className="portal-panel">
            <div className="portal-offer-intro"><PanelHeading icon={FileText} title={(ctx.dealPackageOffers.options.length || ctx.packages.available.length) > 1 ? "Unsere Angebote für Sie" : "Ihr persönliches Angebot"}>
              <p>{(ctx.dealPackageOffers.options.length || ctx.packages.available.length) > 1 ? "Wir haben die Optionen für Ihren Umzug erstellt. Wählen Sie das passende Angebot für sich aus." : "Hier finden Sie Ihr Angebot mit allen vereinbarten Leistungen für Ihren Umzug."}</p>
            </PanelHeading><span>Auftragsnummer: <strong>{ctx.dealNumber}</strong></span></div>
            <PackageSelector token={token} packages={ctx.packages} dealOffers={ctx.dealPackageOffers} branding={ctx.branding} locked={alreadyAccepted} onPicked={onConfirmed} />
            {ctx.dealPackageOffers.options.length === 0 && ctx.packages.available.length === 0 && ctx.kva && <div className="portal-note rounded-lg p-5"><strong>{ctx.kva.isVariable ? "Individuelles Angebot nach Aufwand" : "Ihr individuelles Angebot"}</strong><div className="portal-price text-4xl">{formatPortalMoney(displayTotalCents)}</div>{ctx.kva.summary && <p className="mt-3 whitespace-pre-line">{ctx.kva.summary}</p>}</div>}
          </section>
          {ctx.kva && !alreadyAccepted && <MobilePriceDetails ctx={ctx} expired={offerExpired} displayTotalCents={displayTotalCents} selectedOptionName={defaultOption?.displayName ?? null} />}
          <QuotationPreview ctx={ctx} token={token} />
          <div className={hasMultipleOffers ? "" : "lg:hidden"}><OrderDetails ctx={ctx} token={token} wide /></div>
          {ctx.kva?.calculationAssumptions && <CalculationAssumptionsCard a={ctx.kva.calculationAssumptions} />}
          {ctx.dealPackageOffers.options.length === 0 && ctx.kva?.showStandardInclusions && <OfferInclusionsSection inclusions={ctx.inclusions} branding={ctx.branding} />}
          <CustomerPhotosSection token={token} photos={ctx.customerPhotos} primaryColor={ctx.branding.primaryColor} />
          <FurnitureListSection items={ctx.furnitureList ?? []} primaryColor={ctx.branding.primaryColor} />
          {alreadyAccepted && ctx.features?.payments === true && ctx.payment && ctx.payment.amountCents > 0 && <PaymentSection token={token} payment={ctx.payment} branding={ctx.branding} variant="deposit" markedPaidAt={ctx.customerSignals.markedPaidDepositAt} />}
        </div>
        <aside className="portal-stack">
          <div className="hidden lg:block">{ctx.kva ? <PriceCard ctx={ctx} alreadyAccepted={alreadyAccepted} displayTotalCents={displayTotalCents} selectedOptionName={defaultOption?.displayName ?? ctx.packages.available.find(p => p.slug === ctx.packages.selectedSlug)?.displayName ?? null} acceptBlock={alreadyAccepted ? null : acceptBlock} expired={offerExpired} onAccept={() => setOpen(true)} /> : <ChooseOfferPrompt branding={ctx.branding} />}</div>
          {(ctx.dealPackageOffers.options.length || ctx.packages.available.length) > 1 && !alreadyAccepted && <div className="portal-panel portal-note"><PanelHeading icon={Info} title="Hinweis" /><p>Sie können zwischen den Angeboten wechseln. Der angezeigte Kostenvoranschlag passt sich Ihrer Auswahl an.</p></div>}
          {!hasMultipleOffers && <div className="hidden lg:block"><OrderDetails ctx={ctx} token={token} /></div>}
          <ContactPanel ctx={ctx} token={token} title="Fragen zum Angebot?" />
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
                  {formatEurCents(displayTotalCents)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (acceptBlock === "date") {
                    const el = document.querySelector("[data-portal-section='date-picker']");
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    return;
                  }
                  if (acceptBlock === "option" || acceptBlock === "zero_price") {
                    const el = document.querySelector("[data-portal-section='packages']");
                    el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    return;
                  }
                  setOpen(true);
                }}
                className="inline-flex h-11 flex-1 max-w-[60%] items-center justify-center rounded-xl text-sm font-medium text-white disabled:opacity-60"
                style={{ background: `#${ctx.branding.primaryColor}` }}
              >
                {acceptBlock === "date"
                  ? "Termin wählen"
                  : acceptBlock === "option"
                    ? "Angebot wählen"
                    : "Angebot annehmen"}
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
        open={open && !offerExpired && !acceptBlock}
        onOpenChange={setOpen}
        ctx={ctx}
        widerrufNeeded={widerrufNeeded}
        displayTotalCents={displayTotalCents}
        selectedOptionName={defaultOption?.displayName ?? null}
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
  displayTotalCents,
  selectedOptionName,
  acceptBlock,
  expired,
  onAccept,
}: {
  ctx: CustomerPortalContext;
  alreadyAccepted: boolean;
  displayTotalCents: number;
  selectedOptionName: string | null;
  acceptBlock: OfferAcceptanceBlockReason | null;
  expired: boolean;
  onAccept: () => void;
}) {
  const kva = ctx.kva!;
  const accent = `#${ctx.branding.primaryColor}`;
  return (
    <div className="portal-offer-price-card relative overflow-hidden rounded-2xl border">
      {/* Thin accent rule at the very top — Stripe Checkout style. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{
          background: `linear-gradient(90deg, ${accent}, ${accent}99)`,
        }}
      />
      <div className="border-b px-5 pb-3 pt-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Ihr ausgewähltes Angebot
      </div>
      <div className="space-y-4 px-5 py-5">
        <div>
          <div className="text-xl font-bold mb-2">{selectedOptionName ?? "Individuelles Angebot"}</div>
          <div className="text-xs text-muted-foreground">
            {kva.isVariable ? "Voraussichtlich" : "Festpreis"}
          </div>
          <div className="display mt-1 text-4xl font-medium tabular-nums leading-none tracking-tight">
            {formatEurCents(displayTotalCents)}
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
            {selectedOptionName && (
              <p className="mt-1 leading-relaxed">
                Ihre Wahl: {selectedOptionName} · {formatEurCents(displayTotalCents)}
              </p>
            )}
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
                if (acceptBlock === "date") {
                  const el = document.querySelector("[data-portal-section='date-picker']");
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  return;
                }
                if (acceptBlock === "option" || acceptBlock === "zero_price") {
                  const el = document.querySelector("[data-portal-section='packages']");
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  return;
                }
                onAccept();
              }}
              className="inline-flex h-11 w-full items-center justify-center rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: `#${ctx.branding.primaryColor}` }}
            >
              {acceptBlock === "date"
                ? "Zuerst Termin wählen"
                : acceptBlock === "option"
                  ? "Zuerst Angebot wählen"
                  : acceptBlock === "zero_price"
                    ? "Kein Preis hinterlegt"
                    : "Angebot verbindlich annehmen"}
              {!acceptBlock && <ArrowRight size={17} className="ml-2 shrink-0" aria-hidden />}
            </button>
            {acceptBlock === "date" ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Bitte wählen Sie oben einen Termin, damit wir den Auftrag
                verbindlich für Sie reservieren können.
              </p>
            ) : acceptBlock === "option" ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Bitte wählen Sie zuerst eine der Optionen. Der Preis übernimmt
                Ihre Auswahl automatisch.
              </p>
            ) : acceptBlock === "zero_price" ? (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Für dieses Angebot ist noch kein Preis hinterlegt. Schreiben Sie
                uns kurz, wir senden Ihnen die Zahlen nach.
              </p>
            ) : (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Im nächsten Schritt prüfen und bestätigen Sie Ihr Angebot verbindlich. Anschließend erhalten Sie Ihre Bestätigung.
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
  displayTotalCents,
  selectedOptionName,
}: {
  ctx: CustomerPortalContext;
  expired: boolean;
  displayTotalCents: number;
  selectedOptionName: string | null;
}) {
  const kva = ctx.kva!;
  return (
    <div className="space-y-3 lg:hidden">
      <div className="rounded-2xl border bg-card px-5 py-4 shadow-sm">
        <div className="text-xs text-muted-foreground">
          {kva.isVariable ? "Voraussichtlich" : "Festpreis"}
        </div>
        <div className="display mt-1 text-3xl font-medium tabular-nums leading-none tracking-tight">
          {formatEurCents(displayTotalCents)}
        </div>
        {selectedOptionName && (
          <div className="mt-2 text-sm font-medium">{selectedOptionName}</div>
        )}
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
      {isVariable ? "Abrechnung nach dem vereinbarten Aufwand." : "Maßgeblich sind die Leistungen und Angaben in Ihrem Angebot."}
      <br />
      Persönlicher Ansprechpartner bei {branding.displayName}.
    </div>
  );
}

function formatEurCents(cents: number): string {
  return formatPortalMoney(cents);
}

// ─── Kalkulationsgrundlagen ──────────────────────────────────────────────────
// Renders the assumptions the price is based on. Part of the frozen KVA
// snapshot on acceptance, so keep the wording factual and complete.
function CalculationAssumptionsCard({
  a,
}: {
  a: NonNullable<NonNullable<CustomerPortalContext["kva"]>["calculationAssumptions"]>;
}) {
  const rows: Array<[string, string]> = [];
  if (a.anfahrtMinuten != null) {
    rows.push([
      "Anfahrt gesamt",
      `ca. ${a.anfahrtMinuten} Min.${a.anfahrtQuelle === "manuell" ? " (Annahme)" : ""}`,
    ]);
  }
  if (a.etageVon) rows.push(["Etage Beladestelle", a.etageVon]);
  if (a.etageBis) rows.push(["Etage Entladestelle", a.etageBis]);
  if (a.zugangVon) rows.push(["Zugang Beladestelle", a.zugangVon]);
  if (a.zugangBis) rows.push(["Zugang Entladestelle", a.zugangBis]);
  if (a.inventarPositionen != null) {
    rows.push([
      "Umfang",
      `${a.inventarPositionen} Positionen${a.inventarVolumenCbm != null ? ` · ca. ${a.inventarVolumenCbm} m³` : ""}`,
    ]);
  }
  if (rows.length === 0 && !a.hinweis) return null;
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Kalkulationsgrundlagen
      </div>
      <div className="px-6 py-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {a.hinweis ??
            "Der Preis basiert auf diesen Angaben. Abweichende Gegebenheiten vor Ort (z. B. andere Etage, fehlender Aufzug, längere Trage- oder Anfahrtswege) können zu Mehrkosten führen."}
        </p>
      </div>
    </div>
  );
}
