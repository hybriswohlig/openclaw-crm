/**
 * Customer status portal — server component entry.
 *
 * Loads the portable `CustomerPortalContext` once via the data adapter, then
 * dispatches to the correct stage component. Re-renders on every request
 * (`dynamic = "force-dynamic"`) so the customer always sees fresh state.
 *
 * Architectural note: this file is intentionally thin — all DB knowledge lives
 * in `services/customer-portal-data.ts`. The day the portal moves to its own
 * app, this page swaps that import for an HTTP fetch and works unchanged.
 */
import { cache } from "react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  PORTAL_LOCALE_COOKIE,
  resolvePortalLocale,
  translate,
  type PortalLocale,
} from "@openclaw-crm/customer-portal-core";
import { loadContextByToken, bumpView } from "@/services/customer-portal-data";
import { StagePortal } from "./_components/stage-portal";
import { PortalLocaleProvider } from "./_components/portal-i18n";
import { RevokedNotice } from "./_components/revoked-notice";
import { NotFoundNotice } from "./_components/not-found-notice";
import { FeatureDisabledNotice } from "./_components/feature-disabled-notice";

export const dynamic = "force-dynamic";

// Per-request dedup: generateMetadata and the page body both need the
// context, cache() makes that a single DB round trip per request.
const getCtx = cache(loadContextByToken);

/**
 * Resolves the language for this request: an explicit choice (cookie, then
 * the link row) beats the browser's Accept-Language, which beats German.
 *
 * Doing this on the server means the very first paint is already correct —
 * an English reader never sees a German flash.
 */
async function resolveLocale(
  storedLocale: PortalLocale | null
): Promise<PortalLocale> {
  const [cookieStore, hdrs] = await Promise.all([cookies(), headers()]);
  return resolvePortalLocale({
    cookie: cookieStore.get(PORTAL_LOCALE_COOKIE)?.value ?? null,
    stored: storedLocale,
    acceptLanguage: hdrs.get("accept-language"),
  });
}

/**
 * Per-firma link preview. Reads the token, pulls the operating-company
 * branding, and returns title / description / openGraph fields that
 * reflect the firma — never "OpenCRM" or any internal product name.
 *
 * If the token is unknown / revoked we fall back to a neutral "Auftrag"
 * preview so the link doesn't leak existence either way.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const ctx = await getCtx(token).catch(() => null);
  const locale = await resolveLocale(ctx?.preferredLocale ?? null);

  if (!ctx) {
    return {
      title: translate(locale, "meta.fallbackTitle"),
      description: translate(locale, "meta.fallbackDescription"),
      robots: { index: false, follow: false },
    };
  }

  const firma = ctx.branding.displayName;
  const title = translate(locale, "meta.title", {
    firma,
    dealNumber: ctx.dealNumber,
  });
  const description = ctx.customerDisplayName
    ? translate(locale, "meta.descriptionNamed", {
        dealNumber: ctx.dealNumber,
        name: ctx.customerDisplayName,
      })
    : translate(locale, "meta.description", { dealNumber: ctx.dealNumber });

  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      siteName: firma,
      type: "website",
      locale: locale === "en" ? "en_GB" : "de_DE",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ctx = await getCtx(token);
  const locale = await resolveLocale(ctx?.preferredLocale ?? null);

  if (!ctx) {
    return (
      <PortalLocaleProvider token={null} initialLocale={locale}>
        <NotFoundNotice />
      </PortalLocaleProvider>
    );
  }

  // Per-OC feature toggle: short-circuit before doing anything else.
  if (ctx.meta.featureDisabled) {
    return (
      <PortalLocaleProvider token={token} initialLocale={locale}>
        <FeatureDisabledNotice
          whatsappNumberE164={ctx.branding.whatsappNumberE164}
        />
      </PortalLocaleProvider>
    );
  }

  // Canonical-host redirect: if the OC has its own verified custom domain
  // and the customer landed on a different host (e.g. via the shared vercel
  // .app URL), 308 them to the branded host. Comparison is on lowercased
  // host headers; "x-forwarded-host" is what Vercel sets after edge routing.
  const hdrs = await headers();
  const requestHost = (hdrs.get("x-forwarded-host") ?? hdrs.get("host") ?? "").toLowerCase();
  if (
    ctx.meta.canonicalHost &&
    requestHost &&
    !requestHost.endsWith(".vercel.app") &&
    requestHost !== ctx.meta.canonicalHost
  ) {
    redirect(`https://${ctx.meta.canonicalHost}/s/${token}`);
  }

  // Best-effort analytics — don't await.
  bumpView(token).catch(() => {});

  if (ctx.meta.revoked) {
    return (
      <PortalLocaleProvider token={null} initialLocale={locale}>
        <RevokedNotice
          firmaDisplayName={ctx.branding.displayName}
          whatsappNumberE164={ctx.branding.whatsappNumberE164}
        />
      </PortalLocaleProvider>
    );
  }

  return (
    <PortalLocaleProvider token={token} initialLocale={locale}>
      <StagePortal token={token} ctx={ctx} />
    </PortalLocaleProvider>
  );
}
