import type { CustomerPortalContext, MoveTiming } from "@openclaw-crm/customer-portal-core";

export function formatPortalMoney(cents: number): string {
  const digits = cents % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(cents / 100);
}

export function formatPortalDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function recordedMoveStatus(timing: MoveTiming): string | null {
  if (timing.finishedAt) return "Umzug abgeschlossen";
  if (timing.onsiteAt) return "Team vor Ort";
  if (timing.departureAt) return "Team unterwegs";
  return null;
}

export function selectedPortalPackage(ctx: CustomerPortalContext) {
  return ctx.dealPackageOffers.options.find(o => o.id === ctx.dealPackageOffers.selectedOptionId)
    ?? (ctx.dealPackageOffers.options.length === 0 ? ctx.packages.available.find(p => p.slug === ctx.packages.selectedSlug) : undefined);
}

export function portalBrandStyle(color: string) {
  const brand = `#${color.replace(/^#/, "")}`;
  return { "--portal-brand": brand, "--primary": brand, "--ring": brand, "--portal-tint": `color-mix(in srgb, ${brand} 5%, var(--card))` } as React.CSSProperties;
}
