import type { FirmaBranding } from "@openclaw-crm/customer-portal-core";

export function BrandingFooter({ branding }: { branding: FirmaBranding }) {
  return <footer className="portal-footer">
    <strong>{branding.displayName}</strong><span className="portal-footer-rule" aria-hidden />
    {branding.footer && <p>{branding.footer}</p>}
    {(branding.firmaSlug === "kottke" || branding.firmaSlug === "ceylan") && <nav aria-label="Rechtliche Informationen"><a href={`/legal/impressum/${branding.firmaSlug}`} target="_blank" rel="noopener noreferrer">Impressum</a><a href={`/legal/datenschutz/${branding.firmaSlug}`} target="_blank" rel="noopener noreferrer">Datenschutz</a></nav>}
  </footer>;
}
