"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, ClipboardList, Info, MapPin } from "lucide-react";
import {
  festangebotStatusStep,
  offerAcceptanceBlockReason,
  type CustomerPortalContext,
  type KvaLineItem,
  type OfferAcceptanceBlockReason,
} from "@openclaw-crm/customer-portal-core";
import { ConfirmKvaDialog } from "./confirm-kva-dialog";
import { ContactPanel, DetailItem } from "./portal-ui";
import { QuotationPreview } from "./quotation-preview";
import { formatPortalDate, formatPortalMoney, postenBetraegeZeigen } from "./portal-presentation";
import { PaymentSection } from "./payment-section";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
import { EmailCaptureBanner } from "./email-capture-banner";
import { DateOfferPicker } from "./date-offer-picker";
import { CustomerPhotosSection } from "./customer-photos-section";
import { FurnitureListSection } from "./furniture-list-section";

/** "termin_offen": Umzug ohne festen Termin und ohne Terminangebot. */
type AnnahmeBlock = OfferAcceptanceBlockReason | "termin_offen";

/**
 * Stage 1 for a finished fixed price without deal-specific package options.
 * Company catalogue packages are not offered here, and accepting does not
 * store a package slug.
 */
export function FestangebotView({
  token,
  ctx,
  onConfirmed,
}: {
  token: string;
  ctx: CustomerPortalContext;
  onConfirmed: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const kva = ctx.kva!;
  const alreadyAccepted = !!ctx.acceptance;

  const expired = useMemo(() => {
    if (!kva.validUntil) return false;
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return startOfDay(new Date(`${kva.validUntil}T12:00:00`)) < startOfDay(new Date(ctx.meta.serverTime));
  }, [kva.validUntil, ctx.meta.serverTime]);

  const offerExpired = expired && !alreadyAccepted;
  const hasOpenDateChoice = ctx.dateOffers.options.length > 0 && !ctx.dateOffers.selection;
  const terminOffen = !alreadyAccepted && ctx.annahmeRecht.terminFehlt && !hasOpenDateChoice;
  const displayTotalCents =
    alreadyAccepted && ctx.acceptance!.confirmedTotalCents > 0
      ? ctx.acceptance!.confirmedTotalCents
      : kva.totalCents;
  const acceptBlock: AnnahmeBlock | null = alreadyAccepted
    ? null
    : terminOffen
      ? "termin_offen"
      : offerAcceptanceBlockReason({
          dealOptions: [],
          selectedOptionId: null,
          totalCents: displayTotalCents,
          isVariable: false,
          hasOpenDateChoice,
        });
  const showBar = !alreadyAccepted;
  const priceInBar = showBar && !offerExpired;
  const deposit = kva.depositRequiredCents ?? 0;
  const positions = kva.lineItems.filter((item) => item.description.trim());
  const showLineAmounts = postenBetraegeZeigen(positions, displayTotalCents);
  const standards = kva.showStandardInclusions ? ctx.inclusions : { included: [], optional: [] };
  const showStandards = standards.included.length + standards.optional.length > 0;
  const schedule = scheduleContent(ctx);
  const steps = nextSteps({
    alreadyAccepted,
    offerExpired,
    acceptBlock,
    depositCents: deposit,
    hasDate: schedule.showDate,
    hasAddress: schedule.showFrom || schedule.showTo,
    hasServices: positions.length > 0 || showStandards,
  });
  const status = festangebotStatusStep({ accepted: alreadyAccepted, stage: ctx.stage });
  const customerNote = kva.summary?.trim() || null;

  function accept() {
    if (acceptBlock === "termin_offen") return;
    if (acceptBlock === "date") {
      document.querySelector("[data-portal-section='date-picker']")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!acceptBlock) setOpen(true);
  }

  return (
    <div data-portal-view="festangebot">
      <div className="portal-festangebot">
        <EmailCaptureBanner token={token} status={ctx.customerEmailStatus} branding={ctx.branding} />
        {ctx.fruehereAnnahmeAufgehoben && !alreadyAccepted && (
          <section className="portal-panel portal-note">
            <h2 className="portal-fest-title">Ihr Angebot wurde aktualisiert</h2>
            <p>Wir haben Ihr Angebot angepasst. Bitte prüfen Sie es und nehmen Sie es erneut an.</p>
          </section>
        )}
        {ctx.dateOffers.options.length > 0 && (
          <DateOfferPicker token={token} ctx={ctx} onPicked={onConfirmed} locked={alreadyAccepted} />
        )}

        <section className="portal-panel portal-fest-offer">
          <div className="portal-fest-head">
            <div>
              <h2 className="portal-fest-title">Ihr Angebot</h2>
              <p className="portal-fest-kicker">Festpreis</p>
              <p className={`portal-price portal-fest-price ${priceInBar ? "hidden lg:block" : ""}`}>
                {formatPortalMoney(displayTotalCents)}
              </p>
              <div className="portal-fest-facts">
                {deposit > 0 && (
                  <p>
                    <strong>Anzahlung</strong> {formatPortalMoney(deposit)}
                  </p>
                )}
                {kva.validUntil && (
                  <p className={offerExpired ? "portal-fest-expired" : undefined}>
                    Gültig bis {formatLongDate(kva.validUntil)}
                    {offerExpired ? " (abgelaufen)" : ""}
                  </p>
                )}
                {alreadyAccepted && (
                  <p>
                    Angenommen am{" "}
                    {new Date(ctx.acceptance!.signedAt).toLocaleDateString("de-DE", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                      timeZone: "Europe/Berlin",
                    })}
                  </p>
                )}
              </div>
            </div>
            {showBar && (
              <div className="portal-fest-action hidden lg:block">
                {offerExpired ? (
                  <ExpiredNotice ctx={ctx} />
                ) : (
                  <AcceptButton ctx={ctx} acceptBlock={acceptBlock} onAccept={accept} />
                )}
              </div>
            )}
          </div>

          {customerNote && <p className="portal-fest-summary">{customerNote}</p>}

          {positions.length > 0 && (
            <div className="portal-fest-services">
              <h3>Leistungen</h3>
              <ul>
                {positions.map((item, i) => (
                  <li key={`${item.description}-${i}`}>
                    <span>
                      {item.description}
                      {item.quantity !== 1 && <span className="portal-fest-qty">Menge {formatQuantity(item.quantity)}</span>}
                    </span>
                    {showLineAmounts && <span className="portal-fest-line-amount">{formatPortalMoney(lineAmountCents(item))}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showStandards && (
            <details className="portal-fest-standards">
              <summary>Standardleistungen</summary>
              {standards.included.length > 0 && (
                <ul>
                  {standards.included.map((item) => (
                    <li key={item.key}>
                      {item.label}
                      {item.detail ? ` (${item.detail})` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {standards.optional.length > 0 && (
                <div className="portal-fest-optional">
                  <p>Auf Wunsch zubuchbar</p>
                  <ul>
                    {standards.optional.map((item) => (
                      <li key={item.key}>{item.label}</li>
                    ))}
                  </ul>
                </div>
              )}
            </details>
          )}

          {status === "annahme" && ctx.acceptance?.widerrufModus === "belehrung" && (
            <p className="portal-fest-summary">
              <a href={`/legal/widerruf/${ctx.branding.firmaSlug}`} target="_blank" rel="noopener noreferrer">
                Widerrufsbelehrung und Muster-Widerrufsformular
              </a>
            </p>
          )}
        </section>

        {schedule.visible && (
          <section className="portal-panel">
            <h2 className="portal-fest-title">Termin und Adressen</h2>
            <dl className="portal-schedule-grid">
              {schedule.showDate && (
                <DetailItem icon={CalendarDays} label="Termin">
                  {schedule.dateLabel}
                  {schedule.timeLabel && <span className="block">{schedule.timeLabel}</span>}
                </DetailItem>
              )}
              {schedule.showFrom && (
                <DetailItem icon={MapPin} label="Abholung">
                  {ctx.scope.fromAddress}
                  <AccessLine floor={ctx.scope.floorsFrom} access={ctx.scope.accessFrom} />
                </DetailItem>
              )}
              {schedule.showTo && (
                <DetailItem icon={MapPin} label="Ziel">
                  {ctx.scope.toAddress}
                  <AccessLine floor={ctx.scope.floorsTo} access={ctx.scope.accessTo} />
                </DetailItem>
              )}
              {schedule.anfahrtLabel && (
                <DetailItem icon={MapPin} label="Anfahrt">
                  {schedule.anfahrtLabel}
                </DetailItem>
              )}
              {schedule.note && (
                <div className="portal-fest-note">
                  <DetailItem icon={ClipboardList} label="Hinweis zum Auftrag">
                    {schedule.note}
                  </DetailItem>
                </div>
              )}
            </dl>
          </section>
        )}

        <section className="portal-panel">
          <h2 className="portal-fest-title">Nächste Schritte</h2>
          <ol className="portal-next-steps">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        {alreadyAccepted && ctx.features?.payments === true && ctx.payment && ctx.payment.amountCents > 0 && (
          <PaymentSection
            token={token}
            payment={ctx.payment}
            branding={ctx.branding}
            variant="deposit"
            markedPaidAt={ctx.customerSignals.markedPaidDepositAt}
          />
        )}

        <QuotationPreview ctx={ctx} token={token} variant="file" />
        <ContactPanel ctx={ctx} token={token} title="Fragen zum Angebot?" />
        <CustomerPhotosSection token={token} photos={ctx.customerPhotos} primaryColor={ctx.branding.primaryColor} />
        <FurnitureListSection items={ctx.furnitureList ?? []} primaryColor={ctx.branding.primaryColor} />
      </div>

      {priceInBar && (
        <div
          className="portal-fest-bar fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.625rem)" }}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
            <div className="leading-tight">
              <div className="portal-fest-kicker">Festpreis</div>
              <div className="portal-fest-bar-price display text-lg font-medium tabular-nums">{formatPortalMoney(displayTotalCents)}</div>
            </div>
            <button
              type="button"
              disabled={acceptBlock === "termin_offen"}
              onClick={accept}
              className="inline-flex h-11 max-w-[60%] flex-1 items-center justify-center rounded-xl text-sm font-medium text-white disabled:opacity-60"
              style={{ background: `#${ctx.branding.primaryColor}` }}
            >
              {acceptBlock === "termin_offen" ? "Termin wird abgestimmt" : acceptBlock === "date" ? "Termin wählen" : "Angebot annehmen"}
            </button>
          </div>
        </div>
      )}
      {showBar && offerExpired && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur lg:hidden"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.625rem)" }}
        >
          <div className="mx-auto max-w-2xl px-4 py-3">
            <ExpiredNotice ctx={ctx} />
          </div>
        </div>
      )}
      {showBar && <div className={offerExpired ? "h-48 lg:hidden" : acceptBlock === "termin_offen" ? "h-28 lg:hidden" : "h-20 lg:hidden"} aria-hidden />}

      <ConfirmKvaDialog
        token={token}
        open={open && !offerExpired && !acceptBlock}
        onOpenChange={setOpen}
        ctx={ctx}
        displayTotalCents={displayTotalCents}
        selectedOptionName={null}
        onAccepted={onConfirmed}
      />
    </div>
  );
}

function AcceptButton({
  ctx,
  acceptBlock,
  onAccept,
}: {
  ctx: CustomerPortalContext;
  acceptBlock: AnnahmeBlock | null;
  onAccept: () => void;
}) {
  const label =
    acceptBlock === "termin_offen"
      ? "Termin wird noch abgestimmt"
      : acceptBlock === "date"
        ? "Zuerst Termin wählen"
        : acceptBlock === "zero_price"
          ? "Kein Preis hinterlegt"
          : "Angebot verbindlich annehmen";
  return (
    <div className="portal-fest-accept">
      <button type="button" className="portal-button" disabled={acceptBlock === "termin_offen" || acceptBlock === "zero_price"} onClick={onAccept}>
        {label}
        {!acceptBlock && <ArrowRight size={17} aria-hidden />}
      </button>
      {acceptBlock === "termin_offen" && (
        <p>Der Termin wird noch mit Ihnen abgestimmt. Danach können Sie das Angebot hier annehmen.</p>
      )}
      {acceptBlock === "date" && <p>Bitte wählen Sie oben einen Termin.</p>}
      {!acceptBlock && <p>Im nächsten Schritt bestätigen Sie Ihr Angebot. Anschließend erhalten Sie Ihre Bestätigung.</p>}
    </div>
  );
}

function ExpiredNotice({ ctx }: { ctx: CustomerPortalContext }) {
  return (
    <div className="portal-fest-expired-note">
      <p>
        <Info size={16} aria-hidden /> Dieses Angebot ist abgelaufen.
      </p>
      <WhatsAppContactLink
        phoneE164={ctx.branding.whatsappNumberE164}
        label="Kurz nachfragen"
        message={`Guten Tag ${ctx.branding.displayName}, das Angebot zu meinem Auftrag ${ctx.dealNumber} ist abgelaufen. Können Sie mir bitte ein aktualisiertes Angebot senden?`}
        fallback={<p>Antworten Sie auf die Nachricht, mit der Sie diesen Link erhalten haben.</p>}
      />
    </div>
  );
}

function AccessLine({ floor, access }: { floor: number | null; access: string | null }) {
  const level = floorLabel(floor);
  if (!level && !access) return null;
  return <span className="block">{[level, access].filter(Boolean).join(" · ")}</span>;
}

function floorLabel(floor: number | null): string | null {
  if (floor == null) return null;
  if (floor === 0) return "Erdgeschoss";
  if (floor < 0) return `${Math.abs(floor)}. Untergeschoss`;
  return `${floor}. OG`;
}

function formatLongDate(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toLocaleString("de-DE");
}

function lineAmountCents(item: KvaLineItem): number {
  return Math.round(item.lineTotal * 100);
}

function scheduleContent(ctx: CustomerPortalContext) {
  const { scope } = ctx;
  const showDate = ctx.dateOffers.options.length === 0 && (!!scope.moveDate || !!scope.timeStart);
  const dateLabel = scope.moveDate ? formatPortalDate(scope.moveDate) : null;
  const timeLabel = scope.timeStart
    ? scope.timeEnd
      ? `${scope.timeStart} bis ${scope.timeEnd} Uhr`
      : `ab ${scope.timeStart} Uhr`
    : null;
  const anfahrt = ctx.kva?.calculationAssumptions?.anfahrtMinuten;
  const anfahrtLabel = anfahrt != null ? `ca. ${anfahrt} Min.` : null;
  const note = [scope.specialRequests, scope.inventoryNotes].map((part) => part?.trim()).filter(Boolean).join("\n") || null;
  const showFrom = !!scope.fromAddress;
  const showTo = !!scope.toAddress;
  return {
    visible: showDate || showFrom || showTo || !!anfahrtLabel || !!note,
    showDate: showDate && !!dateLabel,
    dateLabel,
    timeLabel,
    showFrom,
    showTo,
    anfahrtLabel,
    note,
  };
}

function nextSteps(input: {
  alreadyAccepted: boolean;
  offerExpired: boolean;
  acceptBlock: AnnahmeBlock | null;
  depositCents: number;
  hasDate: boolean;
  hasAddress: boolean;
  hasServices: boolean;
}): string[] {
  if (input.offerExpired) {
    return ["Dieses Angebot ist abgelaufen. Schreiben Sie uns, dann senden wir Ihnen ein aktualisiertes Angebot."];
  }
  if (input.alreadyAccepted) {
    const lines = ["Ihre Annahme ist eingegangen. Die Auftragsbestätigung erscheint hier, sobald sie bereitsteht."];
    if (input.depositCents > 0) lines.push(`Die Anzahlung von ${formatPortalMoney(input.depositCents)} wird mit der Bestätigung fällig.`);
    return lines;
  }
  if (input.acceptBlock === "termin_offen") {
    return ["Der Termin wird noch mit Ihnen abgestimmt. Danach können Sie das Angebot hier annehmen."];
  }
  if (input.acceptBlock === "date") {
    return ["Bitte wählen Sie einen der vorgeschlagenen Termine. Danach können Sie das Angebot annehmen."];
  }
  const subjects = [
    input.hasServices ? "Leistungen" : null,
    input.hasDate ? "Termin" : null,
    input.hasAddress ? "Adressen" : null,
  ].filter((part): part is string => !!part);
  const lines = subjects.length > 0 ? [`Prüfen Sie ${undListe(subjects)}.`] : [];
  lines.push("Nehmen Sie das Angebot an, wenn alles passt.");
  if (input.depositCents > 0) {
    lines.push(`Danach wird die Anzahlung von ${formatPortalMoney(input.depositCents)} fällig. Anschließend erhalten Sie die Auftragsbestätigung.`);
  } else {
    lines.push("Anschließend erhalten Sie die Auftragsbestätigung.");
  }
  return lines;
}

function undListe(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} und ${parts[parts.length - 1]}`;
}
