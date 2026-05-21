import type { FirmaBranding } from "@openclaw-crm/customer-portal-core";

export function BrandingFooter({ branding }: { branding: FirmaBranding }) {
  if (!branding.footer) return null;
  return (
    <footer className="mt-10 border-t border-border/50 pt-6">
      <p className="text-[11px] leading-relaxed text-muted-foreground sm:text-xs">
        {branding.footer}
      </p>
    </footer>
  );
}
