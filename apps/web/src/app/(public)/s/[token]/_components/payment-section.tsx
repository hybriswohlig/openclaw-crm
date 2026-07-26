"use client";

import { useState } from "react";
import { Copy, Check, ExternalLink, Wallet } from "lucide-react";
import {
  formatEurCents,
  formatIsoDateLong,
  type FirmaBranding,
  type PaymentInstructions,
} from "@openclaw-crm/customer-portal-core";
import { GirocodeQr } from "./girocode-qr";
import { useLocale, useT } from "./portal-i18n";

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
  markedPaidAt,
}: {
  token: string;
  payment: PaymentInstructions;
  branding: FirmaBranding;
  /** "deposit" for the Anzahlung at Stage 1, "final" for Stage 4. */
  variant: "deposit" | "final";
  /** ISO timestamp of a previously reported payment, survives reloads. */
  markedPaidAt?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(() => !!markedPaidAt);
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

  const amountStr = formatEurCents(payment.amountCents, locale);

  return (
    <section className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div
        className="px-6 py-3 text-sm font-medium text-white"
        style={{ background: `#${branding.primaryColor}` }}
      >
        {variant === "deposit" ? t("payment.deposit") : t("payment.payment")}
      </div>
      <div className="space-y-4 p-6">
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-muted-foreground">
            {t("payment.openAmount")}
          </div>
          <div className="text-2xl font-medium tabular-nums">{amountStr}</div>
        </div>
        <CopyField label={t("payment.reference")} value={payment.reference} />

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
            ✓ {t("payment.thanks")}
            {markedPaidAt && (
              <p className="mt-1">
                {t("payment.reportedOn", {
                  date: formatIsoDateLong(markedPaidAt, locale),
                })}
              </p>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={markPaid}
              disabled={marking}
              className="h-10 w-full rounded-xl border border-border bg-background text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              {marking ? t("payment.sending") : t("payment.iPaid")}
            </button>
            {markError && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {t("payment.sendFailed")}
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
  const t = useT();
  const locale = useLocale();
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
          <p className="text-xs text-muted-foreground">{t("payment.qrHint")}</p>
          <p className="text-xs text-muted-foreground">
            {t("payment.qrHintMobile")}
          </p>
          <CopyField label={t("payment.accountHolder")} value={bank.holder} />
          <CopyField
            label={t("payment.iban")}
            value={formatIban(bank.iban)}
            copyValue={bank.iban.replace(/\s/g, "")}
          />
          {bank.bic && <CopyField label={t("payment.bic")} value={bank.bic} />}
          {/* Copied value stays machine-parseable for banking apps: a plain
              decimal, with the comma German banking forms expect. */}
          <CopyField
            label={t("payment.amount")}
            value={formatEurCents(payment.amountCents, locale)}
            copyValue={(payment.amountCents / 100).toFixed(2).replace(".", ",")}
          />
        </div>
      </div>
    </div>
  );
}

function PayPalBlock({ url, branding }: { url: string; branding: FirmaBranding }) {
  const t = useT();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("payment.paypalHint")}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: `#${branding.primaryColor}` }}
      >
        <Wallet className="h-4 w-4" />
        {t("payment.paypalCta")}
        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
      </a>
    </div>
  );
}

function CashBlock() {
  const t = useT();
  return (
    <div className="rounded-md bg-muted/50 px-4 py-3 text-sm">
      <strong className="block">{t("payment.cashTitle")}</strong>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("payment.cashBody")}
      </p>
    </div>
  );
}

function CardComingSoonBlock() {
  const t = useT();
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-xs">
      <strong className="block">{t("payment.cardTitle")}</strong>
      <p className="mt-1 text-muted-foreground">{t("payment.cardBody")}</p>
    </div>
  );
}

function UnconfiguredHint() {
  const t = useT();
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
      {t("payment.unconfigured")}
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
  const t = useT();
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
        aria-label={t("payment.copyAria", { label })}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("payment.copiedAria", { label }) : ""}
      </span>
    </div>
  );
}

function formatIban(iban: string): string {
  return iban.replace(/\s/g, "").replace(/(.{4})/g, "$1 ").trim();
}
