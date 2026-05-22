"use client";

import { Check, Plus, ShieldCheck } from "lucide-react";
import type {
  FirmaBranding,
  OfferInclusions,
} from "@openclaw-crm/customer-portal-core";

/**
 * Inclusions section shown above the acceptance card on Stage 1.
 *
 * Two-section model (Check24 / Updater pattern). The included list does the
 * work of selling trust ("you're getting all of this"); the optional list
 * sets clear expectations on what is NOT in the offer so the customer is not
 * surprised later. No third "Nicht enthalten" section: that would feel
 * negative right before the accept button.
 *
 * Below the lists sits a small "Versicherung" trust line. It mirrors what
 * top German moving marketplaces (Check24, MOVE24) ship by default and helps
 * the customer cross the commitment threshold.
 */
export function OfferInclusionsSection({
  inclusions,
  branding,
}: {
  inclusions: OfferInclusions;
  branding: FirmaBranding;
}) {
  if (inclusions.included.length === 0 && inclusions.optional.length === 0) {
    return null;
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border/50 bg-card">
      <div
        className="px-6 py-3 text-sm font-medium text-white"
        style={{ background: `#${branding.primaryColor}` }}
      >
        Leistungsumfang
      </div>

      <div className="space-y-5 p-6">
        {inclusions.included.length > 0 && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Im Angebot enthalten
            </h3>
            <ul className="mt-3 space-y-2">
              {inclusions.included.map((item) => (
                <li key={item.key} className="flex items-start gap-3 text-sm">
                  <span
                    className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    style={{ background: `#${branding.primaryColor}` }}
                  >
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </span>
                  <span className="leading-snug">
                    {item.label}
                    {item.detail && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({item.detail})
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {inclusions.optional.length > 0 && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Auf Wunsch zubuchbar
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Diese Leistungen sind im aktuellen Angebot nicht enthalten. Sagen
              Sie kurz Bescheid, wenn Sie etwas davon möchten.
            </p>
            <ul className="mt-3 space-y-2">
              {inclusions.optional.map((item) => (
                <li key={item.key} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
                    <Plus className="h-3 w-3 text-muted-foreground" strokeWidth={2.5} />
                  </span>
                  <span className="leading-snug text-muted-foreground">
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0"
            style={{ color: `#${branding.primaryColor}` }}
          />
          <span className="leading-relaxed">
            Ihre Möbel sind bei uns versichert. Höhere Deckungssummen vereinbaren
            wir gern auf Anfrage.
          </span>
        </div>
      </div>
    </section>
  );
}
