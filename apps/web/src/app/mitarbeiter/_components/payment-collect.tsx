"use client";

import { useState } from "react";
import {
  Banknote,
  Building2,
  CreditCard,
  Wallet,
  AlertTriangle,
  CheckCircle2,
  Loader2,
} from "lucide-react";

type PaymentMethod = "cash" | "bank_transfer" | "paypal" | "card";

type PaymentInfo = { price: number; paid: number; outstanding: number };

const METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: "cash", label: "Bar", icon: Banknote },
  { value: "bank_transfer", label: "Überweisung", icon: Building2 },
  { value: "paypal", label: "PayPal", icon: Wallet },
  { value: "card", label: "Karte", icon: CreditCard },
];

function formatEur(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

export default function PaymentCollect({
  dealId,
  priceModel,
  payment,
  paymentPreference,
}: {
  dealId: string;
  priceModel: "fixed" | "hourly" | "unknown";
  payment: PaymentInfo;
  paymentPreference: string | null;
}) {
  const [outstanding, setOutstanding] = useState<number>(payment.outstanding);
  const [paidSoFar, setPaidSoFar] = useState<number>(payment.paid);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState<string>(
    payment.outstanding > 0 ? payment.outstanding.toFixed(2) : ""
  );
  const [warningDismissed, setWarningDismissed] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successAmount, setSuccessAmount] = useState<number | null>(null);

  const showWarning =
    priceModel === "fixed" && outstanding > 0 && !warningDismissed;

  async function handleSubmit() {
    setError(null);
    const parsed = Number(amount.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Bitte einen gültigen Betrag eingeben.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        "/api/v1/portal/deals/" + dealId + "/payment",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: parsed, method }),
        }
      );
      if (!res.ok) {
        let msg = "Zahlung konnte nicht erfasst werden.";
        try {
          const j = await res.json();
          if (j?.error) msg = j.error;
        } catch {
          // keep default
        }
        throw new Error(msg);
      }
      const newPaid = paidSoFar + parsed;
      const newOutstanding = Math.max(0, payment.price - newPaid);
      setPaidSoFar(newPaid);
      setOutstanding(newOutstanding);
      setSuccessAmount(parsed);
      setAmount(newOutstanding > 0 ? newOutstanding.toFixed(2) : "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Zahlung konnte nicht erfasst werden.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Wallet className="h-5 w-5 text-primary" aria-hidden />
        <h2 className="text-base font-semibold text-foreground">Kassieren</h2>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="text-xs text-muted-foreground">Offener Betrag</p>
        <p
          className={
            "mt-1 text-3xl font-bold " +
            (outstanding > 0 ? "text-foreground" : "text-primary")
          }
        >
          {formatEur(outstanding)}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Gesamt {formatEur(payment.price)}</span>
          <span>Bereits bezahlt {formatEur(paidSoFar)}</span>
        </div>
        {paymentPreference ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Wunsch Kunde: {paymentPreference}
          </p>
        ) : null}
      </div>

      {showWarning ? (
        <div className="rounded-2xl border border-amber-500/50 bg-amber-500/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            <div className="space-y-1">
              <p className="text-base font-semibold text-amber-700 dark:text-amber-300">
                Vor dem Ausladen kassieren (gemäß AGB)
              </p>
              <p className="text-sm text-amber-700/90 dark:text-amber-200/90">
                Bei Festpreis bitte den offenen Betrag vor dem Ausladen entgegennehmen.
                So vermeiden wir Zahlungsausfälle.
              </p>
              <button
                type="button"
                onClick={() => setWarningDismissed(true)}
                className="mt-1 text-sm font-medium text-amber-800 underline underline-offset-2 dark:text-amber-200"
              >
                Trotzdem ohne Zahlung fortfahren
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {successAmount !== null ? (
        <div className="flex items-start gap-2 rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>
            Zahlung über {formatEur(successAmount)} erfasst.
            {outstanding > 0
              ? " Es bleiben " + formatEur(outstanding) + " offen."
              : " Der Betrag ist vollständig bezahlt."}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-2 text-sm font-medium text-foreground">Zahlungsart</p>
        <div className="grid grid-cols-2 gap-3">
          {METHODS.map((m) => {
            const Icon = m.icon;
            const active = method === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                aria-pressed={active}
                className={
                  "flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 text-base font-medium transition-colors " +
                  (active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:bg-muted")
                }
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        <label
          htmlFor="payment-amount"
          className="mt-4 mb-2 block text-sm font-medium text-foreground"
        >
          Betrag (EUR)
        </label>
        <input
          id="payment-amount"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0,00"
          className="min-h-12 w-full rounded-xl border border-border bg-background px-4 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
        />

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              <span>Wird erfasst</span>
            </>
          ) : (
            <span>Zahlung erfassen</span>
          )}
        </button>
      </div>
    </section>
  );
}
