import type { FirmaBranding } from "@openclaw-crm/customer-portal-core";
import { WhatsAppContactLink } from "./whatsapp-contact-link";

export function BrandingFooter({ branding }: { branding: FirmaBranding }) {
  if (!branding.footer && !branding.displayName) return null;
  return (
    <footer className="mt-12 border-t border-border/60 pt-6">
      {branding.whatsappNumberE164 && (
        <div className="mb-6 flex flex-col items-center gap-1 text-center">
          <p className="text-sm text-muted-foreground">Fragen zu Ihrem Umzug?</p>
          <WhatsAppContactLink
            phoneE164={branding.whatsappNumberE164}
            label="Per WhatsApp schreiben"
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
    </footer>
  );
}
