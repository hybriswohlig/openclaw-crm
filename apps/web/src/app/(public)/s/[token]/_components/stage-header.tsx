"use client";

import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { LanguageToggle } from "./language-toggle";
import { useT } from "./portal-i18n";

/**
 * Top-of-page header.
 *
 * Above the fold the customer reads, in order:
 *   1. A small chip with the firma's name + brand dot (anchors trust).
 *   2. "Ihr Auftrag · KOT-…" — the deal number, big enough to read on mobile.
 *   3. Optional customer name as a quiet subline.
 *   4. A 4-step progress strip that tells them where they are.
 *
 * The progress strip uses filled rounded bars with subtle checkmarks for
 * completed stages, a fully saturated bar for the current stage, and a thin
 * placeholder for the future stages. The strip uses CSS gradient instead of
 * raw color so it reads as premium against the muted Berlin-Blue surface.
 */
export function StageHeader({ ctx }: { ctx: CustomerPortalContext }) {
  const t = useT();
  const stages: Array<{ n: 1 | 2 | 3 | 4; title: string; shortTitle: string }> = [
    { n: 1, title: t("header.stage1"), shortTitle: t("header.stage1Short") },
    { n: 2, title: t("header.stage2"), shortTitle: t("header.stage2Short") },
    { n: 3, title: t("header.stage3"), shortTitle: t("header.stage3Short") },
    { n: 4, title: t("header.stage4"), shortTitle: t("header.stage4Short") },
  ];

  const accent = `#${ctx.branding.primaryColor}`;

  return (
    <header className="relative">
      {/* Soft brand-tinted glow behind the header. Sits below content via
          z-0; the parent main container's bg shows through. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-6 -z-10 h-32 opacity-60 blur-2xl"
        style={{
          background: `radial-gradient(60% 100% at 20% 0%, ${accent}1f, transparent 70%)`,
        }}
      />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/70 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider backdrop-blur"
            style={{ color: accent }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: accent }}
            />
            {ctx.branding.displayName}
          </div>
          <h1 className="display mt-2 truncate text-2xl font-medium tracking-tight sm:text-3xl">
            {t("header.yourOrder")} · {ctx.dealNumber}
          </h1>
          {ctx.customerDisplayName && (
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {t("header.forCustomer", { name: ctx.customerDisplayName })}
            </p>
          )}
        </div>

        {/* Language switch sits with the logo, above the fold and reachable
            from every stage without scrolling. */}
        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          <LanguageToggle primaryColor={ctx.branding.primaryColor} />
          {ctx.branding.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ctx.branding.logoUrl}
              alt={ctx.branding.displayName}
              className="h-9 w-auto opacity-90 sm:h-10"
            />
          )}
        </div>
      </div>

      <ol
        className="mt-6 grid grid-cols-4 gap-2 sm:gap-3"
        aria-label={t("header.stepsLabel")}
      >
        {stages.map((s) => {
          const state =
            s.n < ctx.stage ? "done" : s.n === ctx.stage ? "active" : "future";
          const isFuture = state === "future";
          const isDone = state === "done";
          const isActive = state === "active";
          return (
            <li key={s.n} className="flex flex-col gap-1.5">
              <div
                className="relative h-1.5 w-full overflow-hidden rounded-full"
                style={{
                  background: isFuture
                    ? "var(--muted)"
                    : isDone
                      ? `${accent}66`
                      : "var(--muted)",
                }}
              >
                {isActive && (
                  <div
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${accent}, ${accent}cc)`,
                    }}
                  />
                )}
              </div>
              <div className="flex items-center gap-1">
                {isDone && (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                    className="shrink-0"
                    style={{ color: accent }}
                  >
                    <path
                      d="M20 6L9 17l-5-5"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
                <span
                  className={
                    "truncate text-[10px] font-medium uppercase tracking-wider sm:text-xs " +
                    (isActive
                      ? "text-foreground"
                      : isDone
                        ? "text-foreground/70"
                        : "text-muted-foreground")
                  }
                >
                  <span className="sm:hidden">{s.shortTitle}</span>
                  <span className="hidden sm:inline">{s.title}</span>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </header>
  );
}
