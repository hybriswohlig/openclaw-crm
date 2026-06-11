"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerPortalContext } from "@openclaw-crm/customer-portal-core";
import { StageHeader } from "./stage-header";
import { StageOneKva } from "./stage-one-kva";
import { StageTwoAb } from "./stage-two-ab";
import { StageThreeLive } from "./stage-three-live";
import { StageFourDone } from "./stage-four-done";
import { DocumentsSection } from "./documents-section";
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

  // Auto-refresh every 30 s during the active move (Stage 3) and on Stage 1
  // while the customer waits for the KVA: the waiting card promises that the
  // page updates itself. Polling is cheap because /state is cached for 0
  // seconds but indexed reads.
  const shouldPoll = ctx.stage === 3 || (ctx.stage === 1 && !ctx.kva);
  useEffect(() => {
    if (!shouldPoll) return;
    const i = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(i);
  }, [shouldPoll, refresh]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-5xl flex-col px-4 pb-16 pt-8 sm:px-6 md:pt-12 lg:pt-14">
      <StageHeader ctx={ctx} />

      <div className="mt-8 flex flex-1 flex-col gap-5 sm:mt-10">
        {ctx.stage === 1 && <StageOneKva token={token} ctx={ctx} onConfirmed={refresh} />}
        {ctx.stage === 2 && <StageTwoAb ctx={ctx} />}
        {ctx.stage === 3 && <StageThreeLive token={token} ctx={ctx} />}
        {ctx.stage === 4 && <StageFourDone token={token} ctx={ctx} />}
      </div>

      {/* Stage 1 shows the offer live, so the paperwork card starts at Stage 2. */}
      {ctx.stage >= 2 && (
        <div className="mt-5">
          <DocumentsSection ctx={ctx} />
        </div>
      )}

      <BrandingFooter branding={ctx.branding} />
    </main>
  );
}
