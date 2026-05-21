"use client";

import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { ScopeSummary } from "./scope-summary";

/**
 * Placeholder for Stage 2 ahead of the full AB build. Renders the live-data
 * summary card + an embed for the AB PDF when one exists, plus the crew
 * preview.
 */
export function StageTwoAb({ ctx }: { ctx: CustomerPortalContext }) {
  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
        <div className="font-medium">Ihr Auftrag ist bestätigt.</div>
        <p className="mt-1 text-xs">
          Wir freuen uns auf Ihren Umzug. Alle wichtigen Informationen finden
          Sie unten — die Auftragsbestätigung als PDF folgt direkt darunter.
        </p>
      </div>

      <ScopeSummary scope={ctx.scope} />

      {ctx.crew.length > 0 && (
        <div className="rounded-2xl border border-border/50 bg-card p-5">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Ihre Crew
          </div>
          <ul className="mt-3 flex flex-wrap gap-3">
            {ctx.crew.map((c) => (
              <li key={c.employeeId} className="flex items-center gap-3">
                {c.photoBase64DataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.photoBase64DataUrl}
                    alt={c.name}
                    className="h-9 w-9 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium text-white"
                    style={{ background: `#${ctx.branding.primaryColor}` }}
                  >
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="text-sm">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ctx.documents.orderConfirmationUrl ? (
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
          <div className="border-b border-border/50 px-6 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Auftragsbestätigung
          </div>
          <object
            data={ctx.documents.orderConfirmationUrl}
            type="application/pdf"
            className="h-[60vh] w-full"
          >
            <a
              href={ctx.documents.orderConfirmationUrl}
              className="block p-6 text-sm underline"
            >
              Auftragsbestätigung herunterladen
            </a>
          </object>
        </div>
      ) : null}
    </section>
  );
}
