"use client";

import type { FirmaBranding } from "@openclaw-crm/customer-portal-core";
import { WhatsAppContactLink } from "./whatsapp-contact-link";
import { useT } from "./portal-i18n";

export function BrandingFooter({ branding }: { branding: FirmaBranding }) {
  const t = useT();
  if (!branding.footer && !branding.displayName) return null;

  const hasLegalPages =
    branding.firmaSlug === "kottke" || branding.firmaSlug === "ceylan";

  return (
    <footer className="mt-12 border-t border-border/60 pt-6">
      {branding.whatsappNumberE164 && (
        <div className="mb-6 flex flex-col items-center gap-1 text-center">
          <p className="text-sm text-muted-foreground">{t("footer.questions")}</p>
          <WhatsAppContactLink
            phoneE164={branding.whatsappNumberE164}
            label={t("footer.waLabel")}
          />
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
          style={{ color: `#${branding.primaryColor}` }}
        >
          <span
            className="inline-block h-1.5 w-1.5 rounded-full"
            style={{ background: `#${branding.primaryColor}` }}
          />
          {branding.displayName}
        </div>
        {branding.footer && (
          <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-right sm:text-xs">
            {branding.footer}
          </p>
        )}
      </div>
      {hasLegalPages && (
        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          <a
            href={`/legal/impressum/${branding.firmaSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-1.5 py-2.5 hover:underline"
          >
            {t("footer.impressum")}
          </a>
          {" · "}
          <a
            href={`/legal/datenschutz/${branding.firmaSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-1.5 py-2.5 hover:underline"
          >
            {t("footer.datenschutz")}
          </a>
          {/* The AGB the customer accepts on Stage 1 must stay reachable from
              every stage afterwards, not only inside the acceptance dialog. */}
          {branding.agbPdfUrl && (
            <>
              {" · "}
              <a
                href={branding.agbPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-1.5 py-2.5 hover:underline"
              >
                {t("footer.agb")}
              </a>
            </>
          )}
        </p>
      )}
    </footer>
  );
}
