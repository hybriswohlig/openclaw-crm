"use client";

import { Check } from "lucide-react";
import type {
  FirmaBranding,
  OfferPackagesContext,
} from "@openclaw-crm/customer-portal-core";

/**
 * Read-only package showcase for Stage 1.
 *
 * The operator chooses the package in the CRM. The customer sees what was
 * picked highlighted, plus the alternatives for context. We deliberately do
 * NOT let the customer switch tiers from the public link — switching changes
 * the price + auftrag scope and that conversation belongs in the chat with
 * the operator. The other cards exist so the customer can see they had
 * options and understands what the chosen tier delivers vs the rest.
 *
 * Layout: vertical stack on mobile, 3-up grid on >= 640px.
 *
 * Reference: Apple iPhone storage selector, Tesla configurator interior pick.
 * Selected card gets a 2px primary-coloured border. Recommended badge
 * appears on the row flagged is_recommended in the DB (typically Komfort).
 */
export function PackageSelector({
  packages,
  branding,
}: {
  packages: OfferPackagesContext;
  branding: FirmaBranding;
}) {
  if (packages.available.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Pakete
      </h2>
      <ul className="grid gap-3 sm:grid-cols-3">
        {packages.available.map((p) => {
          const selected = p.slug === packages.selectedSlug;
          return (
            <li
              key={p.slug}
              className="relative flex flex-col rounded-2xl border bg-card p-4 transition-colors"
              style={{
                borderColor: selected ? `#${branding.primaryColor}` : undefined,
                borderWidth: selected ? 2 : 1,
                padding: selected ? "15px" : "16px",
              }}
            >
              {p.isRecommended && (
                <span
                  className="absolute -top-2.5 right-4 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-white"
                  style={{ background: `#${branding.primaryColor}` }}
                >
                  Beliebteste Wahl
                </span>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="display text-base font-medium">
                  {p.displayName}
                </span>
                {selected && (
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full"
                    style={{ background: `#${branding.primaryColor}` }}
                  >
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </span>
                )}
              </div>

              {p.priceFromCents != null && (
                <div className="mt-2 text-sm tabular-nums">
                  {p.priceFixedFlag ? (
                    <span className="font-medium">{formatEur(p.priceFromCents)}</span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">ab </span>
                      <span className="font-medium">{formatEur(p.priceFromCents)}</span>
                    </>
                  )}
                </div>
              )}

              {p.shortDescription && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {p.shortDescription}
                </p>
              )}

              {p.includedItems.length > 0 && (
                <ul className="mt-3 space-y-1.5 text-xs">
                  {p.includedItems.slice(0, 4).map((item, i) => (
                    <li key={i} className="flex items-start gap-2 leading-snug">
                      <Check
                        className="mt-0.5 h-3 w-3 shrink-0"
                        strokeWidth={2.5}
                        style={{ color: `#${branding.primaryColor}` }}
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                  {p.includedItems.length > 4 && (
                    <li className="text-muted-foreground">
                      und {p.includedItems.length - 4} weitere
                    </li>
                  )}
                </ul>
              )}

              {p.targetSegment && (
                <p className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">
                  {p.targetSegment}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {packages.selectedSlug && (
        <p className="text-[11px] text-muted-foreground">
          Ihr Angebot basiert auf dem Paket{" "}
          <strong className="text-foreground">
            {packages.available.find((p) => p.slug === packages.selectedSlug)?.displayName ??
              packages.selectedSlug}
          </strong>
          . Andere Pakete sehen Sie zum Vergleich.
        </p>
      )}
    </section>
  );
}

function formatEur(cents: number): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
