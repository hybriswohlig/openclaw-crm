"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { StageHeader } from "./stage-header";
import { StageOneKva } from "./stage-one-kva";
import { StageTwoAb } from "./stage-two-ab";
import { StageThreeLive } from "./stage-three-live";
import { StageFourDone } from "./stage-four-done";
import { BrandingFooter } from "./branding-footer";
import { useVisitTracker } from "./use-visit-tracker";

/**
 * Stage dispatcher + lightweight client-side refresh on confirmation. Each
 * stage is its own self-contained component so adding Stage 3/4 later doesn't
 * touch this file's structure.
 */
export function StagePortal({
  token,
  ctx: initialCtx,
}: {
  token: string;
  ctx: CustomerPortalContext;
}) {
  const [ctx, setCtx] = useState(initialCtx);

  // Open + duration beacon: tells the operator the customer saw the page and
  // for how long. Drives the share-panel telemetry. See use-visit-tracker.ts.
  useVisitTracker(token, ctx.stage);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/${token}/state`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { data: CustomerPortalContext };
      setCtx(json.data);
    } catch {
      // Network blip — keep showing what we have.
    }
  }, [token]);

  // Auto-refresh every 30 s during the active move so the live feed updates
  // without manual reload. Polling is cheap because /state is cached for 0
  // seconds but indexed reads.
  useEffect(() => {
    if (ctx.stage !== 3) return;
    const i = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(i);
  }, [ctx.stage, refresh]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:pt-14">
      <StageHeader ctx={ctx} />

      <div className="mt-8 flex flex-1 flex-col gap-5 sm:mt-10">
        {ctx.stage === 1 && <StageOneKva token={token} ctx={ctx} onConfirmed={refresh} />}
        {ctx.stage === 2 && <StageTwoAb ctx={ctx} />}
        {ctx.stage === 3 && <StageThreeLive token={token} ctx={ctx} />}
        {ctx.stage === 4 && <StageFourDone token={token} ctx={ctx} />}
      </div>

      <BrandingFooter branding={ctx.branding} />
    </main>
  );
}
