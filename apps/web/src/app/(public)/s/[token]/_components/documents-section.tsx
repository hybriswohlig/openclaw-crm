"use client";

import { CheckCircle2 } from "lucide-react";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";

/**
 * Collected paperwork card: the acceptance confirmation (no PDF exists, so
 * it renders as a check line) plus AB and Rechnung PDFs once they exist.
 * Rendered by StagePortal for every stage >= 2 so the customer always finds
 * their documents in one place. No inline PDF embed:
 * <object type="application/pdf"> is blank on iOS Safari and in-app browsers.
 */
export function DocumentsSection({ ctx }: { ctx: CustomerPortalContext }) {
  const { acceptance, documents, kva, branding } = ctx;
  if (!acceptance && !documents.orderConfirmationUrl && !documents.invoiceUrl) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-border/50 bg-card">
      <div className="border-b border-border/50 px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Ihre Unterlagen
      </div>
      <div className="divide-y divide-border/50">
        {acceptance && (
          <div className="flex items-start gap-3 px-6 py-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0">
              <div className="text-sm font-medium">Angebotsannahme</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Verbindlich angenommen am{" "}
                {new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(
                  new Date(acceptance.signedAt),
                )}
                {kva
                  ? ` über ${new Intl.NumberFormat("de-DE", {
                      style: "currency",
                      currency: "EUR",
                    }).format(kva.totalCents / 100)}`
                  : null}
              </p>
            </div>
          </div>
        )}
        {documents.orderConfirmationUrl && (
          <DocumentRow
            label="Auftragsbestätigung (PDF)"
            url={documents.orderConfirmationUrl}
            primaryColor={branding.primaryColor}
          />
        )}
        {documents.invoiceUrl && (
          <DocumentRow
            label="Rechnung (PDF)"
            url={documents.invoiceUrl}
            primaryColor={branding.primaryColor}
          />
        )}
      </div>
    </section>
  );
}

function DocumentRow({
  label,
  url,
  primaryColor,
}: {
  label: string;
  url: string;
  primaryColor: string;
}) {
  return (
    <div className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm">{label}</div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-11 items-center justify-center rounded-xl px-6 text-sm font-medium text-white transition-opacity hover:opacity-90"
        style={{ background: `#${primaryColor}` }}
      >
        Öffnen
      </a>
    </div>
  );
}
