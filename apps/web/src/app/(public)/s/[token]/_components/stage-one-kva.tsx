"use client";

import { useMemo, useState } from "react";
import {
  widerrufVerzichtRequired,
  type CustomerPortalContext,
} from "@openclaw-crm/customer-portal-core";
import { ConfirmKvaDialog } from "./confirm-kva-dialog";
import { ScopeSummary } from "./scope-summary";
import { PaymentSection } from "./payment-section";

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
      <section className="rounded-2xl border border-border/50 bg-card p-6 text-sm text-muted-foreground">
        Ihr Kostenvoranschlag wird gerade erstellt. Diese Seite aktualisiert sich
        automatisch, sobald das Angebot bereitsteht. Sie können die Seite einfach
        kurz später erneut öffnen.
      </section>
    );
  }

  const alreadyAccepted = !!ctx.acceptance;

  return (
    <section className="space-y-5">
      {/* Price card */}
      <div
        className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm"
        style={{ boxShadow: `0 0 0 1px #${ctx.branding.primaryColor}20` }}
      >
        <div
          className="px-6 py-4 text-sm font-medium text-white"
          style={{ background: `#${ctx.branding.primaryColor}` }}
        >
          Kostenvoranschlag
        </div>
        <div className="space-y-4 p-6">
          {ctx.kva.isVariable && ctx.kva.lineItems.length > 0 ? (
            <ul className="divide-y divide-border/50">
              {ctx.kva.lineItems.map((li, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                  <div>
                    <span className="font-medium">{li.description || labelForType(li.type)}</span>
                    <span className="ml-2 text-muted-foreground">
                      {li.quantity} × {formatEur(li.unitRate)}
                    </span>
                  </div>
                  <span className="tabular-nums">{formatEur(li.lineTotal)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-baseline justify-between border-t border-border/50 pt-4">
            <span className="text-sm font-medium">
              {ctx.kva.isVariable ? "Voraussichtlich" : "Festpreis"}
            </span>
            <span className="text-xl font-medium tabular-nums">
              {formatEurCents(ctx.kva.totalCents)}
            </span>
          </div>

          {ctx.kva.notes && (
            <p className="rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
              {ctx.kva.notes}
            </p>
          )}

          {ctx.kva.depositRequiredCents && ctx.kva.depositRequiredCents > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
              <strong className="font-medium">Anzahlung erforderlich:</strong>{" "}
              {formatEurCents(ctx.kva.depositRequiredCents)} zur Auftragsbestätigung.
              Sie erhalten die verbindliche Bestätigung, sobald die Anzahlung bei uns
              eingegangen ist.
            </div>
          ) : null}

          {ctx.kva.validUntil ? (
            <p className="text-[11px] text-muted-foreground">
              Angebot gültig bis{" "}
              {new Date(ctx.kva.validUntil).toLocaleDateString("de-DE", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              .
            </p>
          ) : null}
        </div>
      </div>

      {/* Scope summary */}
      <ScopeSummary scope={ctx.scope} />

      {/* Acceptance card */}
      {alreadyAccepted ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2 font-medium">
            <span aria-hidden>✓</span>
            Angebot angenommen
          </div>
          <p className="mt-1 text-xs">
            Bestätigt am{" "}
            {new Date(ctx.acceptance!.signedAt).toLocaleString("de-DE", {
              dateStyle: "long",
              timeStyle: "short",
            })}
            {ctx.acceptance!.acceptedFullName
              ? ` durch ${ctx.acceptance!.acceptedFullName}`
              : ""}
            . Wir bereiten Ihre Auftragsbestätigung vor.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="text-sm">
            <p className="font-medium">Verbindlich annehmen</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mit einem Klick bestätigen Sie den Auftrag rechtlich verbindlich
              (Textform gem. § 126b BGB). Sie erhalten eine Kopie per E-Mail.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl px-5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            style={{ background: `#${ctx.branding.primaryColor}` }}
          >
            Angebot verbindlich annehmen
          </button>
        </div>
      )}

      {/* Anzahlung payment widget — shown once the KVA is accepted AND deposit
          is required AND still outstanding. ctx.payment is populated only when
          the deposit is actually due. */}
      {alreadyAccepted && ctx.payment && ctx.payment.amountCents > 0 && (
        <PaymentSection
          token={token}
          payment={ctx.payment}
          branding={ctx.branding}
          variant="deposit"
        />
      )}

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
    </section>
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
  return formatEur(cents / 100);
}
