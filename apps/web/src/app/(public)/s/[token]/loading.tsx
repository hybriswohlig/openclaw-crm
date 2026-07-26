/**
 * Route-level skeleton while the portal context loads. The segment layout
 * wraps this automatically, so the kottke-portal palette already applies.
 * Shapes mirror StagePortal: brand chip, headline, progress strip, cards.
 *
 * Renders before the page resolves the locale, so it reads the language
 * cookie directly. Only the screen-reader status line is text.
 */
import { cookies } from "next/headers";
import {
  PORTAL_LOCALE_COOKIE,
  resolvePortalLocale,
  translate,
} from "@openclaw-crm/customer-portal-core";

export default async function PortalLoading() {
  const cookieStore = await cookies();
  const locale = resolvePortalLocale({
    cookie: cookieStore.get(PORTAL_LOCALE_COOKIE)?.value ?? null,
  });

  return (
    <main
      role="status"
      className="mx-auto w-full max-w-5xl px-4 pt-8 sm:px-6 md:pt-12 lg:pt-14"
    >
      <span className="sr-only">{translate(locale, "notices.loading")}</span>
      <div aria-hidden className="animate-pulse">
        <div className="h-6 w-36 rounded-full bg-muted" />
        <div className="mt-3 h-8 w-64 max-w-full rounded-lg bg-muted" />
        <div className="mt-6 grid grid-cols-4 gap-2 sm:gap-3">
          <div className="h-9 rounded-lg bg-muted" />
          <div className="h-9 rounded-lg bg-muted" />
          <div className="h-9 rounded-lg bg-muted" />
          <div className="h-9 rounded-lg bg-muted" />
        </div>
        <div className="mt-8 h-56 rounded-2xl bg-muted sm:mt-10" />
        <div className="mt-5 h-36 rounded-2xl bg-muted" />
      </div>
    </main>
  );
}
