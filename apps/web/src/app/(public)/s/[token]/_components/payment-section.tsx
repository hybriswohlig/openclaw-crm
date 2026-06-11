"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink, Wallet } from "lucide-react";
import type {
  FirmaBranding,
  PaymentInstructions,
} from "@openclaw-crm/customer-portal-core";
import { GirocodeQr } from "./girocode-qr";

/**
 * Renders the right payment widget for the deal's preferred method. Falls back
 * gracefully when the operator hasn't configured a destination yet — shows a
 * "Bitte beim Ansprechpartner melden" hint.
 *
 * After the customer says they paid, POSTs to /api/public/[token]/marked-paid
 * which writes a `customer.marked_paid` activity event for the operator. We
 * intentionally do NOT auto-mark the deal as paid — the operator does that
 * after reconciling the bank statement.
 */
export function PaymentSection({
  token,
  payment,
  branding,
  variant,
}: {
  token: string;
  payment: PaymentInstructions;
  branding: FirmaBranding;
  /** "deposit" for the Anzahlung at Stage 1, "final" for Stage 4. */
  variant: "deposit" | "final";
}) {
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);
  const [markError, setMarkError] = useState(false);

  async function markPaid() {
    setMarking(true);
    setMarkError(false);
    try {
      const res = await fetch(`/api/public/${token}/marked-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: payment.method,
          amountCents: payment.amountCents,
          variant,
        }),
      });
      if (res.ok) {
        setMarked(true);
      } else {
        setMarkError(true);
      }
    } catch {
      setMarkError(true);
    } finally {
      setMarking(false);
    }
  }

  const amountStr = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(payment.amountCents / 100);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div
        className="px-6 py-3 text-sm font-medium text-white"
        style={{ background: `#${branding.primaryColor}` }}
      >
        {variant === "deposit" ? "Anzahlung" : "Zahlung"}
      </div>
      <div className="space-y-4 p-6">
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-muted-foreground">Offener Betrag</div>
          <div className="text-2xl font-medium tabular-nums">{amountStr}</div>
        </div>
        <CopyField label="Verwendungszweck" value={payment.reference} />

        {payment.method === "bank_transfer" && payment.bank?.iban ? (
          <BankTransferBlock payment={payment} branding={branding} />
        ) : payment.method === "paypal" && payment.paypalUrl ? (
          <PayPalBlock url={payment.paypalUrl} branding={branding} />
        ) : payment.method === "cash" ? (
          <CashBlock />
        ) : payment.method === "card" ? (
          <CardComingSoonBlock />
        ) : (
          <UnconfiguredHint />
        )}

        {marked ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
            ✓ Danke! Wir prüfen den Zahlungseingang und melden uns sobald er bei
            uns angekommen ist.
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={markPaid}
              disabled={marking}
              className="h-10 w-full rounded-xl border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {marking ? "Wird gesendet…" : "Ich habe bezahlt"}
            </button>
            {markError && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                Konnte nicht gesendet werden. Bitte versuchen Sie es erneut.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function BankTransferBlock({
  payment,
  branding,
}: {
  payment: PaymentInstructions;
  branding: FirmaBranding;
}) {
  const bank = payment.bank!;
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        {payment.girocodePayload && (
          <GirocodeQr
            payload={payment.girocodePayload}
            primaryColor={branding.primaryColor}
            size={200}
          />
        )}
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <p className="text-xs text-muted-foreground">
            Banking-App öffnen und QR-Code scannen: IBAN, Betrag und
            Verwendungszweck sind vorausgefüllt.
          </p>
          <p className="text-xs text-muted-foreground">
            Sie lesen das auf dem Handy? Machen Sie einen Screenshot und
            scannen Sie den Code in Ihrer Banking-App aus der Galerie. Oder
            kopieren Sie einfach die Felder unten.
          </p>
          <CopyField label="Kontoinhaber" value={bank.holder} />
          <CopyField label="IBAN" value={formatIban(bank.iban)} copyValue={bank.iban.replace(/\s/g, "")} />
          {bank.bic && <CopyField label="BIC" value={bank.bic} />}
          <CopyField label="Betrag" value={new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(payment.amountCents / 100)} copyValue={(payment.amountCents / 100).toFixed(2).replace(".", ",")} />
        </div>
      </div>
    </div>
  );
}

function PayPalBlock({ url, branding }: { url: string; branding: FirmaBranding }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Tippen Sie auf den Button, um die Zahlung in der PayPal-App zu öffnen.
        Betrag und Empfänger sind vorausgefüllt.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: `#${branding.primaryColor}` }}
      >
        <Wallet className="h-4 w-4" />
        Mit PayPal bezahlen
        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
      </a>
    </div>
  );
}

function CashBlock() {
  return (
    <div className="rounded-md bg-muted/50 px-4 py-3 text-sm">
      <strong className="block">Zahlung bar bei Übergabe</strong>
      <p className="mt-1 text-xs text-muted-foreground">
        Bitte halten Sie den passenden Betrag bereit. Eine Quittung erhalten
        Sie unmittelbar nach Abschluss des Umzugs.
      </p>
    </div>
  );
}

function CardComingSoonBlock() {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-xs">
      <strong className="block">Kartenzahlung</strong>
      <p className="mt-1 text-muted-foreground">
        Wir nehmen Visa, Mastercard und Girocard vor Ort entgegen. Eine
        Online-Kartenzahlung bauen wir gerade. Bei Fragen melden Sie sich
        bitte kurz bei Ihrem Ansprechpartner.
      </p>
    </div>
  );
}

function UnconfiguredHint() {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
      Für diesen Auftrag sind noch keine Zahldaten hinterlegt. Bitte melden
      Sie sich kurz beim Ansprechpartner.
    </div>
  );
}

function CopyField({
  label,
  value,
  copyValue,
}: {
  label: string;
  value: string;
  copyValue?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(copyValue ?? value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-3 py-1.5 text-sm">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="truncate font-mono text-xs">{value}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="-my-2 -mr-2 flex min-h-11 min-w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={`${label} kopieren`}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? `${label} kopiert` : ""}
      </span>
    </div>
  );
}

function formatIban(iban: string): string {
  return iban.replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
}
