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
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadContextByToken, bumpView } from "@/services/customer-portal-data";
import { StagePortal } from "./_components/stage-portal";
import { RevokedNotice } from "./_components/revoked-notice";
import { NotFoundNotice } from "./_components/not-found-notice";
import { FeatureDisabledNotice } from "./_components/feature-disabled-notice";

export const dynamic = "force-dynamic";

export default async function PublicStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const ctx = await loadContextByToken(token);

  if (!ctx) {
    return <NotFoundNotice />;
  }

  // Per-OC feature toggle: short-circuit before doing anything else.
  if (ctx.meta.featureDisabled) {
    return <FeatureDisabledNotice firmaDisplayName={ctx.branding.displayName} />;
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
    return <RevokedNotice firmaDisplayName={ctx.branding.displayName} />;
  }

  return <StagePortal token={token} ctx={ctx} />;
}
