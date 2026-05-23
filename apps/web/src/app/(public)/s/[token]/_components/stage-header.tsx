"use client";

import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";

/**
 * Top-of-page header: brand mark, deal number, customer name, and a tiny
 * stage tracker so the customer instantly understands where they are.
 */
export function StageHeader({ ctx }: { ctx: CustomerPortalContext }) {
  const stages: Array<{ n: 1 | 2 | 3 | 4; title: string }> = [
    { n: 1, title: "Kostenvoranschlag" },
    { n: 2, title: "Auftragsbestätigung" },
    { n: 3, title: "Während des Umzugs" },
    { n: 4, title: "Nach dem Umzug" },
  ];

  return (
    <header>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div
            className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider"
            style={{ color: `#${ctx.branding.primaryColor}` }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: `#${ctx.branding.primaryColor}` }} />
            {ctx.branding.displayName}
          </div>
          <h1 className="mt-1 truncate text-xl font-medium sm:text-2xl">
            Ihr Auftrag · {ctx.dealNumber}
          </h1>
          {ctx.customerDisplayName && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              für {ctx.customerDisplayName}
            </p>
          )}
        </div>
      </div>

      <ol className="mt-5 grid grid-cols-4 gap-1.5" aria-label="Status-Schritte">
        {stages.map((s) => {
          const state =
            s.n < ctx.stage ? "done" : s.n === ctx.stage ? "active" : "future";
          return (
            <li key={s.n} className="flex flex-col gap-1">
              <div
                className="h-1 w-full rounded-full"
                style={{
                  background:
                    state === "future"
                      ? "var(--muted, #e5e5e5)"
                      : `#${ctx.branding.primaryColor}`,
                  opacity: state === "active" ? 1 : state === "done" ? 0.5 : 0.2,
                }}
              />
              <span
                className={
                  "truncate text-[10px] font-medium uppercase tracking-wider sm:text-xs " +
                  (state === "active"
                    ? "text-foreground"
                    : "text-muted-foreground")
                }
              >
                {s.title}
              </span>
            </li>
          );
        })}
      </ol>
    </header>
  );
}
