"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type {
  ConfirmKvaPayload,
  CustomerPortalContext,
} from "@openclaw-crm/customer-portal-core";
import { PaymentSection } from "./payment-section";

/**
 * Acceptance flow. The two top checkboxes are mandatory always; the
 * Widerruf-Verzicht checkbox is mandatory only when the move date is < 14
 * days away (§ 356 Abs. 4 BGB).
 *
 * Server re-validates all three gates — the client cannot bypass them.
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
        setError(germanError(body.error?.code));
        return;
      }
      setStep("done");
      onAccepted();
    } catch {
      setError("Verbindungsfehler. Bitte versuchen Sie es erneut.");
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
            Verbindliche Annahme
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
            Bitte bestätigen Sie die folgenden Punkte. Eine Kopie der Annahme
            geht Ihnen anschließend per E-Mail zu.
          </DialogPrimitive.Description>

          {/* Preis-Recap unmittelbar vor der Annahme (§ 312j Abs. 2 BGB). */}
          {ctx.kva && (
            <div className="mt-4">
              <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                <div className="text-xs text-muted-foreground">
                  {ctx.kva.isVariable
                    ? "Voraussichtlicher Gesamtbetrag"
                    : "Festpreis inkl. MwSt."}
                </div>
                <div className="mt-1 text-2xl font-medium tabular-nums leading-none tracking-tight">
                  {formatEurCents(ctx.kva.totalCents)}
                </div>
                {ctx.scope.moveDate && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Umzugstermin: {formatGermanDate(ctx.scope.moveDate)}
                  </div>
                )}
                {ctx.kva.depositRequiredCents != null &&
                  ctx.kva.depositRequiredCents > 0 && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Anzahlung: {formatEurCents(ctx.kva.depositRequiredCents)}{" "}
                      zur Auftragsbestätigung
                    </div>
                  )}
              </div>
              {ctx.kva.isVariable && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Die Abrechnung erfolgt nach tatsächlichem Aufwand. Verbindlich
                  ist die finale Rechnung.
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
                Ich habe das Angebot <strong>{ctx.dealNumber}</strong> gelesen und
                stimme dem Inhalt zu.
              </span>
            </CheckboxRow>

            {hasAgb && (
              <CheckboxRow
                id="acc-agb"
                checked={accAgb}
                onCheckedChange={setAccAgb}
              >
                <span>
                  Ich habe die{" "}
                  <a
                    href={agbHref!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                    style={{ color: `#${ctx.branding.primaryColor}` }}
                  >
                    Allgemeinen Geschäftsbedingungen (AGB)
                  </a>{" "}
                  gelesen und akzeptiere sie.
                </span>
              </CheckboxRow>
            )}

            <CheckboxRow
              id="acc-binding"
              checked={accBinding}
              onCheckedChange={setAccBinding}
            >
              Mir ist bewusst, dass dies eine{" "}
              <strong>verbindliche Beauftragung</strong> darstellt.
            </CheckboxRow>

            {widerrufNeeded && (
              <CheckboxRow
                id="acc-widerruf"
                checked={accWiderruf}
                onCheckedChange={setAccWiderruf}
              >
                <span>
                  Ich verzichte ausdrücklich auf mein Widerrufsrecht und stimme
                  zu, dass mit der Erbringung der Dienstleistung{" "}
                  <strong>vor Ablauf der Widerrufsfrist</strong> begonnen wird
                  (§ 356 Abs. 4 BGB). Der Umzugstermin liegt innerhalb von 14
                  Tagen.
                </span>
              </CheckboxRow>
            )}

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Vollständiger Name (empfohlen)
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
              Abbrechen
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!ready}
              className="h-11 flex-1 rounded-xl text-sm font-medium text-white transition-opacity disabled:opacity-40"
              style={{ background: `#${ctx.branding.primaryColor}` }}
            >
              {submitting ? "Wird gesendet…" : "Verbindlich annehmen"}
            </button>
          </div>

          {!ready && !submitting && (
            <p className="mt-2 text-xs text-muted-foreground">
              Bitte bestätigen Sie zuerst alle Punkte oben.
            </p>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
            Mit Klick auf „Verbindlich annehmen" kommt ein verbindlicher Vertrag
            über die vereinbarten Umzugsleistungen in Textform (§ 126b BGB)
            zwischen Ihnen und {ctx.branding.displayName} zustande.
            Zur Dokumentation werden Zeitpunkt, IP-Adresse und Browser-Kennung
            gespeichert.
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
  const hasDeposit = !!ctx.payment && ctx.payment.amountCents > 0;
  return (
    <div aria-live="polite">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <DialogPrimitive.Title className="flex items-center gap-2 text-base font-medium">
          <span aria-hidden>✓</span>
          Angebot angenommen
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-1 leading-relaxed">
          Eine Kopie geht Ihnen per E-Mail zu.
        </DialogPrimitive.Description>
      </div>

      {hasDeposit ? (
        <>
          <p className="mt-4 text-sm leading-relaxed">
            Nur noch ein Schritt: Mit Eingang der Anzahlung ist Ihr Termin fest
            reserviert.
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
          Sie erhalten Ihre Auftragsbestätigung in Kürze per E-Mail.
        </p>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-6 h-11 w-full rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: `#${ctx.branding.primaryColor}` }}
      >
        Fertig
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

function formatEurCents(cents: number): string {
  const fractionDigits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(cents / 100);
}

function formatGermanDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function germanError(code: string | undefined): string {
  switch (code) {
    case "MISSING_ACKNOWLEDGEMENT":
      return "Bitte bestätigen Sie alle erforderlichen Punkte.";
    case "WIDERRUF_REQUIRED":
      return "Für Termine innerhalb von 14 Tagen ist der Widerrufs-Verzicht erforderlich.";
    case "NO_QUOTATION":
      return "Es liegt aktuell kein Angebot vor. Bitte kontaktieren Sie uns.";
    case "OFFER_EXPIRED":
      return "Dieses Angebot ist inzwischen abgelaufen. Schreiben Sie uns kurz, wir prüfen die Verfügbarkeit und senden Ihnen ein aktualisiertes Angebot.";
    case "REVOKED":
      return "Dieser Link ist nicht mehr aktiv.";
    case "NOT_FOUND":
      return "Link nicht gefunden.";
    default:
      return "Es ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.";
  }
}
