"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  BUTTON_ZAHLUNGSPFLICHTIG,
  HAFTUNGSHINWEIS_451G,
  HAFTUNG_CHECKBOX,
  VERSICHERUNG_CHECKBOX,
  VORZEITIGER_BEGINN_CHECKBOX,
  abschlussHinweis,
  keinWiderrufHinweis,
  widerrufsbelehrung,
  type ConfirmKvaPayload,
  type CustomerPortalContext,
} from "@openclaw-crm/customer-portal-core";
import { portalBrandStyle } from "./portal-presentation";
import { PaymentSection } from "./payment-section";

/**
 * Annahme-Dialog. Pflicht: Angebot, AGB (falls vorhanden), bei Umzug der
 * Haftungshinweis nach § 451g HGB, bei Küchenmontage unter 14 Tagen der
 * verlangte vorzeitige Beginn. Welche Häkchen gelten, steht in
 * ctx.annahmeRecht; der Server prüft mit denselben Core-Regeln nach.
 * Der Button nennt die Zahlungspflicht (§ 312j Abs. 3 BGB).
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
  displayTotalCents,
  selectedOptionName,
  onAccepted,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: CustomerPortalContext;
  displayTotalCents: number;
  selectedOptionName: string | null;
  /** Fires once the accept POST succeeded. Refreshes the context in the
      background; the dialog stays open and moves to the done step. */
  onAccepted: () => void | Promise<void>;
}) {
  const [step, setStep] = useState<"form" | "done">("form");
  const [accOffer, setAccOffer] = useState(false);
  const [accAgb, setAccAgb] = useState(false);
  const [accHaftung, setAccHaftung] = useState(false);
  const [accVersicherung, setAccVersicherung] = useState(false);
  const [accBeginn, setAccBeginn] = useState(false);
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
      setAccHaftung(false);
      setAccVersicherung(false);
      setAccBeginn(false);
      setFullName("");
      setError(null);
    }
    onOpenChange(next);
  }

  const agbHref = ctx.branding.agbPdfUrl;
  const hasAgb = !!agbHref;

  const r = ctx.annahmeRecht;
  const ready =
    accOffer &&
    (!hasAgb || accAgb) &&
    (!r.haftungshinweisErforderlich || accHaftung) &&
    (!r.vorzeitigerBeginnErforderlich || accBeginn) &&
    !submitting;

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    const payload: ConfirmKvaPayload = {
      acceptedOffer: accOffer,
      acceptedAgb: accAgb,
      haftungshinweisBestaetigt: accHaftung,
      versicherungGewuenscht: accVersicherung,
      vorzeitigerBeginnVerlangt: accBeginn,
      expectedTotalCents: displayTotalCents,
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
        // Neuer Preis: Kontext neu laden, damit der Kunde ihn sieht.
        if (body.error?.code === "PRICE_CHANGED") void onAccepted();
        return;
      }
      await Promise.resolve(onAccepted());
      setStep("done");
    } catch {
      setError("Verbindungsfehler. Bitte versuchen Sie es erneut.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-sm" />
        {/* Radix portals to document.body, outside the .kottke-portal wrapper.
            The class on the content re-scopes the portal palette variables. */}
        <DialogPrimitive.Content
          style={portalBrandStyle(ctx.branding.primaryColor)}
          className="kottke-portal portal-accept-dialog fixed bottom-0 left-1/2 z-50 max-h-[92svh] w-full max-w-lg -translate-x-1/2 overflow-y-auto rounded-t-3xl bg-background p-6 shadow-2xl sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-2xl"
          onEscapeKeyDown={(e) => {
            if (step === "form" && submitting) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (step === "form" && submitting) e.preventDefault();
          }}
        >
          {step === "done" ? (
            <DoneStep
              token={token}
              ctx={ctx}
              selectedOptionName={selectedOptionName}
              displayTotalCents={displayTotalCents}
              onClose={() => handleOpenChange(false)}
            />
          ) : (
            <>
          <DialogPrimitive.Title className="text-2xl font-bold tracking-tight">
            Auftrag erteilen
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">
            Bitte bestätigen Sie die folgenden Punkte. Eine Bestätigung geht
            Ihnen anschließend per WhatsApp oder E-Mail zu.
          </DialogPrimitive.Description>

          {/* Preis-Recap unmittelbar vor der Annahme (§ 312j Abs. 2 BGB). */}
          {ctx.kva && (
            <div className="mt-4">
              <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                <div className="text-xs text-muted-foreground">
                  {ctx.kva.isVariable
                    ? "Voraussichtlicher Gesamtbetrag"
                    : "Festpreis"}
                </div>
                <div className="mt-1 text-2xl font-medium tabular-nums leading-none tracking-tight">
                  {formatEurCents(displayTotalCents)}
                </div>
                {selectedOptionName && (
                  <div className="mt-2 text-sm font-medium">
                    {selectedOptionName}
                  </div>
                )}
                {ctx.scope.moveDate && (
                  <div className="mt-2 text-xs text-muted-foreground">
                    {r.serviceType === "move" ? "Umzugstermin" : "Termin"}:{" "}
                    {formatGermanDate(ctx.scope.moveDate)}
                  </div>
                )}
                {(ctx.scope.fromAddress || ctx.scope.toAddress) && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {ctx.scope.fromAddress && <>Von {ctx.scope.fromAddress}</>}
                    {ctx.scope.fromAddress && ctx.scope.toAddress && <br />}
                    {ctx.scope.toAddress && <>Nach {ctx.scope.toAddress}</>}
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

            {r.haftungshinweisErforderlich && (
              <div
                role="note"
                className="rounded-xl border-2 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
                style={{ borderColor: `#${ctx.branding.primaryColor}` }}
              >
                <p className="text-sm font-semibold">{HAFTUNGSHINWEIS_451G.titel}</p>
                {HAFTUNGSHINWEIS_451G.absaetze.map((a) => (
                  <p key={a} className="mt-1.5">{a}</p>
                ))}
              </div>
            )}

            {r.haftungshinweisErforderlich && (
              <CheckboxRow id="acc-haftung" checked={accHaftung} onCheckedChange={setAccHaftung}>
                {HAFTUNG_CHECKBOX}
              </CheckboxRow>
            )}

            {r.haftungshinweisErforderlich && (
              <CheckboxRow id="acc-versicherung" checked={accVersicherung} onCheckedChange={setAccVersicherung}>
                {VERSICHERUNG_CHECKBOX}
              </CheckboxRow>
            )}

            {r.widerrufModus === "ausgeschlossen" ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{keinWiderrufHinweis()}</p>
            ) : (
              <details className="rounded-xl border border-border/50 bg-card px-4 py-3 text-xs leading-relaxed">
                <summary className="cursor-pointer text-sm font-medium">Widerrufsbelehrung</summary>
                {widerrufsbelehrung(r.kontakt).absaetze.map((a) => (
                  <p key={a} className="mt-2">{a}</p>
                ))}
                <p className="mt-2">
                  <a
                    href={`/legal/widerruf/${ctx.branding.firmaSlug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline underline-offset-2"
                    style={{ color: `#${ctx.branding.primaryColor}` }}
                  >
                    Muster-Widerrufsformular
                  </a>
                </p>
              </details>
            )}

            {r.vorzeitigerBeginnErforderlich && (
              <CheckboxRow id="acc-beginn" checked={accBeginn} onCheckedChange={setAccBeginn}>
                {VORZEITIGER_BEGINN_CHECKBOX}
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
              {submitting ? "Wird gesendet…" : BUTTON_ZAHLUNGSPFLICHTIG}
            </button>
          </div>

          {!ready && !submitting && (
            <p className="mt-2 text-xs text-muted-foreground">
              Bitte bestätigen Sie zuerst alle Punkte oben.
            </p>
          )}

          <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
            {abschlussHinweis(ctx.branding.displayName)}
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
  selectedOptionName,
  displayTotalCents,
  onClose,
}: {
  token: string;
  ctx: CustomerPortalContext;
  selectedOptionName: string | null;
  displayTotalCents: number;
  onClose: () => void;
}) {
  const hasDeposit = ctx.features?.payments === true && !!ctx.payment && ctx.payment.amountCents > 0;
  return (
    <div aria-live="polite">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <DialogPrimitive.Title className="flex items-center gap-2 text-base font-medium">
          <span aria-hidden>✓</span>
          Angebot angenommen
        </DialogPrimitive.Title>
        <DialogPrimitive.Description className="mt-1 leading-relaxed">
          {selectedOptionName
            ? `Ihre Wahl: ${selectedOptionName} · ${formatEurCents(displayTotalCents)}.`
            : `Gesamtbetrag: ${formatEurCents(displayTotalCents)}.`}{" "}
          Eine Bestätigung geht Ihnen per WhatsApp oder E-Mail zu.
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
          Ihre Auftragsbestätigung folgt nach unserer Einsatzplanung. Unten
          auf der Seite sehen Sie weiterhin Ihr Angebot und was Sie
          angenommen haben.
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
    case "DATE_REQUIRED":
      return "Bitte wählen Sie zuerst einen Termin. Ohne festen Termin können wir den Auftrag noch nicht annehmen.";
    case "PRICE_CHANGED":
      return "Das Angebot wurde gerade aktualisiert. Bitte prüfen Sie den neuen Preis und bestätigen Sie erneut.";
    case "AGB_UNAVAILABLE":
      return "Unsere AGB sind gerade nicht abrufbar. Bitte versuchen Sie es in ein paar Minuten erneut.";
    case "HAFTUNGSHINWEIS_REQUIRED":
      return "Bitte bestätigen Sie den Haftungshinweis.";
    case "VORZEITIGER_BEGINN_REQUIRED":
      return "Ihr Termin liegt innerhalb der Widerrufsfrist. Bitte bestätigen Sie, dass wir vorher beginnen sollen.";
    case "NO_QUOTATION":
      return "Es liegt aktuell kein Angebot vor. Bitte kontaktieren Sie uns.";
    case "OPTION_REQUIRED":
      return "Bitte wählen Sie zuerst eine der angebotenen Optionen.";
    case "ZERO_PRICE":
      return "Für dieses Angebot ist noch kein Preis hinterlegt. Bitte kontaktieren Sie uns.";
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
