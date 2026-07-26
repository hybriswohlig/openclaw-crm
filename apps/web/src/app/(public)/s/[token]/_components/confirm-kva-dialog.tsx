"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  formatDateLong,
  formatEurCentsSmart,
  portalErrorKey,
  type ConfirmKvaPayload,
  type CustomerPortalContext,
} from "@openclaw-crm/customer-portal-core";
import { PaymentSection } from "./payment-section";
import { Slot, useLocale, useT } from "./portal-i18n";

/**
 * Acceptance flow. The two top checkboxes are mandatory always; the
 * Widerruf-Verzicht checkbox is mandatory only when the move date is < 14
 * days away (§ 356 Abs. 4 BGB).
 *
 * Server re-validates all three gates — the client cannot bypass them.
 *
 * The AGB the customer opens are German whatever the portal language is,
 * because the German version is the binding one. In any other language we
 * say so explicitly next to the checkbox, and the locale that was on screen
 * goes into the acceptance payload as evidence.
 *
 * After a successful accept the sheet stays open and switches to a "done"
 * step that shows the deposit payment widget right away (ctx.payment is
 * already populated before acceptance), so the customer pays without
 * scrolling back through the page.
 */
export function ConfirmKvaDialog({
  token,
  open,
  onOpenChange,
  ctx,
  widerrufNeeded,
  onAccepted,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: CustomerPortalContext;
  widerrufNeeded: boolean;
  /** Fires once the accept POST succeeded. Refreshes the context in the
      background; the dialog stays open and moves to the done step. */
  onAccepted: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [step, setStep] = useState<"form" | "done">("form");
  const [accOffer, setAccOffer] = useState(false);
  const [accAgb, setAccAgb] = useState(false);
  const [accBinding, setAccBinding] = useState(false);
  const [accWiderruf, setAccWiderruf] = useState(false);
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The component stays mounted while the dialog is closed (Radix only
  // unmounts the Content), so the state must be reset explicitly on close
  // for the next opening.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setStep("form");
      setAccOffer(false);
      setAccAgb(false);
      setAccBinding(false);
      setAccWiderruf(false);
      setFullName("");
      setError(null);
    }
    onOpenChange(next);
  }

  const agbHref = ctx.branding.agbPdfUrl;
  const hasAgb = !!agbHref;

  const ready =
    accOffer &&
    accBinding &&
    (!hasAgb || accAgb) &&
    (!widerrufNeeded || accWiderruf) &&
    !submitting;

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    const payload: ConfirmKvaPayload = {
      acceptedOffer: accOffer,
      acceptedAgb: accAgb,
      acceptedBindingNature: accBinding,
      widerrufVerzichtAccepted: accWiderruf,
      fullName: fullName.trim() || null,
      // Records which wording the customer actually read.
      locale,
    };
    try {
      const res = await fetch(`/api/public/${token}/confirm-kva`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string };
        };
        setError(t(portalErrorKey(body.error?.code)));
        return;
      }
      setStep("done");
      onAccepted();
    } catch {
      setError(t("errors.connection"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        {/* Radix portals to document.body, outside the .kottke-portal wrapper.
            The class on the content re-scopes the portal palette variables. */}
        <DialogPrimitive.Content
          className="kottke-portal fixed bottom-0 left-1/2 z-50 max-h-[92svh] w-full max-w-lg -translate-x-1/2 overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          onEscapeKeyDown={(e) => {
            if (step === "form" && submitting) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (step === "form" && submitting) e.preventDefault();
          }}
        >
          {step === "done" ? (
            <DoneStep token={token} ctx={ctx} onClose={() => handleOpenChange(false)} />
          ) : (
            <>
          <DialogPrimitive.Title className="text-lg font-medium">
            {t("confirm.title")}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
            {t("confirm.subtitle")}
          </DialogPrimitive.Description>

          {/* Preis-Recap unmittelbar vor der Annahme (§ 312j Abs. 2 BGB). */}
          {ctx.kva && (
            <div className="mt-4">
              <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                <div className="text-xs text-muted-foreground">
                  {ctx.kva.isVariable
                    ? t("confirm.estimatedTotal")
                    : t("confirm.fixedTotal")}
                </div>
                <div className="mt-1 text-2xl font-medium tabular-nums leading-none tracking-tight">
                  {formatEurCentsSmart(ctx.kva.totalCents, locale)}
                </div>
                {ctx.scope.moveDate && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t("confirm.moveDate", {
                      date: formatDateLong(ctx.scope.moveDate, locale),
                    })}
                  </div>
                )}
                {ctx.kva.depositRequiredCents != null &&
                  ctx.kva.depositRequiredCents > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t("confirm.deposit", {
                        amount: formatEurCentsSmart(
                          ctx.kva.depositRequiredCents,
                          locale
                        ),
                      })}
                    </div>
                  )}
              </div>
              {ctx.kva.isVariable && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("confirm.variableNote")}
                </p>
              )}
            </div>
          )}

          <div className="mt-5 space-y-4">
            <CheckboxRow
              id="acc-offer"
              checked={accOffer}
              onCheckedChange={setAccOffer}
            >
              <span>
                <Slot
                  messageKey="confirm.offerCheckbox"
                  slot={<strong>{ctx.dealNumber}</strong>}
                />
              </span>
            </CheckboxRow>

            {hasAgb && (
              <CheckboxRow
                id="acc-agb"
                checked={accAgb}
                onCheckedChange={setAccAgb}
              >
                <span>
                  <Slot
                    messageKey="confirm.agbCheckbox"
                    slot={
                      <a
                        href={agbHref!}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium underline underline-offset-2"
                        style={{ color: `#${ctx.branding.primaryColor}` }}
                      >
                        {t("confirm.agbLinkLabel")}
                      </a>
                    }
                  />
                  {/* The document itself is German; say which version binds. */}
                  {locale !== "de" && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t("confirm.agbGermanOnlyNotice")}
                    </span>
                  )}
                </span>
              </CheckboxRow>
            )}

            <CheckboxRow
              id="acc-binding"
              checked={accBinding}
              onCheckedChange={setAccBinding}
            >
              <Slot
                messageKey="confirm.bindingCheckbox"
                slot={<strong>{t("confirm.bindingStrong")}</strong>}
              />
            </CheckboxRow>

            {widerrufNeeded && (
              <CheckboxRow
                id="acc-widerruf"
                checked={accWiderruf}
                onCheckedChange={setAccWiderruf}
              >
                <span>
                  <Slot
                    messageKey="confirm.widerrufCheckbox"
                    slot={<strong>{t("confirm.widerrufStrong")}</strong>}
                  />
                </span>
              </CheckboxRow>
            )}

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("confirm.fullNameLabel")}
              </span>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-base focus:outline-none focus:ring-2 focus:ring-offset-1"
                style={{ ["--tw-ring-color" as never]: `#${ctx.branding.primaryColor}` }}
              />
            </label>
          </div>

          {error && (
            <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="mt-6 flex gap-3">
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
              className="h-11 flex-1 rounded-xl border border-border bg-transparent text-sm font-medium hover:bg-accent"
            >
              {t("confirm.cancel")}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!ready}
              className="h-11 flex-1 rounded-xl text-sm font-medium text-white transition-opacity disabled:opacity-40"
              style={{ background: `#${ctx.branding.primaryColor}` }}
            >
              {submitting ? t("confirm.submitting") : t("confirm.submit")}
            </button>
          </div>

          {!ready && !submitting && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("confirm.confirmAllFirst")}
            </p>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
            {t("confirm.legalFooter", { firma: ctx.branding.displayName })}
          </p>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Success step inside the same bottom sheet. Keeps the customer in the flow:
 * confirmation on top, then directly the deposit payment widget when a
 * deposit is open, so accepting and paying happen without a scroll detour.
 */
function DoneStep({
  token,
  ctx,
  onClose,
}: {
  token: string;
  ctx: CustomerPortalContext;
  onClose: () => void;
}) {
  const t = useT();
  const hasDeposit = !!ctx.payment && ctx.payment.amountCents > 0;
  return (
    <div aria-live="polite">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <DialogPrimitive.Title className="flex items-center gap-2 text-base font-medium">
          <span aria-hidden>✓</span>
          {t("confirm.doneTitle")}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-1 leading-relaxed">
          {t("confirm.doneSubtitle")}
        </DialogPrimitive.Description>
      </div>

      {hasDeposit ? (
        <>
          <p className="mt-4 text-sm leading-relaxed">
            {t("confirm.doneDeposit")}
          </p>
          <div className="mt-3">
            <PaymentSection
              token={token}
              payment={ctx.payment!}
              branding={ctx.branding}
              variant="deposit"
              markedPaidAt={ctx.customerSignals.markedPaidDepositAt}
            />
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {t("confirm.doneNoDeposit")}
        </p>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-6 h-11 w-full rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: `#${ctx.branding.primaryColor}` }}
      >
        {t("confirm.doneClose")}
      </button>
    </div>
  );
}

function CheckboxRow({
  id,
  checked,
  onCheckedChange,
  children,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className="flex items-start gap-3 rounded-xl border border-border/50 bg-card px-4 py-3 text-sm"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-foreground"
      />
      <span className="leading-relaxed">{children}</span>
    </label>
  );
}
